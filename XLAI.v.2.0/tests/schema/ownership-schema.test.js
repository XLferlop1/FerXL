const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const { runOwnershipMigrations, OWNERSHIP_MIGRATION_SQL } = require("../../db/migrations.js");

const migrationPath = path.join(__dirname, "../../db/migrations/ownership-p0-b2.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8");

function describeMigrationSyntax() {
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS internal_users/i);
  assert.match(migrationSql, /firebase_uid\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i);
  assert.match(migrationSql, /status\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(status\s+IN\s*\('pending',\s*'active',\s*'disabled'\)\)/i);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS conversations/i);
  assert.match(migrationSql, /owner_user_id\s+UUID\s+NOT\s+NULL\s+REFERENCES\s+internal_users\(id\)/i);
  assert.match(migrationSql, /server-generated UUID v4 values|crypto\.randomUUID\(\)|application remains the explicit generation contract/i);
  assert.doesNotMatch(migrationSql, /DEFAULT\s+gen_random_uuid\(|DEFAULT\s+uuid_generate_v4\(|gen_random_uuid\(|uuid_generate_v4\(/i);
  assert.match(migrationSql, /ALTER TABLE messages\s+ADD COLUMN IF NOT EXISTS conversation_uuid/i);
  assert.match(migrationSql, /ALTER TABLE coach_interactions\s+ADD COLUMN IF NOT EXISTS conversation_uuid/i);
  assert.match(migrationSql, /ALTER TABLE journal_entries\s+ADD COLUMN IF NOT EXISTS owner_user_id/i);
  assert.match(migrationSql, /legacy behavior is intentionally preserved/i);
  assert.match(migrationSql, /table_schema = 'public'/i);
  assert.match(migrationSql, /messages\.user_id|coach_interactions\.user_id|journal_entries\.user_id/i);
  assert.match(migrationSql, /messages\.conversation_id|coach_interactions\.conversation_id|journal_entries\.conversation_id/i);
  assert.doesNotMatch(migrationSql, /conversation_members/i);
  assert.doesNotMatch(migrationSql, /beta_default_user|first Firebase user|UPDATE .*owner_user_id|UPDATE .*conversation_uuid|INSERT INTO .*internal_users.*SELECT/i);
}

test("ownership migration file defines the required schema foundation", () => {
  describeMigrationSyntax();
});

test("migration SQL is deterministic and idempotent by construction", async () => {
  const calls = [];
  const fakePool = {
    async query(sql) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
  };

  await runOwnershipMigrations(fakePool);
  await runOwnershipMigrations(fakePool);

  assert.equal(calls.length, 2);
  assert.ok(calls[0].includes("CREATE TABLE IF NOT EXISTS internal_users"));
  assert.ok(calls[0].includes("CREATE TABLE IF NOT EXISTS conversations"));
  assert.ok(calls[1].includes("CREATE TABLE IF NOT EXISTS internal_users"));
});

test("ownership migration remains safe for legacy rows with unknown ownership", async () => {
  const sql = OWNERSHIP_MIGRATION_SQL;
  assert.match(sql, /ADD COLUMN IF NOT EXISTS .*owner_user_id.*UUID.*NULL/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS .*conversation_uuid.*UUID.*NULL/i);
  assert.doesNotMatch(sql, /UPDATE .* SET .*owner_user_id/i);
  assert.doesNotMatch(sql, /UPDATE .* SET .*conversation_uuid/i);
  assert.doesNotMatch(sql, /INSERT INTO .*internal_users.*SELECT/i);
  assert.ok(sql.includes("messages"));
  assert.ok(sql.includes("coach_interactions"));
  assert.ok(sql.includes("journal_entries"));
  assert.ok(sql.includes("internal_users"));
  assert.ok(sql.includes("conversations"));
});

if (process.env.DATABASE_URL) {
  test("migration applies against a live PostgreSQL database when configured", async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    try {
      await runOwnershipMigrations(pool);
      const introspection = await pool.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('internal_users', 'conversations');
      `);
      const names = new Set(introspection.rows.map((row) => row.table_name));
      assert.ok(names.has("internal_users"));
      assert.ok(names.has("conversations"));

      const messagesColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages'
          AND column_name IN ('conversation_uuid', 'conversation_id', 'user_id');
      `);
      const coachColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'coach_interactions'
          AND column_name IN ('conversation_uuid', 'conversation_id', 'user_id');
      `);
      const journalColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'journal_entries'
          AND column_name IN ('owner_user_id', 'conversation_id', 'user_id');
      `);

      const messageNames = new Set(messagesColumns.rows.map((row) => row.column_name));
      const coachNames = new Set(coachColumns.rows.map((row) => row.column_name));
      const journalNames = new Set(journalColumns.rows.map((row) => row.column_name));

      assert.ok(messageNames.has("conversation_uuid"));
      assert.ok(coachNames.has("conversation_uuid"));
      assert.ok(journalNames.has("owner_user_id"));
      assert.ok(messageNames.has("conversation_id"));
      assert.ok(coachNames.has("conversation_id"));
      assert.ok(journalNames.has("conversation_id"));
      assert.ok(messageNames.has("user_id"));
      assert.ok(coachNames.has("user_id"));
      assert.ok(journalNames.has("user_id"));
    } finally {
      await pool.end();
    }
  });
}
