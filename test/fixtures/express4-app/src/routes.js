// CJS: require("express") + a Router. A Map's .get("*") must NOT be flagged by E1 (it is not an
// Express route).
const express = require("express");
const router = express.Router();

const cache = new Map();
cache.get("*"); // OK E1 (a Map.get with a star key: not an Express route, not flagged)

// A bare-splat route with no req.params read: auto-rewritten to a named splat.
router.get("*", (req, res) => res.json({ ok: true })); // FLAG E1 (router splat, no params read -> auto)

// ':name(*)' splat-constraint: never auto (req.params.name becomes an array). -> agent, unchanged.
router.get("/files/:path(*)", (req, res) => res.json(req.params.path)); // FLAG E1-constrained (':path(*)' -> agent)

// F9: a bare side-effect require of express-async-errors -> auto: the statement is removed.
// FLAG E8 (removed in Express 5; auto-deleted)
require("express-async-errors");

module.exports = router;
