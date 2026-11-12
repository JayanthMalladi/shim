import express from "express";

// A referenced (non-inline) handler: a splat route handed to it is agent, because the function
// might read req.params[0] in another file the scan cannot see.
const controller = { get: (req, res) => res.json(req.params[0]) };

const app = express();
app.set('query parser', 'extended');
app.use(express.urlencoded({ extended: true })); // FLAG E3 (no options object: Express 4 defaulted to extended=true -> add { extended: true })
app.use(express.urlencoded({ limit: "1mb", extended: true })); // FLAG E3 (options without extended: add extended: true)
app.use(express.urlencoded({ extended: false })); // OK E3 (already sets extended; leave it)
app.use(express.json());

// --- E1: route strings that REG-THROW under path-to-regexp 8 (Express 5) ---
app.get('*splat', (req, res) => res.json({ ok: true }));                       // FLAG E1 (bare splat, no params read -> auto: '*splat')
app.get('/x/{*splat}', (req, res) => res.json({ ok: true }));                   // FLAG E1 (prefix splat, no params read -> auto: '/x/{*splat}')
app.get("/(.*)", (req, res) => res.json({ ok: true }));                  // FLAG E1-dead (dead route: matches nothing -> manual, unchanged)
app.get("/api/*", controller.get);                                        // FLAG E1-ref (referenced handler -> agent, unchanged)
app.get('/user{/:id}/edit', (req, res) => res.json(req.params.id));       // FLAG E1-optional (optional param -> '/user{/:id}/edit', auto)
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

// --- E5: res.status with a value Express 4 accepted but Express 5 rejects ---
app.get("/s1", (req, res) => res.status("200").send("x"));              // FLAG E5 (string status: throws at request time)
app.get("/s2", (req, res) => res.status(200).send("x"));               // OK E5 (integer literal in range)
app.get("/s3", (req, res) => res.status(404.5).send("x"));             // FLAG E5 (non-integer numeric literal)
app.get("/s4", (req, res) => res.status(`${code}`).send("x"));         // FLAG E5 (template literal)
app.get("/s5", (req, res) => res.status(String(404)).send("x"));       // FLAG E5 (String() result)
app.get("/s6", (req, res) => res.status((404).toString()).send("x"));  // FLAG E5 (.toString() result)
app.get("/s7", (req, res) => res.status(err.status).send("x"));        // OK E5 (identifier: writeHead rejects a bad integer in both versions)
app.get("/s8", (req, res) => res.status(code).send("x"));              // OK E5 (identifier: value not knowable statically)

// --- E6: req.host (Express 5 now includes the port) ---
app.get("/h", (req, res) => res.json({ host: req.host }));             // FLAG E6 (req.host: now with port)
app.get("/h2", (req, res) => res.json({ host: req.hostname }));       // OK E6 (req.hostname: unchanged)

// --- E7: res.clearCookie with maxAge/expires (ignored by Express 5) ---
app.get("/c", (req, res) => res.clearCookie("a", { maxAge: 1000 }));    // FLAG E7 (maxAge ignored by Express 5)
app.get("/c2", (req, res) => res.clearCookie("a", { path: "/" }));     // OK E7 (other clearCookie options are still valid)

export default app;
