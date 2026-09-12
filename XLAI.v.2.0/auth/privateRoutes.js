"use strict";

const AUTHENTICATED_USER_ROUTES = Object.freeze([
  "POST /api/analyze-intensity",
  "POST /api/rephrase",
  "POST /api/send",
  "POST /api/conversations",
  "POST /api/coach-interactions",
  "POST /api/journal-entries",
  "GET /api/journal-entries",
  "GET /api/history",
  "GET /api/behavior-feedback",
  "GET /api/conversations",
  "GET /api/messages",
  "POST /api/messages",
  "GET /api/coach-interactions",
  "GET /api/interaction-timeline",
  "GET /api/pattern-summary",
]);

const INTERNAL_DEV_ROUTES = Object.freeze([
  "GET /api/db-health",
  "GET /api/privacy-status",
  "POST /api/privacy-cleanup",
]);

const PRIVATE_API_ROUTES = Object.freeze([
  ...AUTHENTICATED_USER_ROUTES,
  ...INTERNAL_DEV_ROUTES,
]);

const AUTHENTICATED_USER_ROUTE_SET = new Set(AUTHENTICATED_USER_ROUTES);
const INTERNAL_DEV_ROUTE_SET = new Set(INTERNAL_DEV_ROUTES);

function isPrivateApiRoute(method, path) {
  const route = `${String(method).toUpperCase()} ${path}`;
  return AUTHENTICATED_USER_ROUTE_SET.has(route) || INTERNAL_DEV_ROUTE_SET.has(route);
}

function isInternalDevRoute(method, path) {
  return INTERNAL_DEV_ROUTE_SET.has(`${String(method).toUpperCase()} ${path}`);
}

module.exports = {
  AUTHENTICATED_USER_ROUTES,
  INTERNAL_DEV_ROUTES,
  PRIVATE_API_ROUTES,
  isInternalDevRoute,
  isPrivateApiRoute,
};