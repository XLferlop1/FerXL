BEGIN;

-- Legacy behavior is intentionally preserved:
-- messages.user_id, messages.conversation_id, coach_interactions.user_id,
-- coach_interactions.conversation_id, journal_entries.user_id,
-- journal_entries.conversation_id remain as compatibility columns and are not
-- backfilled or reinterpreted during this ownership schema phase.
--
-- Ownership IDs are server-generated UUID v4 values (for example via
-- crypto.randomUUID() in the Node server). PostgreSQL default UUID functions are
-- not assumed here, so the application remains the explicit generation contract.

CREATE TABLE IF NOT EXISTS internal_users (
  id UUID PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sign_in_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES internal_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT
);

CREATE INDEX IF NOT EXISTS idx_conversations_owner_user_id
  ON conversations (owner_user_id);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS conversation_uuid UUID NULL;

ALTER TABLE coach_interactions
  ADD COLUMN IF NOT EXISTS conversation_uuid UUID NULL;

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.tables t
      ON tc.table_schema = t.table_schema
     AND tc.table_name = t.table_name
    WHERE tc.constraint_name = 'messages_conversation_uuid_fk'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'messages'
      AND t.table_schema = 'public'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_conversation_uuid_fk
      FOREIGN KEY (conversation_uuid) REFERENCES conversations(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.tables t
      ON tc.table_schema = t.table_schema
     AND tc.table_name = t.table_name
    WHERE tc.constraint_name = 'coach_interactions_conversation_uuid_fk'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'coach_interactions'
      AND t.table_schema = 'public'
  ) THEN
    ALTER TABLE coach_interactions
      ADD CONSTRAINT coach_interactions_conversation_uuid_fk
      FOREIGN KEY (conversation_uuid) REFERENCES conversations(id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.tables t
      ON tc.table_schema = t.table_schema
     AND tc.table_name = t.table_name
    WHERE tc.constraint_name = 'journal_entries_owner_user_id_fk'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'journal_entries'
      AND t.table_schema = 'public'
  ) THEN
    ALTER TABLE journal_entries
      ADD CONSTRAINT journal_entries_owner_user_id_fk
      FOREIGN KEY (owner_user_id) REFERENCES internal_users(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_uuid
  ON messages (conversation_uuid);

CREATE INDEX IF NOT EXISTS idx_coach_interactions_conversation_uuid
  ON coach_interactions (conversation_uuid);

CREATE INDEX IF NOT EXISTS idx_journal_entries_owner_user_id
  ON journal_entries (owner_user_id);

COMMIT;
