/**
 * S06: the DSL interpreter. A candidate rule is data (DslRule), not code — this module compiles it
 * to ts-morph findings and (optional) behavior-preserving edits against a loaded Project. Fixed
 * interpreter, so the draft model can't inject arbitrary code into a pack: it can only name the
 * primitives. The primitives mirror the hand-written rules in src/rules/ (import-gated chain
 * detection, one-level const initializer lookup) so a candidate can reproduce them.
 *
 * Detection is what the admission harness grades (does it flag the FLAG lines, stay silent on the
 * no-flag lines, and not fire on other packs' fixtures). Rewrites are best-effort and only applied
 * for the few shapes the DSL names; a "manual"/"agent" fix emits a finding with no edit.
 */
import path from "node:path";
import { Node, SyntaxKind, type CallExpression, type Node as TmNode, type Project, type SourceFile } from "ts-morph";
import type { RuleContext } from "../rules/ai-sdk-v7.js";
import type { Finding, FixKind, Severity } from "../types.js";
import type { DslRule } from "./types.js";

interface Bindings {
  names: Set<string>;
  errorNames: Set<string>;
}

/** The local names that bind the DSL's import specifier (default, `z`-style named, namespace, aliases). */
function bindingsFor(sf: SourceFile, rule: DslRule): Bindings {
  const names = new Set<string>();
  const errorNames = new Set<string>();
  const want = new Set(rule.import.bindings ?? ["z", "default"]);
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== rule.import.specifier) continue;
    const ns = decl.getNamespaceImport();
    if (ns) names.add(ns.getText());
    const def = decl.getDefaultImport();
    if (def) names.add(def.getText());
    for (const spec of decl.getNamedImports()) {
      const local = spec.getAliasNode()?.getText() ?? spec.getName();
      if (want.has(spec.getName())) names.add(local);
      if (rule.gates?.fileReferences === "ZodError" && spec.getName() === "ZodError") errorNames.add(local);
    }
  }
  return { names, errorNames };
}

/** Same-file `const id = <expr>` initializers, for the one-level chain lookup. */
function constInits(sf: SourceFile): Map<string, TmNode> {
  const out = new Map<string, TmNode>();
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getNameNode();
    const init = decl.getInitializer();
    if (Node.isIdentifier(name) && init) out.set(name.getText(), init);
  }
  return out;
}

/** `expr` is a chain rooted at a binding, or a same-file const whose initializer is such a chain. */
function isChain(expr: TmNode, names: Set<string>, inits: Map<string, TmNode>, depth = 0): boolean {
  let e = expr;
  while (Node.isCallExpression(e) || Node.isPropertyAccessExpression(e)) e = e.getExpression();
  if (!Node.isIdentifier(e)) return false;
  if (names.has(e.getText())) return true;
  if (depth >= 1 || !Node.isIdentifier(expr)) return false;
  const init = inits.get(expr.getText());
  return !!init && isChain(init, names, inits, 1);
}

/** Method names from the chain's root, e.g. `z.object({...}).default({})` -> ["object","default"]. */
function chainMethods(n: TmNode): string[] {
  if (Node.isCallExpression(n)) {
    const pae = n.getExpression();
    return Node.isPropertyAccessExpression(pae) ? [...chainMethods(pae.getExpression()), pae.getName()] : [];
  }
  if (Node.isPropertyAccessExpression(n)) return [...chainMethods(n.getExpression()), n.getName()];
  return [];
}
function callMethod(call: CallExpression): string | undefined {
  const e = call.getExpression();
  return Node.isPropertyAccessExpression(e) ? e.getName() : Node.isIdentifier(e) ? e.getText() : undefined;
}

function add(ctx: RuleContext, node: TmNode, rule: DslRule, severity: Severity, fix: FixKind, message: string, line?: number) {
  const sf = node.getSourceFile();
  const f: Finding = {
    ruleId: rule.id,
    severity,
    fix,
    file: path.relative(ctx.root, sf.getFilePath()).split(path.sep).join("/"),
    line: line ?? node.getStartLineNumber(),
    snippet: node.getText().split("\n")[0]!.slice(0, 160),
    message,
  };
  ctx.findings.push(f);
}

/** The interpreter's entry: run one DSL rule against the project and return the findings/edits it produced. */
export function interpretRule(rule: DslRule, project: Project, root: string): RuleContext {
  const ctx: RuleContext = { root, findings: [], edits: [], fileEdits: [] };
  const d = rule.detect;
  const emit = rule.emit;
  for (const sf of project.getSourceFiles()) {
    const b = bindingsFor(sf, rule);
    if (b.names.size === 0 && b.errorNames.size === 0) continue; // import-gated: no binding, nothing to flag
    const inits = constInits(sf);
    if (d.kind === "chain") checkChain(ctx, sf, b, inits, rule);
    else if (d.kind === "recordArgs") checkRecord(ctx, sf, b, inits, rule);
    else if (d.kind === "objectField") checkObjectField(ctx, sf, b, inits, rule);
    else if (d.kind === "propAccess") checkPropAccess(ctx, sf, b, inits, rule);
  }
  return ctx;
}

/** A `.method(...)` on a chain rooted at the binding, with optional receiver/chainBefore/root filters. */
function checkChain(ctx: RuleContext, sf: SourceFile, b: Bindings, inits: Map<string, TmNode>, rule: DslRule) {
  const d = rule.detect;
  const names = b.names;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || !isChain(e, names, inits)) continue;
    const m = e.getName();
    // receiverIs: this method's receiver must be a `.receiverIs()` call (R1: default then optional/nullish).
    if (d.receiverIs) {
      const recv = e.getExpression();
      if (!Node.isCallExpression(recv) || callMethod(recv) !== d.receiverIs) continue;
      const receiver = Node.isPropertyAccessExpression(recv.getExpression()) ? recv.getExpression() : recv;
      emitChain(ctx, rule, call, receiver, names, inits);
      continue;
    }
    const methods = chainMethods(e);
    const oneOf = (v: string | string[] | undefined): string[] | undefined => (v == null ? undefined : Array.isArray(v) ? v : [v]);
    const wantMethod = oneOf(d.method);
    const wantRoot = oneOf(d.root);
    if (wantMethod && !wantMethod.includes(m)) continue; // the rule names the method being called (e.g. "uuid", or "intersection"|"and")
    if (wantRoot && !wantRoot.includes(methods[0] ?? "")) continue;
    if (d.chainBefore && !methods.slice(0, -1).some((x) => d.chainBefore!.includes(x))) continue;
    emitChain(ctx, rule, call, e, names, inits);
  }
}

function emitChain(ctx: RuleContext, rule: DslRule, at: TmNode, target: TmNode, names: Set<string>, inits: Map<string, TmNode>) {
  void names;
  void inits;
  add(ctx, at, rule, rule.emit.severity, rule.emit.fix, rule.emit.message);
  applyRewrite(ctx, rule, target);
}

function applyRewrite(ctx: RuleContext, rule: DslRule, target: TmNode) {
  const rw = rule.emit.rewrite;
  if (!rw || rule.emit.fix !== "auto") return; // only auto fixes carry an edit; agent/manual report only
  const nameNode = (n: TmNode) => (Node.isPropertyAccessExpression(n) ? n.getNameNode() : n);
  if (rw.replaceMethod) {
    const targetNode = Node.isCallExpression(target) ? target.getExpression() : target;
    ctx.edits.push({ node: nameNode(targetNode), text: rw.replaceMethod });
  } else if (rw.appendAfter) {
    ctx.edits.push({ node: target, text: `${target.getText()}${rw.appendAfter}` });
  } else if (rw.dropCallKeepReceiver) {
    const call = Node.isCallExpression(target) ? target : undefined;
    if (call) {
      const recv = call.getExpression();
      const text = Node.isPropertyAccessExpression(recv) ? recv.getExpression().getText() : recv.getText();
      ctx.edits.push({ node: call, text });
    }
  }
}

/** `z.record(A, B)` with A rooted at one of arg0Root (enum/nativeEnum/literal/...). */
function checkRecord(ctx: RuleContext, sf: SourceFile, b: Bindings, inits: Map<string, TmNode>, rule: DslRule) {
  const d = rule.detect;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || e.getName() !== "record" || !isChain(e, b.names, inits)) continue;
    if (d.argCount && call.getArguments().length !== d.argCount) continue;
    const key = call.getArguments()[0];
    if (!key) continue;
    const target = Node.isIdentifier(key) && inits.has(key.getText()) ? inits.get(key.getText())! : key;
    if (!isChain(target, b.names, inits)) continue;
    const root = chainMethods(target)[0];
    if (d.arg0Root && !d.arg0Root.includes(root ?? "")) continue;
    add(ctx, call, rule, rule.emit.severity, rule.emit.fix, rule.emit.message);
    applyRewrite(ctx, rule, e);
  }
}

/** A field of z.object({...}) whose value is rooted at fieldValueRoot (e.g. unknown/any/coerce). */
function checkObjectField(ctx: RuleContext, sf: SourceFile, b: Bindings, inits: Map<string, TmNode>, rule: DslRule) {
  const d = rule.detect;
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const e = call.getExpression();
    if (!Node.isPropertyAccessExpression(e) || !isChain(e, b.names, inits)) continue;
    const m = e.getName();
    if (d.fieldOf && m !== d.fieldOf) continue;
    const arg0 = call.getArguments()[0];
    if (!Node.isObjectLiteralExpression(arg0)) continue;
    for (const prop of arg0.getProperties()) {
      if (!Node.isPropertyAssignment(prop)) continue;
      const v = prop.getInitializer();
      if (!v || !isChain(v, b.names, inits)) continue;
      const vm = callMethod(v as CallExpression) ?? chainMethods(v)[0];
      if (d.fieldValueRoot && !d.fieldValueRoot.includes(vm ?? "")) continue;
      const methods = chainMethods(v);
      if (d.guardMethods && methods.some((x) => d.guardMethods!.includes(x))) continue;
      add(ctx, v, rule, rule.emit.severity, rule.emit.fix, rule.emit.message);
      applyRewrite(ctx, rule, v);
    }
  }
}

/**
 * `<x>.<prop>` where the receiver is a safeParse result's `.error`, or a binding narrowed by an
 * enclosing `instanceof ZodError` (R8). receiverShape "narrowed" also covers a plain `.errors` read
 * on the narrowed id; "safeParseError" only the `safeParse(...).error` chain.
 */
function checkPropAccess(ctx: RuleContext, sf: SourceFile, b: Bindings, inits: Map<string, TmNode>, rule: DslRule) {
  const d = rule.detect;
  const prop = d.prop;
  const narrowed = narrowedIds(sf, b);
  const safeParseIds = new Set<string>();
  for (const [id, init] of inits) {
    let c = init;
    if (Node.isAwaitExpression(c)) c = c.getExpression();
    if (Node.isCallExpression(c) && ["safeParse", "safeParseAsync"].includes(callMethod(c as CallExpression) ?? "")) safeParseIds.add(id);
  }
  for (const pae of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pae.getName() !== prop) continue;
    const recv = pae.getExpression();
    if (d.receiverShape === "safeParseError" || d.receiverShape === "narrowed") {
      if (Node.isPropertyAccessExpression(recv) && recv.getName() === "error") {
        const id = recv.getExpression();
        if (Node.isIdentifier(id) && safeParseIds.has(id.getText())) returnAdd(ctx, rule, pae, d, b, inits);
      } else if (d.receiverShape === "narrowed" && Node.isIdentifier(recv) && (narrowed.has(recv.getText()) || b.names.has(recv.getText()))) {
        returnAdd(ctx, rule, pae, d, b, inits);
      }
    }
  }
}

function returnAdd(ctx: RuleContext, rule: DslRule, pae: TmNode, d: DslRule["detect"], b: Bindings, inits: Map<string, TmNode>) {
  add(ctx, pae, rule, rule.emit.severity, rule.emit.fix, rule.emit.message);
  applyRewrite(ctx, rule, pae);
}

/** Binding names narrowed by an enclosing `if (id instanceof ZodError)`. */
function narrowedIds(sf: SourceFile, b: Bindings): Set<string> {
  const out = new Set<string>();
  for (const ifStmt of sf.getDescendantsOfKind(SyntaxKind.IfStatement)) {
    const cond = ifStmt.getExpression();
    if (!(Node.isBinaryExpression(cond) && cond.getOperatorToken().getText() === "instanceof")) continue;
    const rhs = cond.getRight();
    let hit = false;
    if (Node.isIdentifier(rhs) && (b.errorNames.has(rhs.getText()) || rhs.getText() === "ZodError")) hit = true;
    else if (
      Node.isPropertyAccessExpression(rhs) &&
      rhs.getName() === "ZodError" &&
      Node.isIdentifier(rhs.getExpression()) &&
      b.names.has(rhs.getExpression().getText())
    )
      hit = true;
    if (!hit) continue;
    const lhs = cond.getLeft();
    if (Node.isIdentifier(lhs)) out.add(lhs.getText());
  }
  return out;
}
