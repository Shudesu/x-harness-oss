import { buildXClient } from '../services/x-client.js';
import { Hono } from 'hono';
import { XClient } from '@x-harness/x-sdk';
import { getXAccounts, getXAccountById, incrementApiUsage } from '@x-harness/db';
import type { Env } from '../index.js';

const dm = new Hono<Env>();

// Helper: build XClient from account record

// Helper: extract participantId from a 1:1 conversation ID (format: "userId1-userId2")
// Returns null for group conversations (IDs with more than one hyphen-separated segment pair)
function extractParticipantId(conversationId: string, myUserId: string): string | null {
  const parts = conversationId.split('-');
  // 1:1 DM conversation IDs consist of exactly two numeric segments separated by a hyphen
  if (parts.length !== 2) return null;
  const other = parts.find((p) => p !== myUserId);
  return other ?? null;
}

// GET /api/dm/conversations — list DM conversations grouped from the DM events timeline.
// NOTE: X API provides /dm_events (message-level pagination), not /dm_conversations (conversation-level).
// The cursor paginates raw events, so the same conversation may appear on multiple pages when it has
// many messages. Clients should merge results by conversationId (keeping the most recent lastMessageAt).
// Query: xAccountId (optional), cursor (optional — pass nextCursor from previous response)
dm.get('/api/dm/conversations', async (c) => {
  const xAccountId = c.req.query('xAccountId');
  const cursor = c.req.query('cursor');
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'dm');
  try {
    const res = await xClient.getDmEvents(undefined, cursor ?? undefined);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'dm_events'));
    const events = res.data ?? [];

    // Group by dm_conversation_id, keep latest message per conversation
    const latestByConvo = new Map<string, {
      conversationId: string;
      participantId: string | null;
      isGroup: boolean;
      lastMessage: string;
      lastMessageAt: string;
      senderId: string;
    }>();

    for (const event of events) {
      const convoId = event.dm_conversation_id;
      if (!convoId) continue;
      if (!latestByConvo.has(convoId)) {
        const participantId = extractParticipantId(convoId, account!.x_user_id);
        latestByConvo.set(convoId, {
          conversationId: convoId,
          participantId,
          isGroup: participantId === null,
          lastMessage: event.text ?? '',
          lastMessageAt: event.created_at ?? '',
          senderId: event.sender_id ?? '',
        });
      }
    }

    // Resolve participant profiles
    const convos = Array.from(latestByConvo.values());
    const participantIds = [...new Set(convos.map((c) => c.participantId).filter(Boolean))] as string[];
    const profileMap = new Map<string, { username: string; displayName: string; profileImageUrl: string | null }>();
    // Batch lookup (X API allows up to 100 users per request)
    if (participantIds.length > 0) {
      try {
        const users = await xClient.getUsersByIds(participantIds);
        for (const u of users) {
          profileMap.set(u.id, { username: u.username, displayName: u.name, profileImageUrl: u.profile_image_url ?? null });
        }
      } catch {
        // Profile lookup failed — continue without profiles
      }
    }

    return c.json({
      success: true,
      data: convos.map((cv) => ({
        ...cv,
        participantUsername: profileMap.get(cv.participantId ?? '')?.username ?? null,
        participantDisplayName: profileMap.get(cv.participantId ?? '')?.displayName ?? null,
        participantProfileImageUrl: profileMap.get(cv.participantId ?? '')?.profileImageUrl ?? null,
      })),
      nextCursor: res.meta?.next_token ?? null,
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch DM conversations' }, 500);
  }
});

// GET /api/dm/conversations/:conversationId/messages — messages in a conversation
dm.get('/api/dm/conversations/:conversationId/messages', async (c) => {
  const conversationId = c.req.param('conversationId');
  const xAccountId = c.req.query('xAccountId');
  const cursor = c.req.query('cursor');
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'dm');
  try {
    const res = await xClient.getDmEvents(conversationId, cursor ?? undefined);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'dm_events'));
    const events = res.data ?? [];

    const messages = events.map((event) => ({
      id: event.id,
      text: event.text ?? '',
      senderId: event.sender_id ?? '',
      isMe: event.sender_id === account!.x_user_id,
      createdAt: event.created_at ?? '',
    }));

    // Reverse for chronological order (oldest first)
    messages.reverse();

    return c.json({
      success: true,
      data: {
        messages,
        myUserId: account.x_user_id,
        nextCursor: res.meta?.next_token ?? null,
      },
    });
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to fetch DM messages' }, 500);
  }
});

// POST /api/dm/send — send a DM to a participant
dm.post('/api/dm/send', async (c) => {
  const { xAccountId, participantId, text } = await c.req.json<{
    xAccountId?: string;
    participantId: string;
    text: string;
  }>();
  if (!participantId || !text) {
    return c.json({ success: false, error: 'Missing required fields: participantId, text' }, 400);
  }
  let account;
  if (xAccountId) {
    account = await getXAccountById(c.env.DB, xAccountId);
  } else {
    const accounts = await getXAccounts(c.env.DB);
    account = accounts[0] ?? null;
  }
  if (!account) return c.json({ success: false, error: 'X account not found' }, 404);
  const xClient = await buildXClient(c.env, account, 'dm');
  try {
    const result = await xClient.sendDm(participantId, text);
    c.executionCtx.waitUntil(incrementApiUsage(c.env.DB, account.id, 'dm_send'));
    const dmMessage = {
      id: result.dm_event_id,
      text,
      senderId: account.x_user_id,
      isMe: true,
      createdAt: new Date().toISOString(),
    };
    return c.json({ success: true, data: dmMessage }, 201);
  } catch (err: any) {
    return c.json({ success: false, error: err.message ?? 'Failed to send DM' }, 500);
  }
});

export { dm };
