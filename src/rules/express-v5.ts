/**
 * Express 4 -> 5 rules that the official codemod (@expressjs/codemod) and the type checker do not
 * cover. Most of the route-string breaks are startup throws (path-to-regexp 0.1 -> 8); the rest are
 * silent runtime deltas (query parser, clearCookie, host, status, body). See docs/CATALOG (A-routing,
 * B-runtime, C-tooling). Static only: no type-checker calls, matching scanZodV4's shape.
 *
 * Only files that import/require "express" (or are handed an Express Router) are scanned, mirroring
 * scanZodV4's "import from exactly zod" gate.
 */
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

/** A path segment that is a bare splat in its v4 form; the v5 named-splat replacements follow CATALOG §2. */
function splatRewrite(route: string): string | undefined {
  if (route === "*") return "*splat";
  if (route === "/*") return "/{*splat}";
  if (route === "/(.*)") return "/{*splat}";
  // '/<prefix>/*' (but not the bare '/*' handled above) -> '/<prefix>/*splat': keep the '*', name it.
  const prefix = route.match(/^\/[^\/*]*\/\*$/);
  if (prefix) return route.replace(/\*$/, "*splat");
  // ':<name>(*)' splat-constraint, e.g. '/files/:path(*)' -> '/files/*splat'.
  const constrained = route.match(/^(\/[^\/*]*)?:\w+\(\*$/);
  if (constrained) {
    const head = route.slice(0, route.indexOf(":"));
    return `${head}*splat`;
  }
  return undefined;
}

/** True when a v4 route string REG-THROWS under path-to-regexp 8 and has a simple v5 spelling. */
const isSplat = (r: string) => splatRewrite(r) !== undefined;

/** Optional named-param modifier: ':id?' -> agent (no single v5 string; split into two routes). */
const hasOptionalParam = (r: string) => /(^|\/):[a-zA-Z_]\w*\?/.test(r) && !isSplat(r);
/** Custom-regex named-param ':id(\d+)': agent (no v8 constraint form; enforce in-handler). */
const hasCustomRegexParam = (r: string) => /:\w+\([^)]+\)/.test(r) && !isSplat(r);
/**
 * Literal '+'/'?'/'()' characters in a path that are not a named-param token: path-to-regexp 8
 * treats them as token modifiers, so the route REG-THROWS. Strip the recognized ':name' and
 * ':name(regex)' params; whatever '+'/'?'/'(' /')' remains is a literal-special route.
 */
const hasLiteralSpecial = (r: string) => {
  if (isSplat(r) || hasOptionalParam(r) || hasCustomRegexParam(r)) return false;
  const stripped = r.replace(/:\w+\([^)]*\)/g, "").replace(/:\w+/g, "");
  return /[+?()]/.test(stripped);
};

/** Does this handler expression read req.params[0] / params.splat / a numeric params index? */
function handlerReadsSplatParam(handler: TmNode | undefined): boolean {
  if (!handler) return false;
  let found = false;
  handler.forEachDescendant((n) => {
    if (found) return;
    // params.splat / params["0"] — property or element access whose receiver is `*.params`.
    const recv = Node.isPropertyAccessExpression(n) ? n.getExpression()
      : Node.isElementAccessExpression(n) ? n.getExpression()
      : undefined;
    if (!recv || !Node.isPropertyAccessExpression(recv) || recv.getName() !== "params") return;
    if (Node.isPropertyAccessExpression(n)) {
      const prop = n.getName();
      if (prop === "splat" || /^\d+$/.test(prop)) found = true;
    } else if (Node.isElementAccessExpression(n)) {
      const arg = n.getArgumentExpression();
      if (arg && /["']?(0|splat|\d+)["']?$/.test(arg.getText())) found = true;
    }
  });
  return found;
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

/** The route-string argument of a route call, when it is a plain string literal. */
function routeStringArg(call: CallExpression): { text: string; node: TmNode; handler: TmNode | undefined } | undefined {
  const args = call.getArguments();
  const first = args[0];
  if (!first || !Node.isStringLiteral(first)) return undefined;
  return { text: first.getLiteralValue(), node: first, handler: args.length >= 2 ? args[args.length - 1] : undefined };
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
    const handler = r.handler;

    if (isSplat(route)) {
      const read = handlerReadsSplatParam(handler);
      if (read) {
        add(ctx, r.node, "express-splat-param", "break", "agent",
          "This wildcard route REG-THROWS in Express 5 (path-to-regexp 8 has no unnamed splat). Its handler reads " +
          "req.params[0]/req.params.splat, whose shape changes from a string to an array. Rewrite the route to a " +
          "named splat (e.g. '*splat') and read req.params.splat.join('/') (add a leading '/' for the '*'/'/(.*)' " +
          "forms), keeping the matched paths identical.");
      } else {
        add(ctx, r.node, "express-splat-param", "break", "auto",
          "This wildcard route REG-THROWS in Express 5 (path-to-regexp 8 dropped the unnamed splat). Rewrote it to a " +
          "named splat; the matched paths are unchanged.");
        ctx.edits.push({ node: r.node, text: `'${splatRewrite(route)}'` });
      }
      continue;
    }
    if (hasOptionalParam(route)) {
      add(ctx, r.node, "express-optional-param", "break", "agent",
        "path-to-regexp 8 dropped the optional ':' param modifier; this route REG-THROWS in Express 5. " +
        "Register two routes with the same handler (the path with and without the param) to keep the matched set.");
      continue;
    }
    if (hasCustomRegexParam(route)) {
      add(ctx, r.node, "express-regex-param", "break", "agent",
        "path-to-regexp 8 has no form for a named param constrained by a regex; this route REG-THROWS in Express 5. " +
        "Use a plain ':name' and enforce the constraint inside the handler/middleware, preserving the capture semantics.");
      continue;
    }
    if (hasLiteralSpecial(route)) {
      add(ctx, r.node, "express-literal-special", "break", "agent",
        "In Express 5, '+'/'?'/'()' inside a route are path-to-regexp modifiers, so this literal path REG-THROWS. " +
        "There is no exact v8 spelling; escape or rename the literal path.");
    }
  }
}

/**
 * The first `const app = express()` statement in the file (a bare call to an express binding, not
 * `.Router`/`.Application`), so the query-parser option can be set right after app creation. Returns
 * the VariableStatement and the app variable name.
 */
function appCreation(sf: SourceFile, routers: Set<string>) {
  for (const stmt of sf.getStatements()) {
    if (!Node.isVariableStatement(stmt)) continue;
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init || !Node.isCallExpression(init)) continue;
      const callee = init.getExpression();
      const calleeName = Node.isIdentifier(callee) ? callee.getText() : null;
      if (calleeName && routers.has(calleeName)) return { stmt, appName: decl.getNameNode().getText() };
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
  const app = appCreation(sf, routers);
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
      "Add app.set('query parser', 'extended') on the app that serves this route.");
  }
}

/** E4: req.body.<x> read in a file that creates a router but mounts no body parser -> manual report. */
function checkBody(ctx: RuleContext, sf: SourceFile) {
  const routers = expressRouters(sf);
  // Only apply to a file that actually creates an app or router (express(), Router(), or an express
  // default/namespace binding used as `express.json()`). A pure handler-definition file that just
  // receives `req` does not mount a parser and is not flagged.
  // express() with no args, or Router() / express.Router() with no args.
  let createsRouter = false;
  for (const c of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (c.getArguments().length > 0) continue;
    const e = c.getExpression();
    if (Node.isIdentifier(e) && routers.has(e.getText()) && (e.getText() === "express" || e.getText() === "Router")) createsRouter = true;
    else if (Node.isPropertyAccessExpression(e) && e.getName() === "Router" && Node.isIdentifier(e.getExpression()) && routers.has(e.getExpression().getText())) createsRouter = true;
  }
  if (!createsRouter) return;
  const parserNames = new Set(["json", "urlencoded", "raw", "text"]);
  // A parser is mounted when express.json()/bodyParser.json() (etc.) appears, or is passed to .use().
  // The receiver must be a parser host, NOT `res`/`response`: res.json(...) sends a response and is
  // not a body-parser mount.
  const parserHost = (recv: string) => recv === "express" || recv === "bodyParser" || recv === "body";
  const mountsParser = sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((c) => {
      const e = c.getExpression();
      if (!Node.isPropertyAccessExpression(e)) return false;
      const method = e.getName();
      const recv = e.getExpression().getText();
      if (parserNames.has(method) && parserHost(recv)) return true;
      if (method === "use" && JSON.stringify(c.getText()).match(/\b(express|bodyParser)\.(json|urlencoded|raw|text)\(/)) return true;
      return false;
    });
  if (mountsParser) return;
  let first: TmNode | undefined;
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() !== "body") continue;
    // The receiver is the bare identifier `req` (req.body).
    if (pae.getExpression().getText() === "req") {
      first ??= pae;
      break;
    }
  }
  if (first)
    add(ctx, first, "express-body-parser", "silent", "manual",
      "No body parser is mounted on this app/router, so req.body.<field> is undefined in Express 5 (Express 4 gave {} " +
      "for a missing body). Mount express.json()/express.urlencoded() or handle the empty-body case.");
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
    checkRouteStrings(ctx, sf);
    checkUrlencoded(ctx, sf);
    checkQueryParser(ctx, sf);
    checkBody(ctx, sf);
    checkStatus(ctx, sf);
    checkHost(ctx, sf);
    checkClearCookie(ctx, sf);
  }
  return ctx;
}
