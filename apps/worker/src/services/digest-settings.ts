export const DIGEST_SETTINGS = [
  'digest_channels',
  'digest_weekly_enabled',
  'digest_slack_webhook',
  'digest_email_to',
];
export const SECRET_SETTINGS = new Set(['digest_slack_webhook']);
export function digestChannels(value?: string): Array<'line' | 'slack' | 'email'> {
  try {
    const v = JSON.parse(value ?? '[]');
    return Array.isArray(v) ? v.filter((x) => ['line', 'slack', 'email'].includes(x)) : [];
  } catch {
    return [];
  }
}
export function validSlackWebhook(value: string) {
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      u.hostname === 'hooks.slack.com' &&
      !u.port &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith('/services/') &&
      !u.hash &&
      !u.search
    );
  } catch {
    return false;
  }
}
export function validateDigestSettings(body: Record<string, unknown>) {
  if (body.digest_channels !== undefined) {
    try {
      const v = JSON.parse(String(body.digest_channels));
      if (
        !Array.isArray(v) ||
        v.length > 3 ||
        new Set(v).size !== v.length ||
        v.some((x) => !['line', 'slack', 'email'].includes(x))
      )
        return false;
    } catch {
      return false;
    }
  }
  if (
    body.digest_weekly_enabled !== undefined &&
    !['true', 'false'].includes(String(body.digest_weekly_enabled))
  )
    return false;
  if (
    body.digest_slack_webhook !== undefined &&
    body.digest_slack_webhook !== '' &&
    (typeof body.digest_slack_webhook !== 'string' ||
      body.digest_slack_webhook.length > 2000 ||
      !validSlackWebhook(body.digest_slack_webhook))
  )
    return false;
  if (body.digest_email_to !== undefined) {
    if (typeof body.digest_email_to !== 'string' || body.digest_email_to.length > 1280)
      return false;
    const emails = body.digest_email_to
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (
      emails.length > 5 ||
      emails.some(
        (x) =>
          x.length > 254 ||
          !/^([A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+)@([A-Za-z0-9-]+\.)+[A-Za-z]{2,63}$/.test(x),
      )
    )
      return false;
  }
  return true;
}
export async function readDigestSettings(db: D1Database) {
  const rows = (
    await db
      .prepare("SELECT key,value FROM settings WHERE key LIKE 'digest_%'")
      .all<{ key: string; value: string }>()
  ).results;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
