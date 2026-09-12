const OWNERSHIP_MIGRATION_SQL = require("fs").readFileSync(
  require("path").join(__dirname, "migrations", "ownership-p0-b2.sql"),
  "utf8"
);

async function runOwnershipMigrations(pool) {
  if (!pool) {
    return { ok: true, skipped: true, reason: "no_database_pool" };
  }

  await pool.query(OWNERSHIP_MIGRATION_SQL);

  return {
    ok: true,
    skipped: false,
    applied: true,
  };
}

module.exports = {
  OWNERSHIP_MIGRATION_SQL,
  runOwnershipMigrations,
};
