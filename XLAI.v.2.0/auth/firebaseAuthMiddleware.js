"use strict";

function unauthorized(res) {
  return res.status(401).json({ error: "unauthorized" });
}

function authUnavailable(res) {
  return res.status(503).json({ error: "authentication_unavailable" });
}

function getBearerToken(req) {
  const authorization = req && req.headers ? req.headers.authorization : undefined;
  if (typeof authorization !== "string") {
    return null;
  }

  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match ? match[1] : null;
}

function createFirebaseAuthMiddleware({ getAuth }) {
  if (typeof getAuth !== "function") {
    throw new TypeError("createFirebaseAuthMiddleware requires a getAuth function.");
  }

  return async function firebaseAuthMiddleware(req, res, next) {
    const token = getBearerToken(req);
    if (!token) {
      return unauthorized(res);
    }

    let auth;
    try {
      auth = getAuth();
    } catch (_) {
      return authUnavailable(res);
    }

    if (!auth || typeof auth.verifyIdToken !== "function") {
      return authUnavailable(res);
    }

    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (_) {
      return unauthorized(res);
    }

    if (!decodedToken || typeof decodedToken.uid !== "string" || !decodedToken.uid) {
      return unauthorized(res);
    }

    req.user = { uid: decodedToken.uid };
    return next();
  };
}

module.exports = {
  createFirebaseAuthMiddleware,
};