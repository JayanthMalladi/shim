// CJS: require("express") + a Router. No body parser is mounted on this router, so a req.body
// read here is flagged by E4. A Map's .get("*") must NOT be flagged by E1 (it is not an Express route).
const express = require("express");
const router = express.Router();

const cache = new Map();
cache.get("*"); // OK E1 (a Map.get with a star key: not an Express route, not flagged)

// A bare-splat route with no req.params read: auto-rewritten to a named splat.
router.get('*splat', (req, res) => res.json({ ok: true })); // FLAG E1 (router splat, no params read -> auto)

// E4: req.body read with no json/urlencoded parser mounted on this router -> report only.
router.get("/save", (req, res) => { res.json({ name: req.body.name }); }); // FLAG E4 (body read, no parser -> report)

module.exports = router;
