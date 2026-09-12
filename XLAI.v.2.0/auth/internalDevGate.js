"use strict";

function isInternalDevEnabled(env = process.env) {
  return env.NODE_ENV === "development" && env.ENABLE_INTERNAL_DEV_ROUTES === "1";
}

function createInternalDevGate({ enabled = isInternalDevEnabled() } = {}) {
  return function internalDevGate(req, res, next) {
    if (!enabled) {
      return res.status(404).json({ error: "Not found" });
    }
    return next();
  };
}

module.exports = {
  createInternalDevGate,
  isInternalDevEnabled,
};