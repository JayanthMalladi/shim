import type { PackManifest } from "../../types.js";

/**
 * S05: the declarative record of "this Express 4 -> 5 change breaks this code". One entry per
 * ruleId the express-v5 scan path emits: the twelve rules in src/rules/express-v5.ts plus the three
 * package.json / CI hooks the express-v5 entry in src/migrations.ts adds — express-related-package,
 * express-node-floor, and the floor-18 flavor of ci-node-version. The pipeline codemod-guard rule
 * (express-codemod-del-clobber) attaches in src/pipeline.ts, not the scan path, so it is NOT here.
 * Descriptive only: the scanner keeps producing byte-identical findings. `source` is the Express 5
 * upgrade guide (https://expressjs.com/en/guide/migrating-5.html) section each rule encodes; where
 * no official section exists it says so rather than inventing one.
 */
export const expressV5: PackManifest = {
  id: "express-v5",
  package: "express",
  from: "^4.0.0",
  to: "^5.0.0",
  rules: [
    {
      id: "express-splat-param",
      severity: "break",
      fix: "auto",
      change: "A bare `*`/`/*`/`/x/*` wildcard route REG-THROWS under path-to-regexp 8; rewrite to a braced named splat.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: path route matching syntax (the wildcard must have a name)",
      fixtures: [
        "test/fixtures/express4-app/src/app.ts",
        "test/fixtures/express4-app/src/routes.js",
      ],
    },
    {
      id: "express-optional-param",
      severity: "break",
      fix: "auto",
      change: "An optional named-param segment (`/:id?`) REG-THROWS in Express 5; rewrite to a single `{/:id}` route.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: path route matching syntax (the `?` optional is no longer supported)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-regex-param",
      severity: "break",
      fix: "agent",
      change: "A regex-constrained param (`:id(\\d+)`) has no v8 spelling and REG-THROWS; use a plain param and guard in-handler.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: path route matching syntax (regexp characters are not supported)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-literal-special",
      severity: "break",
      fix: "agent",
      change: "Literal `+`/`?`/`()` in a path were regex metacharacters in v4; in v5 they REG-THROW as reserved characters.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: path route matching syntax (some characters are now reserved)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-urlencoded-extended",
      severity: "silent",
      fix: "auto",
      change: "`urlencoded()`/`bodyParser.urlencoded()` default to extended=true in v4 but simple in v5; add `extended: true` to keep nested/array bodies.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: express.urlencoded (the extended option is now false by default)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-query-parser",
      severity: "silent",
      fix: "auto",
      change: "Express 5's default query parser is 'simple' (flat keys); v4 used 'extended' (nested/array) — set `app.set('query parser', 'extended')`.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: req.query (the default query parser changed from extended to simple)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-status-code",
      severity: "silent",
      fix: "manual",
      change: "`res.status(<non-integer>)` throws at request time in Express 5; v4 coerced it with a deprecation warning.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: res.status (only accepts integers 100-999)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-req-host",
      severity: "silent",
      fix: "manual",
      change: "`req.host` now returns the full Host header including the port; use `req.hostname` for the port-less value.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: req.host (Express 5 maintains the port, Express 4 stripped it)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-clearcookie-maxage",
      severity: "silent",
      fix: "manual",
      change: "`res.clearCookie(name, { maxAge | expires })` ignores those options in Express 5 and always expires the cookie.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: res.clearCookie (ignores the maxAge and expires options)",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-async-errors",
      severity: "break",
      fix: "auto",
      change: "`express-async-errors` is redundant on Express 5 (the router already forwards async rejections) and its `require` throws at startup; drop the side-effect import.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Changed: rejected promises are now handled from middleware and handlers (the router forwards async rejections). NO SOURCE for the express-async-errors package-specific half: the guide never names the package or its startup throw — that is an ecosystem note, not an Express-doc statement.",
      fixtures: ["test/fixtures/express4-app/src/routes.js"],
    },
    {
      id: "express-sendfile",
      severity: "break",
      fix: "agent",
      change: "`res.sendfile()` was removed in Express 5; replace with `res.sendFile(path.resolve(p))` (a bare rename of a relative path 500s).",
      source: "https://expressjs.com/en/guide/migrating-5.html — Removed: res.sendfile()",
      fixtures: ["test/fixtures/express4-app/src/app.ts"],
    },
    {
      id: "express-query",
      severity: "break",
      fix: "agent",
      change: "`express.query(fn)` global parser registration was removed in Express 5; set the query parser on the app/router instead.",
      source: "NO SOURCE FOUND — the Express 5 upgrade guide (https://expressjs.com/en/guide/migrating-5.html) does not mention the removal of `express.query()`; its `req.query` section covers only the parser default.",
      // No fixture trigger and no test assertion: a documented gap (listed in the PR body), not an invented path.
      fixtures: [],
    },
    {
      id: "express-related-package",
      severity: "break",
      fix: "manual",
      change: "A related package (express-rate-limit, express-promise-router, swagger-ui-express, http-proxy-middleware, express-async-errors) is pinned below the Express-5-compatible major.",
      source: "NO SOURCE in the Express 5 upgrade guide — the per-package bump guidance lives in the @expressjs/codemod recipe (https://codemod.link/express), not in migrating-5.html.",
      fixtures: ["test/fixtures/express4-app/package.json"],
    },
    {
      id: "express-node-floor",
      severity: "break",
      fix: "manual",
      change: "Express 5's Node floor is 18; an express-dep package.json with `engines.node` below 18 goes red.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Installation (Node.js 18 or higher)",
      fixtures: ["test/fixtures/express4-app/package.json"],
    },
    {
      id: "ci-node-version",
      severity: "break",
      fix: "auto",
      change: "The Express 5 flavor rewrites CI Node pins below 18 (the Express floor) to 18 — the floor-18 form of the shared ci-node-version rule.",
      source: "https://expressjs.com/en/guide/migrating-5.html — Installation (Node.js 18 or higher). The CI workflow rewrite is a Shim addition; the doc states only the floor.",
      // No fixture: express4-app has no .github/workflows, so the floor-18 flavor has no fixture case (documented gap).
      fixtures: [],
    },
  ],
};
