"use strict";

const { randomUUID } = require("node:crypto");

function identityResolutionUnavailable(res) {
  return res.status(503).json({ error: "identity_resolution_unavailable" });
}

function accessPending(res) {
  return res.status(403).json({ error: "access_pending" });
}

function accessDenied(res) {
  return res.status(403).json({ error: "access_denied" });
}

function invalidIdentity(res) {
  return res.status(401).json({ error: "unauthorized" });
}

function createInternalUserResolver({ getPool, generateId = randomUUID } = {}) {
  if (typeof getPool !== "function") {
    throw new TypeError("createInternalUserResolver requires a getPool function.");
  }
  if (typeof generateId !== "function") {
    throw new TypeError("createInternalUserResolver requires a generateId function.");
  }

  return async function internalUserResolver(req, res, next) {
    const firebaseUid = req && req.user && req.user.uid;
    if (typeof firebaseUid !== "string" || !firebaseUid.trim()) {
      return invalidIdentity(res);
    }

    const pool = getPool();
    if (!pool || typeof pool.query !== "function") {
      return identityResolutionUnavailable(res);
    }

    try {
      const inserted = await pool.query(
        `
          INSERT INTO internal_users (id, firebase_uid, status)
          VALUES ($1, $2, 'pending')
          ON CONFLICT (firebase_uid) DO NOTHING
          RETURNING id, firebase_uid, status;
        `,
        [generateId(), firebaseUid]
      );

      const result = inserted.rows && inserted.rows[0]
        ? inserted
        : await pool.query(
          `
            SELECT id, firebase_uid, status
            FROM internal_users
            WHERE firebase_uid = $1;
          `,
          [firebaseUid]
        );

      const user = result.rows && result.rows[0];
      if (!user || typeof user.id !== "string" || user.firebase_uid !== firebaseUid) {
        return identityResolutionUnavailable(res);
      }

      if (user.status === "pending") {
        return accessPending(res);
      }
      if (user.status === "disabled") {
        return accessDenied(res);
      }
      if (user.status !== "active") {
        return identityResolutionUnavailable(res);
      }

      try {
        await pool.query(
          `
            UPDATE internal_users
            SET last_sign_in_at = NOW()
            WHERE id = $1;
          `,
          [user.id]
        );
      } catch (_) {
        // Sign-in telemetry is non-authoritative; keep the active request available.
      }

      req.xlaiUser = {
        id: user.id,
        firebaseUid: user.firebase_uid,
        status: user.status,
      };
      return next();
    } catch (_) {
      return identityResolutionUnavailable(res);
    }
  };
}

module.exports = {
  createInternalUserResolver,
};