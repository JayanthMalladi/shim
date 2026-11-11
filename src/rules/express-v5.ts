/**
 * Express 4 -> 5 rules that the official codemod (@expressjs/codemod) and the type checker do not
 * cover. Most of the route-string breaks are startup throws (path-to-regexp 0.1 -> 8); the rest are
 * silent runtime deltas (query parser, clearCookie, host, status). See docs/CATALOG (A-routing,
 * B-runtime, C-tooling). Static only: no type-checker calls, matching scanZodV4's shape.
 *
 * Only files that import/require "express" (or are handed an Express Router) are scanned, mirroring
 * scanZodV4's "import from exactly zod" gate.
 */
import fs from "node:fs";
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Node as TmNode,
  type ObjectLiteralExpression,
  type Project,
  type SourceFile,
} from "ts-morph";
import type { RuleContext } from "./ai-sdk-v7.js";
import type { Finding, FixKind, Severity } from "../types.js";
import { findPackageJsons, readJson } from "../scan.js";
import { allowsMajor } from "../bump.js";

/** Method names whose first argument is a route string. */
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "use", "all", "del"]);

/**
 * A bare `*`/`/*`/`/x/*` splat in its v4 form, and its v5 braced rewrite. Braces are required in
 * path-to-regexp 8: `'/x/*'` does NOT become `'/x/*splat'` (that 404s on `'/x/'`), it becomes
 * `'/x/{*splat}'` (F1/F4).
 */
function splatRewrite(route: string): string | undefined {
  if (route === "*") return "*splat";
  if (route === "/*") return "/{*splat}";
  // '/<prefix>/*' (but not the bare '/*' handled above) -> '/<prefix>/{*splat}'.
  const m = route.match(/^\/([^\/*]*)\/\*$/);
  if (m && m[1] !== "") return `/${m[1]}/{*splat}`;
  return undefined;
}

/** True when a v4 route string REG-THROWS under path-to-regexp 8 and has a simple v5 spelling. */
const isSplat = (r: string) => splatRewrite(r) !== undefined;

/**
 * F3: v4 `'/(.*)'` is a dead route — it matches nothing (404 on `/` and `/a/b` alike). Rewriting it
 * to a live braced splat would change which paths match, so leave it and report it as manual.
 */
const isDeadSplat = (r: string) => r === "/(.*)";

/**
 * F4: a v4 `:name(*)` splat-constraint segment at the end of a route, e.g. '/files/:path(*)'. Never
 * auto-rewritten: in Express 5 the handler's `req.params.<name>` (a string) becomes an array (or
 * undefined) under the braced splat, so the rewrite and every `req.params` read are handed to the
 * agent together.
 */
const hasConstrainedSplatParam = (r: string) => /(^|\/):[a-zA-Z_]\w*\(\*\)$/m.test(r);
const constrainedSplatName = (r: string) => r.match(/:([a-zA-Z_]\w*)\(\*\)$/)?.[1] ?? "path";

/** Optional named-param modifier: ':id?' -> agent (no single v5 string; split into two routes). */
const hasOptionalParam = (r: string) => /(^|\/):[a-zA-Z_]\w*\?/.test(r) && !isSplat(r);
/** Custom-regex named-param ':id(\d+)': agent (no v8 constraint form; guard in-handler with next('route')). */
const hasCustomRegexParam = (r: string) => /:\w+\([^)]+\)/.test(r) && !isSplat(r) && !hasConstrainedSplatParam(r) && r !== "/(.*)";
/**
 * F7: '+'/'?'/'()' characters in a path that are not a named-param token. In Express 4 these were
 * regex metacharacters (path-to-regexp 0.1), so a route like '/ab+cd' was a pattern; path-to-regexp
 * 8 treats them as token modifiers, so the route REG-THROWS in Express 5.
 */
const hasLiteralSpecial = (r: string) => {
  if (isSplat(r) || hasOptionalParam(r) || hasCustomRegexParam(r) || hasConstrainedSplatParam(r)) return false;
  const stripped = r.replace(/:\w+\([^)]*\)/g, "").replace(/:\w+/g, "");
  return /[+?()]/.test(stripped);
};

/**
 * A splat rewrite is safe to auto-apply only when every handler argument of the call (all arguments
 * after the route string) is an inline function (arrow or function expression) AND none of them
 * reads `req.params` at all. Any referenced handler (`controller.get`, an imported function, a plain
 * identifier) must be `agent` — the function may read `req.params[0]` in another file, which this
 * scan cannot see.
 */
function splatHandlersAreInlineAndParamsFree(call: CallExpression): boolean {
  const args = call.getArguments();
  if (args.length < 2) return false; // no handler arg at all: nothing to check, stay safe
  for (const h of args.slice(1)) {
    if (!Node.isArrowFunction(h) && !Node.isFunctionExpression(h)) return false;
    let readsParams = false;
    h.forEachDescendant((n) => {
      if (readsParams) return;
      if (Node.isPropertyAccessExpression(n) && n.getName() === "params") readsParams = true;
      else if (Node.isElementAccessExpression(n)) {
        const recv = n.getExpression();
        if (Node.isPropertyAccessExpression(recv) && recv.getName() === "params") readsParams = true;
      }
    });
    if (readsParams) return false;
  }
  return true;
}

/**
 * F5: the deterministic optional-param rewrite. A standard `/:name?` segment (the `?` followed by
 * `/` or end-of-route) becomes a braced `{/:name}`. `'/user/:id?/edit'` -> `'/user{/:id}/edit'`,
 * `'/p/:slug?'` -> `'/p{/:slug}'`. Returns undefined when a `?` is present but not in that standard
 * segment position (the agent handles the non-standard placement).
 */
function optionalParamRewrite(route: string): string | undefined {
  const segRe = /\/:([a-zA-Z_]\w*)\?(?=\/|$)/g;
  let found = false;
  const out = route.replace(segRe, (_all, name) => {
    found = true;
    return `{/:${name}}`;
  });
  if (!found) return undefined; // no standard segment (either no '?', or a non-standard placement)
  return out;
}

/**
 * Identifiers that refer to an Express app or Router: the default/namespace `express` import or
 * `require`, a `Router` import, and any variable initialized to `express()`, `express.Router()`,
 * `Router()` or a prior router. Plus the conventional `app`/`router` names so `mountRouter(r)`-
 * style code is still covered in a file that imports express.
 */
function expressRouters(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  const add = (n?: string) => {
    if (n) names.add(n);
  };
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== "express") continue;
    add(decl.getDefaultImport()?.getText());
    add(decl.getNamespaceImport()?.getText());
    for (const spec of decl.getNamedImports()) if (spec.getName() === "Router") names.add(spec.getAliasNode()?.getText() ?? "Router");
  }
  // CJS: `const express = require("express")` and `const { Router } = require("express")`.
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getExpression().getText() === "require") {
      const arg = c.getArguments()[0];
      if (Node.isStringLiteral(arg) && (arg.getLiteralValue() === "express")) {
        const decl = c.getParent();
        if (Node.isVariableDeclaration(decl)) {
          const nameNode = decl.getNameNode();
          add(nameNode.getText());
          // `const { Router } = require("express")`
          if (Node.isObjectBindingPattern(nameNode)) for (const el of nameNode.getElements()) add(el.getName());
        }
      }
    }
  }
  // Variables initialized to an express app/router.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (!init) continue;
    const name = decl.getNameNode();
    if (!Node.isIdentifier(name)) continue;
    let base: TmNode = init;
    while (Node.isCallExpression(base) || Node.isPropertyAccessExpression(base)) base = base.getExpression();
    if (Node.isIdentifier(base) && (base.getText() === "express" || base.getText() === "Router")) add(name.getText());
  }
  // Conventional names, only in files that import/require express (the caller gates on this).
  for (const n of ["app", "router", "Router"]) names.add(n);
  return names;
}

/** True when this file imports or requires "express" (the gate; mirrors zod's "import from zod"). */
function importsExpress(sf: SourceFile): boolean {
  for (const decl of sf.getImportDeclarations()) if (decl.getModuleSpecifierValue() === "express") return true;
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getExpression().getText() === "require") {
      const a = c.getArguments()[0];
      if (Node.isStringLiteral(a) && a.getLiteralValue() === "express") return true;
    }
  }
  return false;
}

/**
 * The nearest package.json (walking up from the file) and the `express` range it depends on, across
 * dependencies / devDependencies / peerDependencies.
 */
function nearestExpressRange(file: string, root: string): string | undefined {
  let dir = path.dirname(path.resolve(file));
  const base = path.resolve(root);
  while (true) {
    const pj = path.join(dir, "package.json");
    if (fs.existsSync(pj)) {
      const pkg = readJson(pj);
      const range = pkg?.dependencies?.express ?? pkg?.devDependencies?.express ?? pkg?.peerDependencies?.express;
      if (typeof range === "string") return range;
    }
    if (dir === base) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * True when the file's nearest express-depending package.json is already on Express 5. Those files
 * are not part of the upgrade — they keep their current v5 behavior — so neither a finding nor an
 * auto-fix may be written into them (a v4-only repo would still be scanned and fixed as usual).
 */
function alreadyOnExpress5(file: string, root: string): boolean {
  const range = nearestExpressRange(file, root);
  if (range === undefined) return false; // no package.json depending on express: part of the main upgrade
  const isOldMajor = (r: string) => allowsMajor(r, 4) && !allowsMajor(r, 5);
  return !isOldMajor(range);
}

/** The route-string argument of a route call, when it is a plain string literal. */
function routeStringArg(call: CallExpression): { text: string; node: TmNode } | undefined {
  const first = call.getArguments()[0];
  if (!first || !Node.isStringLiteral(first)) return undefined;
  return { text: first.getLiteralValue(), node: first };
}

function checkRouteStrings(ctx: RuleContext, sf: SourceFile) {
  const routers = expressRouters(sf);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e)) continue;
    const method = e.getName();
    if (!ROUTE_METHODS.has(method)) continue;
    const recv = e.getExpression();
    if (!Node.isIdentifier(recv) || !routers.has(recv.getText())) continue; // a non-express .get('*') (Map, axios) is not flagged
    const r = routeStringArg(call);
    if (!r) continue;
    const route = r.text;

    // F3: a dead v4 wildcard route — matches nothing, so leaving it is behavior-preserving.
    if (isDeadSplat(route)) {
      add(ctx, r.node, "express-splat-param", "break", "manual",
        "This wildcard route is a dead route in Express 4: '/(.*)' matched nothing at runtime. Rewriting it to a " +
        "live braced splat would change which paths match, so leave it as-is.");
      continue;
    }
    // F1/F2: bare `*`/`/*`/`/x/*` splat. Auto-rewrite only when the handlers are all inline and
    // never read req.params; otherwise hand it to the agent with the exact braced spelling.
    if (isSplat(route)) {
      if (splatHandlersAreInlineAndParamsFree(call)) {
        add(ctx, r.node, "express-splat-param", "break", "auto",
          "This wildcard route REG-THROWS in Express 5 (path-to-regexp 8 dropped the unnamed splat). Rewrote it to a " +
          "braced named splat; the matched paths are unchanged.");
        ctx.edits.push({ node: r.node, text: `'${splatRewrite(route)}'` });
      } else {
        add(ctx, r.node, "express-splat-param", "break", "agent",
          "This wildcard route REG-THROWS in Express 5 (path-to-regexp 8 has no unnamed splat). Rewrite it to a " +
          "braced named splat ('/<prefix>/{*splat}'; a bare '*splat' 404s on '/x/') and read " +
          "(req.params.splat ?? []).join('/') instead of the old req.params[0] string. Add a leading '/' only for " +
          "the bare '*' form, keeping the matched paths identical.");
      }
      continue;
    }
    // F4: a trailing ':name(*)' splat-constraint, e.g. '/files/:path(*)'. The v5 braced splat turns
    // req.params.name into an array (or undefined on the bare prefix), so the fix needs both the route
    // rewrite and every params read changed — that is the agent's call.
    if (hasConstrainedSplatParam(route)) {
      const name = constrainedSplatName(route);
      const prefix = route.slice(0, route.lastIndexOf(":"));
      add(ctx, r.node, "express-splat-param", "break", "agent",
        "This ':name(*)' splat-constraint REG-THROWS in Express 5. Rewrite the route to '" + prefix + "{*" + name +
        "}' and read (req.params." + name + " ?? []).join('/') wherever req.params." + name + " is read " +
        "(it becomes an array, or undefined on the bare prefix), keeping the matched paths identical.");
      continue;
    }
    // F5: a standard optional param ':name?' auto-rewrites to a single '{/:name}' route.
    if (hasOptionalParam(route)) {
      const rewrite = optionalParamRewrite(route);
      if (rewrite !== undefined) {
        add(ctx, r.node, "express-optional-param", "break", "auto",
          "path-to-regexp 8 dropped the optional ':' param modifier; this route REG-THROWS in Express 5. Rewrote " +
          "the optional segment to a single '{/:name}' route so the matched set is unchanged.");
        ctx.edits.push({ node: r.node, text: `'${rewrite}'` });
      } else {
        add(ctx, r.node, "express-optional-param", "break", "agent",
          "path-to-regexp 8 dropped the optional ':' param modifier; this route REG-THROWS in Express 5 and its " +
          "'?' is not in the standard single-segment position, so register two routes with the same handler " +
          "(the path with and without the param) to keep the matched set.");
      }
      continue;
    }
    // F6: a regex-constrained named param. In v4 a non-match fell through to the next route, so the
    // guard must next('route'), never an error.
    if (hasCustomRegexParam(route)) {
      const name = route.match(/:([a-zA-Z_]\w*)\(/)?.[1] ?? "id";
      add(ctx, r.node, "express-regex-param", "break", "agent",
        "path-to-regexp 8 has no form for a regex-constrained named param; this route REG-THROWS in Express 5. " +
        "Use a plain ':name' and enforce the constraint in the handler; when the value does not match, " +
        "return next('route') (never next() with an error), because Express 4 fell through to the next route. " +
        "e.g. if (!/^\\d+$/.test(req.params." + name + ")) return next('route');");
      continue;
    }
    // F7: literal '+'/'?'/'()' were regex metacharacters in Express 4, so these were patterns, not
    // literal paths.
    if (hasLiteralSpecial(route)) {
      add(ctx, r.node, "express-literal-special", "break", "agent",
        "In Express 4, '+'/'?'/'()' inside a route were regex metacharacters (a pattern, e.g. '/ab+cd' matched " +
        "'/abbcd'), not literal path characters; path-to-regexp 8 treats them as token modifiers, so this route " +
        "REG-THROWS in Express 5. Replace it with a RegExp route that matches the same paths, or leave it for the " +
        "maintainer.");
    }
  }
}

/**
 * The identifiers bound to the express module itself: the default import, a namespace import, or a
 * plain `const express = require("express")`. Calling any of them with no argument returns an app
 * that has `.set`; a `Router` named import or `express.Router()` returns a Router with no `.set`, so
 * those are deliberately not in this set (a Router must be configured on the app that mounts it).
 */
function expressAppBindings(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== "express") continue;
    const def = decl.getDefaultImport();
    if (def) names.add(def.getText());
    const ns = decl.getNamespaceImport();
    if (ns) names.add(ns.getText());
  }
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getExpression().getText() !== "require") continue;
    const a = c.getArguments()[0];
    if (Node.isStringLiteral(a) && a.getLiteralValue() === "express") {
      const decl = c.getParent();
      if (Node.isVariableDeclaration(decl)) {
        const nn = decl.getNameNode();
        if (Node.isIdentifier(nn)) names.add(nn.getText()); // a destructuring is not the app binding
      }
    }
  }
  return names;
}

/**
 * The first `const app = express()` statement whose callee is the express default/namespace binding
 * (verified against expressAppBindings, so `const router = Router()` never matches: a Router has no
 * `.set` and the insert would crash at startup). Returns the VariableStatement and the app variable
 * name.
 */
function appCreation(sf: SourceFile, appBindings: Set<string>) {
  for (const stmt of sf.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const callee = init.getExpression();
      const calleeName = Node.isIdentifier(callee) ? callee.getText() : null;
      if (calleeName && appBindings.has(calleeName)) return { stmt, appName: decl.getNameNode().getText() };
    }
  }
  return undefined;
}

function checkUrlencoded(ctx: RuleContext, sf: SourceFile) {
  const names = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    const mod = decl.getModuleSpecifierValue();
    if (mod === "express" || mod === "express/lib/middleware" || mod === "body-parser") {
      for (const spec of decl.getNamedImports()) names.add(spec.getAliasNode()?.getText() ?? spec.getName());
      const ns = decl.getNamespaceImport();
      if (ns) names.add(ns.getText());
      // default import of express: express.urlencoded is via the default binding.
      const def = decl.getDefaultImport();
      if (def && mod === "express") names.add(def.getText());
    }
  }
  // CJS require of express / body-parser.
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getExpression().getText() !== "require") continue;
    const a = c.getArguments()[0];
    if (!Node.isStringLiteral(a)) continue;
    const mod = a.getLiteralValue();
    if (mod === "express" || mod === "body-parser") {
      const decl = c.getParent();
      if (Node.isVariableDeclaration(decl)) {
        const nn = decl.getNameNode();
        if (Node.isIdentifier(nn)) names.add(nn.getText());
        else if (Node.isObjectBindingPattern(nn)) for (const el of nn.getElements()) names.add(el.getName());
      }
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "urlencoded") continue;
    const recv = e.getExpression();
    if (!Node.isIdentifier(recv) || !names.has(recv.getText())) continue;
    const arg0 = call.getArguments()[0];
    if (!arg0 || !Node.isObjectLiteralExpression(arg0)) {
      // No options object: Express 4 defaulted to extended=true, so add it explicitly.
      add(ctx, call, "express-urlencoded-extended", "silent", "auto",
        "express.urlencoded() / bodyParser.urlencoded() default to extended=true in Express 4 but Express 5 keeps " +
        "the parser at simple mode; added { extended: true } to preserve nested/array body parsing.");
      ctx.edits.push({ node: call, text: `${recv.getText()}.urlencoded({ extended: true })`, after: false });
      continue;
    }
    const opts = arg0 as ObjectLiteralExpression;
    const ext = opts.getProperty("extended");
    if (ext) continue; // already sets extended (true or false) — leave it.
    // An options object without `extended`: add the key to the object literal, preserving its text.
    add(ctx, call, "express-urlencoded-extended", "silent", "auto",
      "express.urlencoded() / bodyParser.urlencoded() default to extended=true in Express 4 but Express 5 keeps " +
      "the parser at simple mode; added extended: true to preserve nested/array body parsing.");
    const members = opts.getProperties().map((m) => m.getText());
    ctx.edits.push({ node: opts, text: members.length ? `{ ${members.join(", ")}, extended: true }` : "{ extended: true }", after: false });
  }
}

/** E2: req.query read with no `app.set('query parser', ...)` in the file -> auto-insert it after app creation. */
function checkQueryParser(ctx: RuleContext, sf: SourceFile) {
  const routers = expressRouters(sf);
  if (!routers.size) return;
  const setsParser = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((c) => {
      const e = c.getExpression();
      return Node.isPropertyAccessExpression(e) && e.getName() === "set" && c.getArguments()[0]?.getText().includes("query parser");
    });
  if (setsParser) return;
  let firstQuery: TmNode | undefined;
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() !== "query") continue;
    // The receiver is the bare identifier `req` (req.query); not a chain.
    if (pae.getExpression().getText() === "req") firstQuery ??= pae;
  }
  if (!firstQuery) return;
  const app = appCreation(sf, expressAppBindings(sf));
  if (app) {
    add(ctx, firstQuery, "express-query-parser", "silent", "auto",
      "Express 5's default query parser is 'simple' (flat keys); Express 4 used 'extended' (nested/array). " +
      "Set app.set('query parser', 'extended') right after app creation to keep nested/array query keys.");
    ctx.edits.push({
      node: app.stmt,
      text: `${app.stmt.getText()}\n${app.appName}.set('query parser', 'extended');`,
      after: false,
    });
  } else {
    add(ctx, firstQuery, "express-query-parser", "silent", "manual",
      "Express 5's default query parser is 'simple' (flat keys); Express 4 used 'extended' (nested/array). " +
      "Set app.set('query parser', 'extended') on the app that mounts this router.");
  }
}

/** E5: res.status(x) with a non-integer or out-of-range argument -> manual report. */
function checkStatus(ctx: RuleContext, sf: SourceFile) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "status") continue;
    const arg = call.getArguments()[0];
    if (!arg) continue;
    // Only flag when the arg is NOT a plain integer literal 100..999.
    const ok = Node.isNumericLiteral(arg) ? arg.getLiteralValue() >= 100 && arg.getLiteralValue() <= 999 : false;
    if (ok) continue;
    add(ctx, arg, "express-status-code", "silent", "manual",
      "res.status(<non-integer>) throws at request time in Express 5 (Express 4 accepted a string/number with a " +
      "deprecation warning). Pass an integer status code in 100..999.");
  }
}

/** E6: req.host read -> manual report (v5 now includes the port). */
function checkHost(ctx: RuleContext, sf: SourceFile) {
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() !== "host") continue;
    // The receiver is the bare identifier `req` (req.host).
    if (pae.getExpression().getText() === "req") {
      add(ctx, pae, "express-req-host", "silent", "manual",
        "req.host in Express 5 returns the full Host header including the port; Express 4 returned the hostname " +
        "without the port. Use req.hostname if a port-less value is needed.");
      break; // one report per file
    }
  }
}

/** E7: res.clearCookie(name, { maxAge | expires }) -> manual report (v5 ignores those, forces expiry). */
function checkClearCookie(ctx: RuleContext, sf: SourceFile) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "clearCookie") continue;
    const opts = call.getArguments()[1];
    if (!opts || !Node.isObjectLiteralExpression(opts)) continue;
    if (opts.getProperty("maxAge") || opts.getProperty("expires")) {
      add(ctx, opts, "express-clearcookie-maxage", "silent", "manual",
        "res.clearCookie(name, { maxAge | expires }) ignores those options in Express 5 and always expires the " +
        "cookie immediately; Express 4 honored maxAge. Drop maxAge/expires or set the cookie explicitly.");
    }
  }
}

function add(ctx: RuleContext, node: TmNode, ruleId: string, severity: Severity, fix: FixKind, message: string) {
  const sf = node.getSourceFile();
  ctx.findings.push({
    ruleId,
    severity,
    fix,
    file: path.relative(ctx.root, sf.getFilePath()).split(path.sep).join("/"),
    line: node.getStartLineNumber(),
    snippet: node.getText().split("\n")[0]!.slice(0, 160),
    message,
  });
}

/**
 * F9: `express-async-errors` is redundant on Express 5 (the router already routes async rejections to
 * error handlers) and, with Express 5 installed, `require('express-async-errors')` throws at startup
 * ("Cannot find module 'express/lib/router/layer'"). A bare side-effect import/require is auto-deleted;
 * any other usage (a named import, passing it to app.use) is manual.
 */
function checkAsyncErrors(ctx: RuleContext, sf: SourceFile) {
  const manualMsg =
    "express-async-errors is unnecessary on Express 5 (the router already routes async rejections to error " +
    "handlers) and it throws at startup with 'Cannot find module express/lib/router/layer'. Drop the package " +
    "from package.json and remove this usage.";
  // ESM: a bare side-effect `import "express-async-errors";` (no import clause) is auto-deleted.
  for (const imp of sf.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== "express-async-errors") continue;
    const hasClause = imp.getNamedImports().length > 0 || imp.getDefaultImport() !== undefined || imp.getNamespaceImport() !== undefined;
    if (!hasClause) removeStatement(ctx, imp);
    else add(ctx, imp, "express-async-errors", "break", "manual", manualMsg);
  }
  // CJS: a bare side-effect `require("express-async-errors");` statement is auto-deleted.
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getExpression().getText() !== "require") continue;
    const a = c.getArguments()[0];
    if (!Node.isStringLiteral(a) || a.getLiteralValue() !== "express-async-errors") continue;
    const stmt = c.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
    if (stmt) removeStatement(ctx, stmt);
  }
}

/** Push the finding and queue a deletion of the whole statement (ts-morph replaceWithText("")). */
function removeStatement(ctx: RuleContext, stmt: TmNode) {
  add(ctx, stmt, "express-async-errors", "break", "auto",
    "express-async-errors is unnecessary on Express 5 (the router already routes async rejections to error " +
    "handlers) and it throws at startup with 'Cannot find module express/lib/router/layer'. Removed the " +
    "side-effect import; also drop the package from package.json.");
  ctx.edits.push({ node: stmt, text: "" });
}

/**
 * F10: `res.sendfile(p)` was removed in Express 5; the v5 spelling is `res.sendFile(p)`, but a bare
 * rename of a relative path 500s ("path must be absolute or specify root"), so the path must be
 * resolved. Agent judgment: keep the path semantics of the original sendfile call.
 */
function checkResSendfile(ctx: RuleContext, sf: SourceFile) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "sendfile") continue;
    add(ctx, e, "express-sendfile", "break", "agent",
      "res.sendfile() was removed in Express 5. Replace it with res.sendFile(path.resolve(p)); a bare rename " +
      "to sendFile('f.txt') 500s on a relative path ('path must be absolute or specify root'), so resolve the " +
      "path against the same base the original sendfile used (or pass { root }).");
  }
}

/**
 * `express.query(fn)` registered the global query parser in Express 4; it was removed in Express 5.
 * The replacement is per-app `app.set('query parser', ...)`, which the maintainer threads through to every
 * app/router that serves the request — agent judgment, no deterministic rewrite. A non-express `.query(`
 * (Map, axios, ...) is not flagged.
 */
function checkExpressQuery(ctx: RuleContext, sf: SourceFile) {
  const routers = expressRouters(sf);
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "query") continue;
    const recv = e.getExpression();
    if (!Node.isIdentifier(recv) || !routers.has(recv.getText())) continue; // a Map/axios .query is not express.query
    add(ctx, e, "express-query", "break", "agent",
      "express.query() was removed in Express 5. Set the query parser on the app or router that serves the " +
      "request instead: app.set('query parser', ...), using the parser the original express.query() registered.");
  }
}

/**
 * E9: related packages that commonly break alongside an Express 5 upgrade (from the catalog's
 * tooling notes). Report-only (manual): name the package and the bump it needs. The @types
 * lockstep is handled by the bump itself, so only the runtime packages are reported here.
 */
const RELATED_PACKAGE_BUMPS: Array<{ name: string; target: string; note: string }> = [
  { name: "express-rate-limit", target: "7", note: "needs a major bump for Express 5" },
  { name: "express-promise-router", target: "3", note: "needs a major bump for Express 5" },
  { name: "swagger-ui-express", target: "5", note: "needs a major bump for Express 5" },
  { name: "http-proxy-middleware", target: "2", note: "needs a major bump for Express 5" },
];

export function checkExpressRelatedPackages(root: string): Finding[] {
  const findings: Finding[] = [];
  const push = (file: string, name: string, message: string) =>
    findings.push({
      ruleId: "express-related-package", severity: "break", fix: "manual",
      file: path.relative(root, file).split(path.sep).join("/"), line: 1,
      snippet: `"${name}"`, message,
    });
  for (const file of findPackageJsons(root)) {
    const pkg = readJson(file);
    const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
    for (const { name, target, note } of RELATED_PACKAGE_BUMPS) {
      const range = deps[name];
      if (typeof range === "string" && !range.includes(":") && allowsMajor(range, Number(target))) continue; // already allows the target
      if (typeof range === "string") push(file, name, `${name} ${note}: ${range} does not allow ${target}.`);
    }
    // express-async-errors is redundant on Express 5 (the router already forwards async rejections).
    if (typeof deps["express-async-errors"] === "string") {
      push(file, "express-async-errors", "express-async-errors is unnecessary on Express 5 (the router already routes async rejections to error handlers); remove it.");
    }
  }
  return findings;
}

export function scanExpressV5(project: Project, root: string): RuleContext {
  const ctx: RuleContext = { root, findings: [], edits: [], fileEdits: [] };
  for (const sf of project.getSourceFiles()) {
    if (!importsExpress(sf)) continue; // no express import/require: nothing to flag
    if (alreadyOnExpress5(sf.getFilePath(), root)) continue; // nearest package.json is already on v5: leave it alone
    checkRouteStrings(ctx, sf);
    checkUrlencoded(ctx, sf);
    checkQueryParser(ctx, sf);
    checkStatus(ctx, sf);
    checkHost(ctx, sf);
    checkClearCookie(ctx, sf);
    checkAsyncErrors(ctx, sf);
    checkResSendfile(ctx, sf);
    checkExpressQuery(ctx, sf);
  }
  return ctx;
}
