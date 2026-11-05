/**
 * Zod 3 -> 4 rules that the community codemod (zod-v3-to-v4) and the type
 * checker do not cover. Most of them are silent: the schema still typechecks
 * but accepts or rejects different inputs at runtime under Zod 4.
 *
 * Only files that import from exactly "zod" are flagged; "zod/v3" keeps v3
 * semantics and "zod/v4" is already v4. Rule table and messages: plan.md T3.3.
 */
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type Node as TmNode,
  type Project,
  type SourceFile,
} from "ts-morph";
import type { RuleContext } from "./ai-sdk-v7.js";
import type { FixKind, Severity } from "../types.js";

interface ZodBindings {
  /** Local names that bind the `z` export or a namespace import of "zod". */
  names: Set<string>;
}

/** R2: methods before a `.default()` that decide whether the value is parsed first. */
const TRANSFORMS = new Set(["transform", "pipe", "trim", "toLowerCase", "toUpperCase", "normalize"]);
/** R9: root calls whose `.default()` value Zod 3 parsed (filling inner defaults, stripping unknown keys) and Zod 4 does not. */
const OBJECT_ROOTS = new Set(["object", "strictObject"]);
/** R6: methods that already guard a z.coerce value against a missing key. */
const GUARDS = new Set(["optional", "nullish", "default", "prefault", "catch"]);
/** R8: calls whose result carries an `.error` that is a ZodError. */
const SAFE_PARSE = new Set(["safeParse", "safeParseAsync"]);

const R1_MSG =
  "Zod 4 applies .default() inside .optional()/.nullish() when the key is missing; Zod 3 left it " +
  "undefined. Removed the .default() to keep current behavior. If you want the default applied, " +
  "put it back after the upgrade.";
const R2_MSG =
  "Zod 4's .default() returns the value without running it through the schema; Zod 3 parsed it " +
  "(so transforms applied). .prefault() keeps Zod 3 behavior.";
const R9_MSG =
  "Zod 4's .default() on an object returns the value as is; Zod 3 parsed it, which filled in the " +
  "object's own field defaults. .prefault() keeps Zod 3 behavior.";
const R3_MSG =
  "Zod 4's uuid() rejects UUIDs without RFC 9562 variant bits that Zod 3 accepted. " +
  "guid() keeps Zod 3's pattern.";
const R4_MSG =
  "Zod 4 requires every key of an enum-keyed z.record(); Zod 3 treated them as optional. " +
  "z.partialRecord() keeps Zod 3 behavior.";
const R5_MSG =
  "Since Zod 4.4, a missing key for a z.unknown()/z.any() field fails; Zod 3 accepted it. " +
  ".optional() keeps Zod 3 behavior.";
const R6_MSG =
  "In Zod 4 a missing key for a z.coerce field fails; Zod 3 coerced undefined (false, \"undefined\", NaN). " +
  "Decide whether the key is required.";
const R7_MSG =
  "In Zod 4 a conflicting intersection throws a plain Error, not a ZodError, " +
  "so instanceof ZodError checks miss it.";
const R8_MSG =
  "ZodError.errors was removed in Zod 4; .issues holds the same array. " +
  "In JavaScript files this would be undefined at runtime.";

export function scanZodV4(project: Project, root: string): RuleContext {
  const ctx: RuleContext = { root, findings: [], edits: [], fileEdits: [] };
  for (const sf of project.getSourceFiles()) {
    const b = zodBindings(sf);
    if (b.names.size === 0) continue; // no exact "zod" import: nothing Zod-4-shaped to flag
    checkRules(ctx, sf, b, constInitializerMap(sf));
  }
  return ctx;
}

/** Local names of the named `z` import (and its alias), the default import and namespace imports, from exactly "zod". */
function zodBindings(sf: SourceFile): ZodBindings {
  const names = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== "zod") continue; // "zod/v3" and "zod/v4" keep their own semantics
    const ns = decl.getNamespaceImport();
    if (ns) names.add(ns.getText());
    const def = decl.getDefaultImport(); // Zod 3's default export is the same `z` object
    if (def) names.add(def.getText());
    for (const spec of decl.getNamedImports()) {
      if (spec.getName() === "z") names.add(spec.getAliasNode()?.getText() ?? spec.getName());
    }
  }
  return { names };
}

/** `const id = <expr>` initializers in this file, for the one-level identifier rule in isZodChain. */
function constInitializerMap(sf: SourceFile): Map<string, TmNode> {
  const out = new Map<string, TmNode>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getNameNode();
    const init = decl.getInitializer();
    if (Node.isIdentifier(name) && init) out.set(name.getText(), init);
  }
  return out;
}

/**
 * `expr` is a Zod chain when its leftmost identifier is a `z` binding, or when it is an identifier
 * initialized to a Zod chain one level up in the same file (`const Keys = z.enum([...])`).
 * No recursion beyond that one level.
 */
function isZodChain(expr: TmNode, names: Set<string>, inits: Map<string, TmNode>): boolean {
  let e = expr;
  while (Node.isCallExpression(e) || Node.isPropertyAccessExpression(e)) e = e.getExpression();
  if (!Node.isIdentifier(e)) return false;
  if (names.has(e.getText())) return true;
  return Node.isIdentifier(expr) && isZodChain(inits.get(expr.getText()) ?? expr, names, inits);
}

/**
 * The "root call" of a Zod-chain argument to z.record: `z.enum(...)` -> "enum", and an identifier
 * whose same-file `const` initializer is such a chain -> that chain's root call. One level, no recursion.
 */
function keyRootCall(key: TmNode, names: Set<string>, inits: Map<string, TmNode>): string | undefined {
  const target = Node.isIdentifier(key) && inits.has(key.getText()) ? inits.get(key.getText())! : key;
  if (!isZodChain(target, names, inits)) return undefined;
  return chainMethods(target)[0];
}

/**
 * The first method of a Zod chain: `z.object({...}).default({})` -> "object". When the chain starts at an
 * identifier with a same-file `const` Zod-chain initializer (`S.default({})`), that initializer's first method.
 * One level, no recursion.
 */
function chainRoot(expr: TmNode, names: Set<string>, inits: Map<string, TmNode>): string | undefined {
  let base = expr;
  while (Node.isCallExpression(base) || Node.isPropertyAccessExpression(base)) base = base.getExpression();
  if (!Node.isIdentifier(base)) return undefined;
  if (names.has(base.getText())) return chainMethods(expr)[0];
  const init = inits.get(base.getText());
  return init && isZodChain(init, names, inits) ? chainMethods(init)[0] : undefined;
}

/** Method names from the `z` binding to `n`, e.g. `z.string().default("a")` -> ["string", "default"]. */
function chainMethods(n: TmNode): string[] {
  if (Node.isCallExpression(n)) {
    const pae = n.getExpression();
    return Node.isPropertyAccessExpression(pae) ? [...chainMethods(pae.getExpression()), pae.getName()] : [];
  }
  if (Node.isPropertyAccessExpression(n)) return [...chainMethods(n.getExpression()), n.getName()];
  return [];
}

/** The method name of a call expression, or undefined when it is not a simple method call. */
function callMethod(call: CallExpression): string | undefined {
  const e = call.getExpression();
  return Node.isPropertyAccessExpression(e) ? e.getName() : Node.isIdentifier(e) ? e.getText() : undefined;
}

function checkRules(ctx: RuleContext, sf: SourceFile, b: ZodBindings, inits: Map<string, TmNode>) {
  const names = b.names;
  const zodErrorText = referencesZodError(sf);
  const safeParseIds = safeParseResultIds(inits, names);
  const narrowedIds = zodErrorNarrowedIds(sf);

  // R1 rewrites replace `.default(...)` calls; R2 must not rename the same calls.
  const r1DefaultCalls = new Set<TmNode>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e)) continue;
    const m = e.getName();

    // R1: `.default(X)` right before `.optional()`/`.nullish()` — drop the default.
    if (m === "optional" || m === "nullish") {
      const recv = e.getExpression();
      if (Node.isCallExpression(recv) && callMethod(recv) === "default" && isZodChain(recv, names, inits)) {
        r1DefaultCalls.add(recv);
        add(ctx, call, "zod-default-then-optional", "silent", "auto", R1_MSG);
        // Replace `<recv>.default(X)` with `<recv>`'s receiver (the chain before the default).
        const defPae = recv.getExpression();
        const receiver = Node.isPropertyAccessExpression(defPae) ? defPae.getExpression().getText() : defPae.getText();
        ctx.edits.push({ node: recv, text: receiver });
      }
      continue;
    }

    // R2: `.default(X)` behind a transform/pipe/trim/... — rename to `.prefault(X)`.
    if (m === "default") {
      const defCall = call;
      if (
        isZodChain(e, names, inits) &&
        !r1DefaultCalls.has(defCall) &&
        (chainMethods(e)[0] === "preprocess" || chainMethods(e).slice(0, -1).some((x) => TRANSFORMS.has(x)))
      ) {
        add(ctx, defCall, "zod-default-through-transform", "silent", "auto", R2_MSG);
        ctx.edits.push({ node: e.getNameNode(), text: "prefault" });
      } else if (!r1DefaultCalls.has(defCall) && OBJECT_ROOTS.has(chainRoot(e, names, inits) ?? "")) {
        // R9: `.default(X)` on an object schema — rename to `.prefault(X)`.
        add(ctx, defCall, "zod-object-default", "silent", "auto", R9_MSG);
        ctx.edits.push({ node: e.getNameNode(), text: "prefault" });
      }
      continue;
    }

    // R3: `.uuid()` on a z.string() chain — rename to `.guid()`.
    if (m === "uuid" && isZodChain(e, names, inits) && chainMethods(e)[0] === "string") {
      add(ctx, call, "zod-uuid-strict", "silent", "auto", R3_MSG);
      ctx.edits.push({ node: e.getNameNode(), text: "guid" });
      continue;
    }

    // R4: `z.record(<exhaustive key schema>, <value>)` — rename to `z.partialRecord`.
    if (m === "record" && isZodChain(e, names, inits) && call.getArguments().length === 2) {
      const key = call.getArguments()[0]!;
      const root = keyRootCall(key, names, inits);
      const exhaustive =
        root === "enum" ||
        root === "nativeEnum" ||
        root === "literal" ||
        (root === "union" &&
          isUnionOfLiterals(key, names, inits));
      if (exhaustive) {
        add(ctx, call, "zod-record-exhaustive", "silent", "auto", R4_MSG);
        ctx.edits.push({ node: e.getNameNode(), text: "partialRecord" });
      }
      continue;
    }

    // R7: `z.intersection(A, B)` / `A.and(B)` in a file that touches ZodError — manual.
    if ((m === "intersection" || m === "and") && zodErrorText && isZodChain(e, names, inits)) {
      add(ctx, call, "zod-intersection-error", "silent", "manual", R7_MSG);
    }
  }

  // R5 + R6: object fields of z.object / .extend / .merge.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || !isZodChain(e, names, inits)) continue;
    const m = e.getName();
    if (m !== "object" && m !== "extend" && m !== "merge") continue;
    const arg0 = call.getArguments()[0];
    if (!Node.isObjectLiteralExpression(arg0)) continue;
    for (const prop of arg0.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const v = prop.getInitializer();
      if (!Node.isCallExpression(v) || !isZodChain(v, names, inits)) continue;
      const vm = callMethod(v);
      // R5: `u: z.unknown()` / `a: z.any()` object field — append `.optional()` to the call.
      if ((vm === "unknown" || vm === "any") && m === "object") {
        add(ctx, v, "zod-unknown-key-required", "silent", "auto", R5_MSG);
        ctx.edits.push({ node: v, text: `${v.getText()}.optional()` });
      }
      // R6: `f: z.coerce.<x>()` without a guard — manual, no rewrite (z.object fields only).
      if (m === "object") {
        const methods = chainMethods(v);
        if (
          methods[0] === "coerce" &&
          !methods.some((x) => GUARDS.has(x))
        ) {
          add(ctx, v, "zod-coerce-missing-key", "silent", "manual", R6_MSG);
        }
      }
    }
  }

  // R8: `.errors` on a safeParse result's `.error`, or on a ZodError-narrowed binding.
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() !== "errors") continue;
    const recv = pae.getExpression();
    if (Node.isPropertyAccessExpression(recv) && recv.getName() === "error") {
      const id = recv.getExpression();
      if (Node.isIdentifier(id) && safeParseIds.has(id.getText())) {
        add(ctx, pae, "zod-errors-property", "break", "auto", R8_MSG);
        ctx.edits.push({ node: pae.getNameNode(), text: "issues" });
      }
    } else if (Node.isIdentifier(recv) && narrowedIds.has(recv.getText())) {
      add(ctx, pae, "zod-errors-property", "break", "auto", R8_MSG);
      ctx.edits.push({ node: pae.getNameNode(), text: "issues" });
    }
  }
}

/** `z.union([...])` whose every element is a `z.literal` call on a Zod chain. */
function isUnionOfLiterals(key: TmNode, names: Set<string>, inits: Map<string, TmNode>): boolean {
  if (!Node.isCallExpression(key) || callMethod(key) !== "union") return false;
  const arr = key.getArguments()[0];
  if (!Node.isArrayLiteralExpression(arr)) return false;
  return arr
    .getElements()
    .every((el) => Node.isCallExpression(el) && callMethod(el) === "literal" && isZodChain(el, names, inits));
}

/** Names whose `const` initializer is a `.safeParse(`/`.safeParseAsync(` call. */
function safeParseResultIds(inits: Map<string, TmNode>, names: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const [id, init] of inits) {
    let call: TmNode = init;
    if (Node.isAwaitExpression(call)) call = call.getExpression();
    if (Node.isCallExpression(call) && SAFE_PARSE.has(callMethod(call) ?? "")) out.add(id);
  }
  return out;
}

/** Binding names narrowed by an enclosing `if (<id> instanceof ZodError)`. */
function zodErrorNarrowedIds(sf: SourceFile): Set<string> {
  const out = new Set<string>();
  for (const ifStmt of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const cond = ifStmt.getExpression();
    if (Node.isBinaryExpression(cond) && cond.getOperatorToken().getText() === "instanceof") {
      const rhs = cond.getRight();
      const lhs = cond.getLeft();
      if (Node.isIdentifier(rhs) && rhs.getText() === "ZodError" && Node.isIdentifier(lhs)) out.add(lhs.getText());
    }
  }
  return out;
}

/**
 * Does this file reference `ZodError` in code (import, instanceof, a type position, or a
 * namespace access)? Comments are ignored: a file whose explanatory text mentions ZodError
 * but has no code reference is not "in a file that checks ZodError".
 */
function referencesZodError(sf: SourceFile): boolean {
  for (const decl of sf.getImportDeclarations()) {
    for (const spec of decl.getNamedImports()) {
      if (spec.getName() === "ZodError") return true;
    }
    const ns = decl.getNamespaceImport();
    if (ns && Node.isIdentifier(ns) && ns.getText() === "ZodError") return true;
  }
  for (const t of sf.getDescendantsOfKind(SyntaxKind.TypeReference)) {
    if (t.getTypeName().getText() === "ZodError") return true;
  }
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() === "ZodError" && Node.isIdentifier(pae.getExpression())) return true;
  }
  for (const bin of sf.getDescendantsOfKind(SyntaxKind.BinaryExpression)) {
    if (bin.getOperatorToken().getText() === "instanceof" && Node.isIdentifier(bin.getRight()) && bin.getRight().getText() === "ZodError") return true;
  }
  return false;
}

function add(ctx: RuleContext, node: TmNode, ruleId: string, severity: Severity, fix: FixKind, message: string) {
  const sf = node.getSourceFile();
  ctx.findings.push({
    ruleId,
    severity,
    fix,
    // Forward slashes: the documented finding-path convention, so Windows output matches Linux.
    file: path.relative(ctx.root, sf.getFilePath()).split(path.sep).join("/"),
    line: node.getStartLineNumber(),
    snippet: node.getText().split("\n")[0]!.slice(0, 160),
    message,
  });
}
