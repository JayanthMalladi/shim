import express from "express";

// A referenced (non-inline) handler: a splat route handed to it is agent, because the function
// might read req.params[0] in another file the scan cannot see.
const controller = { get: (req, res) => res.json(req.params[0]) };

const app = express();
app.use(express.urlencoded()); // FLAG E3 (no options object: Express 4 defaulted to extended=true -> add { extended: true })
app.use(express.urlencoded({ limit: "1mb" })); // FLAG E3 (options without extended: add extended: true)
app.use(express.urlencoded({ extended: false })); // OK E3 (already sets extended; leave it)
app.use(express.json());

// --- E1: route strings that REG-THROW under path-to-regexp 8 (Express 5) ---
app.get("*", (req, res) => res.json({ ok: true }));                       // FLAG E1 (bare splat, no params read -> auto: '*splat')
app.get("/x/*", (req, res) => res.json({ ok: true }));                   // FLAG E1 (prefix splat, no params read -> auto: '/x/{*splat}')
app.get("/(.*)", (req, res) => res.json({ ok: true }));                  // FLAG E1-dead (dead route: matches nothing -> manual, unchanged)
app.get("/api/*", controller.get);                                        // FLAG E1-ref (referenced handler -> agent, unchanged)
app.get("/user/:id?/edit", (req, res) => res.json(req.params.id));       // FLAG E1-optional (optional param -> '/user{/:id}/edit', auto)
app.get("/user/:id(\\d+)", (req, res) => res.json(req.params.id));       // FLAG E1-regex (regex-constrained param -> agent)
app.get("/a(bc)?d", (req, res) => res.json({ ok: true }));               // FLAG E1-literal (literal ()/? in a path -> agent)
// Not flagged: a plain named param, a RegExp route, and an array route all match identically in Express 5.
app.get("/user/:id", (req, res) => res.json(req.params.id));             // OK E1 (plain named param)
app.get(/\/legacy\/\d+/, (req, res) => res.json({ ok: true }));          // OK E1 (RegExp route: unchanged)
app.get(["/a", "/b"], (req, res) => res.json({ ok: true }));             // OK E1 (array route: unchanged)

// --- E11: res.sendfile removed in Express 5 (a bare rename 500s on relative paths) ---
app.get("/f", (req, res) => res.sendfile("f.txt"));                      // FLAG E11 (sendfile -> agent)

// --- E2: req.query read, no app.set('query parser', ...) in this file ---
app.get("/search", (req, res) => res.json({ q: req.query.q }));         // FLAG E2 (insert app.set('query parser','extended') after app creation)

// --- E4: req.body read while a body parser IS mounted on this app ---
app.get("/profile", (req, res) => res.json({ name: req.body.name }));   // OK E4 (a parser is mounted; not flagged)

// --- E5: res.status with a non-integer argument ---
app.get("/s1", (req, res) => res.status("200").send("x"));              // FLAG E5 (string status: throws at request time)
app.get("/s2", (req, res) => res.status(200).send("x"));               // OK E5 (integer literal in range)

// --- E6: req.host (Express 5 now includes the port) ---
app.get("/h", (req, res) => res.json({ host: req.host }));             // FLAG E6 (req.host: now with port)
app.get("/h2", (req, res) => res.json({ host: req.hostname }));       // OK E6 (req.hostname: unchanged)

// --- E7: res.clearCookie with maxAge/expires (ignored by Express 5) ---
app.get("/c", (req, res) => res.clearCookie("a", { maxAge: 1000 }));    // FLAG E7 (maxAge ignored by Express 5)
app.get("/c2", (req, res) => res.clearCookie("a", { path: "/" }));     // OK E7 (other clearCookie options are still valid)

export default app;
