"use strict";

const RETENTION_POLICY = Object.freeze({
  messagesHours: 24,
  coachInteractionsHours: 24,
  journalEntriesHours: 24,
});

const CLEANUP_TARGETS = Object.freeze([
  "messages",
  "coach_interactions",
  "journal_entries",
]);

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

let lastCleanupAt = null;
let cleanupInFlight = null;

function getPrivacyStatus() {
  return {
    retention: {
      messagesHours: RETENTION_POLICY.messagesHours,
      coachInteractionsHours: RETENTION_POLICY.coachInteractionsHours,
      journalEntriesHours: RETENTION_POLICY.journalEntriesHours,
    },
    lastCleanupAt: lastCleanupAt ? lastCleanupAt.toISOString() : null,
    cleanupTargets: [...CLEANUP_TARGETS],
  };
}

function setLastCleanupAt(value) {
  lastCleanupAt = value instanceof Date ? value : null;
}

async function cleanupOldMessages(pool) {
  if (!pool) return { target: "messages", deleted: 0 };

  const result = await pool.query(
    `
      DELETE FROM messages
      WHERE created_at_timestamp < NOW() - ($1::int * INTERVAL '1 hour');
    `,
    [RETENTION_POLICY.messagesHours]
  );

  return { target: "messages", deleted: Number(result.rowCount || 0) };
}

async function cleanupOldCoachInteractions(pool) {
  if (!pool) return { target: "coach_interactions", deleted: 0 };

  const result = await pool.query(
    `
      DELETE FROM coach_interactions
      WHERE created_at_timestamp < NOW() - ($1::int * INTERVAL '1 hour');
    `,
    [RETENTION_POLICY.coachInteractionsHours]
  );

  return { target: "coach_interactions", deleted: Number(result.rowCount || 0) };
}

async function cleanupOldJournalEntries(pool) {
  if (!pool) return { target: "journal_entries", deleted: 0 };

  const result = await pool.query(
    `
      DELETE FROM journal_entries
      WHERE
        created_at_timestamp < NOW() - ($1::int * INTERVAL '1 hour')
        AND (retain_until_timestamp IS NULL OR retain_until_timestamp < NOW());
    `,
    [RETENTION_POLICY.journalEntriesHours]
  );

  return { target: "journal_entries", deleted: Number(result.rowCount || 0) };
}

async function runPrivacyCleanup(pool) {
  if (!pool) {
    return {
      ok: true,
      skipped: true,
      reason: "no_database_pool",
      summary: [],
      at: null,
    };
  }

  const summary = [];

  summary.push(await cleanupOldMessages(pool));
  summary.push(await cleanupOldCoachInteractions(pool));
  summary.push(await cleanupOldJournalEntries(pool));

  setLastCleanupAt(new Date());

  return {
    ok: true,
    skipped: false,
    summary,
    at: lastCleanupAt.toISOString(),
  };
}

async function runPrivacyCleanupSafe(pool, options = {}) {
  const force = options.force === true;
  const minIntervalMs = Number(options.minIntervalMs || 0);

  if (cleanupInFlight) {
    return cleanupInFlight;
  }

  if (!force && lastCleanupAt && minIntervalMs > 0) {
    const elapsedMs = Date.now() - lastCleanupAt.getTime();
    if (elapsedMs < minIntervalMs) {
      return {
        ok: true,
        skipped: true,
        reason: "too_soon",
        summary: [],
        at: lastCleanupAt.toISOString(),
      };
    }
  }

  cleanupInFlight = runPrivacyCleanup(pool)
    .catch((err) => {
      return {
        ok: false,
        skipped: false,
        reason: "cleanup_failed",
        error: String(err && err.message ? err.message : err),
        summary: [],
        at: lastCleanupAt ? lastCleanupAt.toISOString() : null,
      };
    })
    .finally(() => {
      cleanupInFlight = null;
    });

  return cleanupInFlight;
}

module.exports = {
  RETENTION_POLICY,
  CLEANUP_TARGETS,
  CLEANUP_INTERVAL_MS,
  getPrivacyStatus,
  runPrivacyCleanupSafe,
};
