-- Campaign visibility, opt-in follow-up and operator-only digests.
ALTER TABLE engagement_gates ADD COLUMN entry_page TEXT NOT NULL DEFAULT 'redirect' CHECK(entry_page IN ('redirect','status'));
ALTER TABLE engagement_gates ADD COLUMN message_templates TEXT;
ALTER TABLE engagement_gates ADD COLUMN loser_followup TEXT;
CREATE TABLE campaign_digests (
 id TEXT PRIMARY KEY, gate_id TEXT, kind TEXT NOT NULL CHECK(kind IN ('ended','weekly','budget')),
 period_key TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('line','slack','email')),
 lines TEXT NOT NULL, generated INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL,last_error TEXT,created_at INTEGER NOT NULL,sent_at INTEGER,
 lock_owner TEXT,locked_until INTEGER, connection_id TEXT,
 UNIQUE(gate_id,kind,period_key,channel)
);
-- SQLite UNIQUE treats NULLs as distinct. Account-wide digests also need a key.
CREATE UNIQUE INDEX campaign_digest_identity ON campaign_digests(COALESCE(gate_id,''),kind,period_key,channel,COALESCE(connection_id,''));
CREATE INDEX campaign_digest_due ON campaign_digests(status,next_at);
CREATE TABLE campaign_digest_tests(gate_id TEXT NOT NULL,channel TEXT NOT NULL,last_at INTEGER NOT NULL,PRIMARY KEY(gate_id,channel));

-- A finalized participant may already own a consolation allocation. Follow-up
-- inventory needs a separate, idempotent allocation purpose without replacing it.
CREATE TABLE gate_followup_allocations(participant_id TEXT PRIMARY KEY REFERENCES gate_participants(id),gate_id TEXT NOT NULL,reward_id TEXT NOT NULL REFERENCES gate_rewards(id),value TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TRIGGER gate_followup_capacity BEFORE INSERT ON gate_followup_allocations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_rewards r JOIN engagement_gates g ON g.id=r.gate_id WHERE r.id=NEW.reward_id AND r.gate_id=NEW.gate_id AND r.is_consolation=1 AND r.type IN ('coupon_code','url') AND (r.quota IS NULL OR r.issued<r.quota) AND json_extract(g.loser_followup,'$.couponRewardId')=r.id AND json_extract(g.loser_followup,'$.enabled')=1) THEN RAISE(ABORT,'reward_exhausted') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM gate_participants WHERE id=NEW.participant_id AND gate_id=NEW.gate_id AND outcome='lost' AND finalized_at IS NOT NULL) THEN RAISE(ABORT,'participant_not_lost') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM gate_rewards WHERE id=NEW.reward_id AND type='coupon_code') AND NOT EXISTS(SELECT 1 FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL) THEN RAISE(ABORT,'reward_exhausted') END;
END;
CREATE TRIGGER gate_followup_commit AFTER INSERT ON gate_followup_allocations BEGIN
 UPDATE gate_rewards SET issued=issued+1 WHERE id=NEW.reward_id;
 UPDATE reward_codes SET assigned_participant_id='followup:'||NEW.participant_id WHERE id=(SELECT id FROM reward_codes WHERE reward_id=NEW.reward_id AND assigned_participant_id IS NULL ORDER BY id LIMIT 1);
 UPDATE gate_followup_allocations SET value=COALESCE((SELECT code FROM reward_codes WHERE assigned_participant_id='followup:'||NEW.participant_id),value) WHERE participant_id=NEW.participant_id;
END;

CREATE TABLE campaign_digest_email_receipts(digest_id TEXT NOT NULL,recipient TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(digest_id,recipient));
