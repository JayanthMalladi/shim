// E4b.8: Express 4 vs Express 5 route-matching oracle.
//
// For each deterministic route rewrite in src/rules/express-v5.ts, register the ORIGINAL
// Express 4 route on an express4 app and the REWRITTEN Express 5 route on an express5 app,
// listen both on 127.0.0.1 port 0, GET the same set of paths against both, and assert the
// two status-code arrays are identical: the rewrite must preserve which requests match.
//
// express4 = express@4.22.3, express5 = express@5.3.0, installed via the npm devDependency
// aliases `express4@npm:express@4.22.3` and `express5@npm:express@5.3.0` (mirroring the
// zod3/zod4 oracle aliases). The alias mechanism gives real packages named "express4" and
// "express5" under node_modules, so the import specifiers are "express4" and "express5".
// Both are CJS packages whose module.exports is the app factory, so the default import is
// the factory. Everything runs in-process on 127.0.0.1 — no network at test time.

import { describe, expect, it } from "vitest";
import * as http from "node:http";
import express4 from "express4";
import express5 from "express5";

// One non-keep-alive agent: each GET's connection closes after the response, so the
// servers' close() resolves promptly and vitest exits with no dangling handles.
const agent = new http.Agent({ keepAlive: false });

// The only handler, on both apps: a bare 200, so the status arrays reflect ROUTE MATCHING
// (did the route match at all?), not handler behavior.
const ok = (_req: unknown, res: { send: (body?: unknown) => unknown }) => res.send("ok");

function get(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http.get(url, { agent }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject);
  });
}

// Resolve the port once a server (listening on port 0) is actually up.
function waitingPort(server: any): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server.listening) return resolve(server.address().port);
    server.once("listening", () => resolve(server.address().port));
    server.once("error", reject);
  });
}

// Close a server, terminating idle connections so close() cannot wait.
function close(server: any): Promise<void> {
  return new Promise((resolve) => {
    if (server.listening) server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

// Register the original route on an Express 4 app and the rewrite on an Express 5 app,
// listen both on 127.0.0.1 port 0, GET the same paths against both, and assert the
// status-code arrays are identical (and that the original really does match every path).
async function oracle(v4Route: string, v5Route: string, paths: string[]) {
  const app4 = express4();
  const app5 = express5();
  app4.get(v4Route, ok);
  app5.get(v5Route, ok);
  const s4 = app4.listen(0, "127.0.0.1");
  const s5 = app5.listen(0, "127.0.0.1");
  try {
    const p4 = await waitingPort(s4);
    const p5 = await waitingPort(s5);
    const v4Statuses: number[] = [];
    const v5Statuses: number[] = [];
    for (const p of paths) v4Statuses.push(await get(`http://127.0.0.1:${p4}${p}`));
    for (const p of paths) v5Statuses.push(await get(`http://127.0.0.1:${p5}${p}`));
    expect(v4Statuses).toEqual(paths.map(() => 200)); // the v4 original matches every path
    expect(v5Statuses).toEqual(v4Statuses); // the v5 rewrite matches the same request set
  } finally {
    await close(s4);
    await close(s5);
  }
}

describe("express oracle: v4 original vs v5 rewrite (E4b.8)", () => {
  it("'*' -> '*splat' keeps the same request set", () =>
    oracle("*", "*splat", ["/", "/a", "/a/b"]));

  it("'/*' -> '/{*splat}' keeps the same request set", () =>
    oracle("/*", "/{*splat}", ["/", "/a/b"]));

  // Braces REQUIRED: the unbraced '/x/*splat' is one-or-more and 404s on the bare '/x/'.
  it("'/x/*' -> '/x/{*splat}' (braces required) keeps the same request set", () =>
    oracle("/x/*", "/x/{*splat}", ["/x/", "/x/a", "/x/a/b"]));

  it("'/user/:id?/edit' -> '/user{/:id}/edit' keeps the same request set", () =>
    oracle("/user/:id?/edit", "/user{/:id}/edit", ["/user/edit", "/user/5/edit"]));
});
