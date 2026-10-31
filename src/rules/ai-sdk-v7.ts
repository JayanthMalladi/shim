/**
 * AI SDK 6 -> 7 rules that the official codemod (`npx @ai-sdk/codemod v7`) and
 * the type checker do not cover. Most of them are silent: the code still
 * compiles but reads different data at runtime.
 *
 * Source: ai@7 docs/08-migration-guides/23-migration-guide-7-0.mdx
 */
import fs from "node:fs";
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type NewExpression,
  type ObjectLiteralExpression,
  type Project,
  type PropertyAccessExpression,
  type SourceFile,
  type TypeNode,
} from "ts-morph";
import type { Finding, FixKind, Severity } from "../types.js";

const RESULT_FNS = new Set(["generateText", "streamText"]);
const PROMPT_FNS = new Set(["generateText", "streamText", "generateObject", "streamObject", "streamUI"]);
/** Calls whose options accept `allowSystemInMessages`. */
const SYSTEM_MESSAGE_FNS = new Set(["generateText", "streamText", "generateObject", "streamObject"]);
/** The option lives in the constructor settings only: `.generate()`/`.stream()` params don't accept it. */
const AGENT_CLASSES = new Set(["ToolLoopAgent", "Experimental_Agent"]);
const ALLOW_SYSTEM = "allowSystemInMessages";

/** Result properties that used to hold the final step only and now accumulate across steps. */
const ACCUMULATED_PROPS = new Set([
  "content",
  "toolCalls",
  "staticToolCalls",
  "dynamicToolCalls",
  "toolResults",
  "staticToolResults",
  "dynamicToolResults",
  "files",
  "sources",
  "warnings",
]);

/** Types from `ai` that a generateText/streamText result is declared with. */
const RESULT_TYPES = new Set(["GenerateTextResult", "StreamTextResult"]);

const END_CALLBACKS = new Set(["onFinish", "onEnd", "experimental_onFinish"]);

interface AiCall {
  fn: string;
  call: CallExpression;
  options: ObjectLiteralExpression | undefined;
  /** "maybe": the options are built elsewhere (a variable or a spread), so stopWhen can't be seen. */
  multiStep: boolean | "maybe";
  /** The options are a variable or contain a spread we can't see into. */
  hidden: boolean;
}

export interface RuleContext {
  root: string;
  findings: Finding[];
  /** Deferred, behavior-preserving rewrites. Applied by applyAutoFixes. */
  edits: Array<{
    node: Node;
    text: string;
    /** Add `text` as a new object member after `node` (a member of an object literal) instead of replacing it. */
    after?: boolean;
  }>;
  /**
   * Deferred plain-text rewrites for files that are not in the ts-morph project (CI workflow YAML):
   * exact 1-based lines to replace or delete. Applied by applyAutoFixes, after the ts-morph edits.
   */
  fileEdits: Array<{ file: string; lines: Array<{ line: number; text?: string; delete?: boolean }> }>;
}

export function scanAiSdkV7(project: Project, root: string): RuleContext {
  const ctx: RuleContext = { root, findings: [], edits: [], fileEdits: [] };
  let usesTelemetryOption = false;
  let registersTelemetry = false;
  let firstTelemetryNode: Node | undefined;

  for (const sf of project.getSourceFiles()) {
    checkRequire(ctx, sf);
    const names = aiImportNames(sf);
    if (names.size === 0) continue;

    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const fn = calleeName(call, names);
      if (fn === "registerTelemetry") registersTelemetry = true;
      if (!fn || !PROMPT_FNS.has(fn)) continue;
      const aiCall = toAiCall(fn, call);

      checkSystemMessages(ctx, aiCall);
      if (aiCall.options) {
        const telemetry =
          aiCall.options.getProperty("experimental_telemetry") ?? aiCall.options.getProperty("telemetry");
        if (telemetry) {
          usesTelemetryOption = true;
          firstTelemetryNode ??= telemetry;
        }
      }
      if (RESULT_FNS.has(fn)) {
        if (aiCall.multiStep) checkResultReads(ctx, aiCall);
        if (aiCall.multiStep === true) checkEndCallback(ctx, aiCall);
        checkTotalUsage(ctx, aiCall);
      }
    }

    checkTypedResults(ctx, sf, names);
    checkToolExecutionOptions(ctx, sf, names);

    for (const expr of sf.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      const cls = calleeName(expr, names);
      if (cls && AGENT_CLASSES.has(cls)) checkAgentSystemMessages(ctx, expr);
    }
  }

  if (usesTelemetryOption && !registersTelemetry && firstTelemetryNode) {
    add(ctx, firstTelemetryNode, "telemetry-needs-otel", "silent", "manual",
      "OpenTelemetry moved to @ai-sdk/otel. Without `registerTelemetry(new OpenTelemetry())` at startup, " +
      "traces stop being emitted with no error. Install @ai-sdk/otel and register it once.");
  }
  return ctx;
}

/** Local names bound to exports of `ai`, mapped to the export name. Namespace imports map as `ns.*`. */
function aiImportNames(sf: SourceFile): Map<string, string> {
  const names = new Map<string, string>();
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== "ai") continue;
    const ns = decl.getNamespaceImport();
    if (ns) names.set(`${ns.getText()}.*`, "*");
    for (const spec of decl.getNamedImports()) {
      names.set(spec.getAliasNode()?.getText() ?? spec.getName(), spec.getName());
    }
  }
  return names;
}

function calleeName(call: CallExpression | NewExpression, names: Map<string, string>): string | undefined {
  const callee = call.getExpression();
  if (Node.isIdentifier(callee)) return names.get(callee.getText());
  if (Node.isPropertyAccessExpression(callee) && names.has(`${callee.getExpression().getText()}.*`)) {
    return callee.getName();
  }
  return undefined;
}

function toAiCall(fn: string, call: CallExpression): AiCall {
  const arg = call.getArguments()[0];
  const options = arg && Node.isObjectLiteralExpression(arg) ? arg : undefined;
  // v6 defaults to a single step; only stopWhen (or legacy maxSteps) makes a call multi-step.
  const explicit = !!options && optionLiterals(options).some((o) => !!o.getProperty("stopWhen") || !!o.getProperty("maxSteps"));
  // Options we can't see into: a variable, or a spread of anything but inline object literals.
  const hidden = !!arg && (!options || hasOpaqueSpread(options));
  return { fn, call, options, multiStep: explicit || (hidden ? "maybe" : false), hidden };
}

/** The options object plus the literals spread into it. */
function optionLiterals(options: ObjectLiteralExpression): ObjectLiteralExpression[] {
  return [options, ...options.getProperties().flatMap((p) => (Node.isSpreadAssignment(p) ? spreadLiterals(p.getExpression()) ?? [] : []))];
}

function hasOpaqueSpread(options: ObjectLiteralExpression): boolean {
  return options.getProperties().some((p) => Node.isSpreadAssignment(p) && !spreadLiterals(p.getExpression()));
}

/** `...{ a }` and `...(cond ? { a } : {})` are transparent; returns their object literals, or undefined. */
function spreadLiterals(expr: Node): ObjectLiteralExpression[] | undefined {
  while (Node.isParenthesizedExpression(expr)) expr = expr.getExpression();
  if (Node.isObjectLiteralExpression(expr)) return [expr];
  if (Node.isConditionalExpression(expr)) {
    const a = spreadLiterals(expr.getWhenTrue());
    const b = spreadLiterals(expr.getWhenFalse());
    return a && b ? [...a, ...b] : undefined;
  }
  return undefined;
}

function checkRequire(ctx: RuleContext, sf: SourceFile) {
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== "require") continue;
    const arg = call.getArguments()[0];
    if (!arg || !Node.isStringLiteral(arg)) continue;
    const mod = arg.getLiteralValue();
    if (mod === "ai" || mod.startsWith("@ai-sdk/")) {
      add(ctx, call, "esm-only", "break", "agent",
        `AI SDK 7 is ESM-only; require('${mod}') throws. Convert this module to ESM imports.`);
    }
  }
}

/**
 * v7 rejects `role: 'system'` in `messages`/`prompt` unless `allowSystemInMessages` is set, and v6 accepted it.
 * Unless the messages are provably system-free, set the option: it keeps the v6 behavior.
 */
function checkSystemMessages(ctx: RuleContext, { fn, call, options, hidden }: AiCall) {
  if (!SYSTEM_MESSAGE_FNS.has(fn) || !call.getArguments()[0]) return;
  if (!options) return maybeSystem(ctx, call);
  if (optionLiterals(options).some((o) => o.getProperty(ALLOW_SYSTEM))) return;
  const { kind, node } = inspectPrompt(options);
  if (kind === "hidden" || (kind === "none" && hidden)) return maybeSystem(ctx, call);
  if (kind === "system" || kind === "unknown") {
    allowSystem(ctx, node!, options, kind === "system"
      ? "`messages`/`prompt` has a system message, which AI SDK 7 rejects at runtime by default."
      : "`messages`/`prompt` is built elsewhere and may hold a system message, which AI SDK 7 rejects at runtime by default.");
  }
}

/**
 * The option is a constructor setting. Check how the agent is used: it is only left alone when every use
 * is `.generate()`/`.stream()` with provably system-free messages. An agent we can't follow gets the option.
 */
function checkAgentSystemMessages(ctx: RuleContext, expr: NewExpression) {
  const arg = expr.getArguments()[0];
  if (!arg) return;
  if (!Node.isObjectLiteralExpression(arg) || hasOpaqueSpread(arg)) return maybeSystem(ctx, expr);
  if (optionLiterals(arg).some((o) => o.getProperty(ALLOW_SYSTEM))) return;
  // prepareCall can supply messages of its own, so its output isn't visible here.
  const uses = optionLiterals(arg).some((o) => o.getProperty("prepareCall")) ? undefined : agentCallOptions(expr);
  if (uses?.every((o) => ["none", "free"].includes(inspectPrompt(o).kind))) return;
  allowSystem(ctx, expr, arg,
    "This agent may be called with a system message in `messages`/`prompt` (or its calls aren't visible here), which AI SDK 7 rejects " +
    "by default. Only the constructor accepts the option; `.generate()`/`.stream()` don't.");
}

/** Options of every `.generate()`/`.stream()` call on the agent; undefined if the agent can be used any other way. */
function agentCallOptions(expr: NewExpression): ObjectLiteralExpression[] | undefined {
  const decl = expr.getParent();
  if (!decl || !Node.isVariableDeclaration(decl) || decl.getInitializer() !== expr) return undefined;
  const name = decl.getNameNode();
  if (!Node.isIdentifier(name) || decl.getVariableStatement()?.isExported()) return undefined;
  const uses: ObjectLiteralExpression[] = [];
  for (const ref of name.findReferencesAsNodes()) {
    const access = ref.getParent();
    if (!Node.isPropertyAccessExpression(access) || access.getExpression() !== ref) return undefined;
    if (["id", "tools"].includes(access.getName())) continue;
    const call = access.getParent();
    const opts = Node.isCallExpression(call) ? call.getArguments()[0] : undefined;
    if (!["generate", "stream"].includes(access.getName()) || !opts || !Node.isObjectLiteralExpression(opts)) return undefined;
    uses.push(opts);
  }
  return uses;
}

type PromptKind = "none" | "free" | "system" | "unknown" | "hidden";

/**
 * What `messages`/`prompt` can hold. "free": provably no system message. "system": a literal one.
 * "unknown": built elsewhere. "hidden": no messages in sight, but the options have a spread we can't see into.
 */
function inspectPrompt(options: ObjectLiteralExpression): { kind: PromptKind; node?: Node } {
  let free = false;
  let unknown: Node | undefined;
  for (const o of optionLiterals(options)) {
    for (const key of ["messages", "prompt"]) {
      const prop = o.getProperty(key);
      if (!prop) continue;
      const r = classifyPrompt(prop, key);
      if (r.kind === "system") return r;
      if (r.kind === "unknown") unknown ??= prop;
      else free = true;
    }
  }
  if (unknown) return { kind: "unknown", node: unknown };
  return { kind: free ? "free" : hasOpaqueSpread(options) ? "hidden" : "none" };
}

function classifyPrompt(prop: Node, key: string): { kind: "free" | "unknown" } | { kind: "system"; node: Node } {
  const value = Node.isPropertyAssignment(prop) ? unwrap(prop.getInitializer()) : Node.isShorthandPropertyAssignment(prop) ? prop.getNameNode() : undefined;
  if (!value) return { kind: "unknown" };
  if (key === "prompt" && isStringType(value)) return { kind: "free" };
  if (!Node.isArrayLiteralExpression(value)) return { kind: "unknown" };
  let unknown = false;
  for (const el of value.getElements()) {
    const obj = unwrap(el);
    const role = Node.isObjectLiteralExpression(obj) && !obj.getProperties().some((p) => Node.isSpreadAssignment(p)) ? obj.getProperty("role") : undefined;
    const roleValue = role && Node.isPropertyAssignment(role) ? unwrap(role.getInitializer()) : undefined;
    if (!roleValue || !(Node.isStringLiteral(roleValue) || Node.isNoSubstitutionTemplateLiteral(roleValue))) unknown = true;
    else if (roleValue.getLiteralValue() === "system") return { kind: "system", node: obj };
  }
  return { kind: unknown ? "unknown" : "free" };
}

function unwrap(node: Node): Node;
function unwrap(node: Node | undefined): Node | undefined;
function unwrap(node: Node | undefined): Node | undefined {
  while (node && (Node.isParenthesizedExpression(node) || Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isNonNullExpression(node))) {
    node = node.getExpression();
  }
  return node;
}

/** A `prompt` that is a string (not a message array); needs a resolvable type, so an unresolved import doesn't count. */
function isStringType(node: Node): boolean {
  const type = node.getType();
  return [type, ...(type.isUnion() ? type.getUnionTypes() : [])].every((t) => t.isString() || t.isStringLiteral() || t.isTemplateLiteral());
}

/** Record the finding at `at` and queue the option as a new member after the options' last member. */
function allowSystem(ctx: RuleContext, at: Node, options: ObjectLiteralExpression, why: string) {
  add(ctx, at, "system-in-messages", "break", "auto", `${why} \`${ALLOW_SYSTEM}: true\` keeps the v6 behavior.`);
  ctx.edits.push({ node: options.getProperties().at(-1) ?? options, text: `${ALLOW_SYSTEM}: true`, after: true });
}

/**
 * Not "break": the agent can't make the scanner stop seeing opaque options, so a break here could never
 * resolve and would block every such repo.
 */
function maybeSystem(ctx: RuleContext, node: Node) {
  add(ctx, node, "maybe-system-in-messages", "silent", "agent",
    "This call's options are built elsewhere. If `messages`/`prompt` can hold a system message, AI SDK 7 rejects it at runtime: " +
    `set \`${ALLOW_SYSTEM}: true\` in the options (keeps the v6 behavior), or move it to \`instructions\`.`);
}

/**
 * Reads on the result of a multi-step generateText/streamText call. When the call is only maybe
 * multi-step, the findings go to the agent with no rewrite: on a single-step call the read is fine as is.
 */
function checkResultReads(ctx: RuleContext, { fn, call, multiStep }: AiCall) {
  const decl = resultDeclaration(call);
  if (!decl) return;
  const nameNode = decl.getNameNode();
  const maybe = multiStep === "maybe";
  const ruleId = maybe ? "maybe-multi-step-result" : "multi-step-result";
  const auto = fn === "generateText" && !maybe;
  const prefix = maybe ? "This call's options are built elsewhere; if they set stopWhen, " : "";

  if (Node.isObjectBindingPattern(nameNode)) {
    for (const el of nameNode.getElements()) {
      const prop = el.getPropertyNameNode()?.getText() ?? el.getName();
      if (prop === "usage" || ACCUMULATED_PROPS.has(prop)) {
        add(ctx, el, ruleId, "silent", "agent",
          `${prefix}\`${prop}\` now covers every step, not just the last one. Read it from \`finalStep\` to keep the v6 value.`);
      }
    }
    return;
  }
  if (!Node.isIdentifier(nameNode)) return;
  const symbol = nameNode.getSymbol();
  const scope = decl.getFirstAncestor((n) => Node.isBlock(n) || Node.isSourceFile(n)) ?? decl.getSourceFile();

  for (const access of scope.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression();
    if (!Node.isIdentifier(target) || target.getSymbol() !== symbol) continue;
    const prop = access.getName();
    const v = target.getText();
    const parent = access.getParent();

    if (prop === "response" && Node.isPropertyAccessExpression(parent) && parent.getName() === "messages") {
      // result.response is now the final step's response, so .messages lost the earlier steps.
      add(ctx, parent, maybe ? ruleId : "response-messages", "silent", auto ? "auto" : "agent",
        `${prefix}\`response.messages\` now holds only the final step's messages. Use \`responseMessages\` for the full history.`);
      if (auto) ctx.edits.push({ node: parent, text: `${v}.responseMessages` });
      continue;
    }
    if (prop === "usage" || ACCUMULATED_PROPS.has(prop)) {
      add(ctx, access, ruleId, "silent", auto ? "auto" : "agent",
        `${prefix}\`${v}.${prop}\` now covers every step, not just the last one. ` +
        `\`${v}.finalStep.${prop}\` keeps the v6 value.`);
      if (auto) ctx.edits.push({ node: access, text: `${v}.finalStep.${prop}` });
    }
  }
}

/**
 * Results that reach a read through a declared type instead of the call itself: a helper returns
 * `generateText(...)` and another function takes `result: Awaited<ReturnType<typeof generateText>>`. We
 * can't see the producing call, so these go to the agent with no rewrite. Variables initialised straight
 * from a generateText/streamText call are checkResultReads' job and are skipped here.
 */
function checkTypedResults(ctx: RuleContext, sf: SourceFile, names: Map<string, string>) {
  const typed = new Set<object>();
  const symbolOf = (expr: Node) =>
    Node.isIdentifier(expr) ? expr.getSymbol() : Node.isPropertyAccessExpression(expr) ? expr.getNameNode().getSymbol() : undefined;
  const flag = (node: Node, label: string, prop: string) => add(ctx, node, "typed-multi-step-result", "silent", "agent",
    `\`${label}\` is declared as an AI SDK result. If the call that produced it runs several steps, ` +
    (prop === "response.messages"
      ? "`response.messages` now holds only the final step's messages. Use `responseMessages` for the full history."
      : `\`${prop}\` now covers every step. Read \`finalStep.${prop}\` to keep the v6 value.`));
  const reads = (prop: string) => prop === "usage" || ACCUMULATED_PROPS.has(prop);

  for (const decl of sf.getDescendants()) {
    if (!(Node.isParameterDeclaration(decl) || Node.isVariableDeclaration(decl) || Node.isPropertyDeclaration(decl) || Node.isPropertySignature(decl))) continue;
    const type = decl.getTypeNode();
    if (!type || !namesResultType(type, names)) continue;
    const init = Node.isVariableDeclaration(decl) ? decl.getInitializer() : undefined;
    const call = Node.isAwaitExpression(init) ? init.getExpression() : init;
    if (call && Node.isCallExpression(call) && RESULT_FNS.has(calleeName(call, names) ?? "")) continue;
    const nameNode = decl.getNameNode();
    if (Node.isObjectBindingPattern(nameNode)) {
      for (const el of nameNode.getElements()) {
        const prop = el.getPropertyNameNode()?.getText() ?? el.getName();
        if (reads(prop)) flag(el, prop, prop);
      }
    } else {
      const symbol = nameNode.getSymbol();
      if (symbol) typed.add(symbol);
    }
  }
  if (!typed.size) return;

  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const nameNode = decl.getNameNode();
    const init = decl.getInitializer();
    const symbol = init && symbolOf(init);
    if (!Node.isObjectBindingPattern(nameNode) || !init || !symbol || !typed.has(symbol)) continue;
    for (const el of nameNode.getElements()) {
      const prop = el.getPropertyNameNode()?.getText() ?? el.getName();
      if (reads(prop)) flag(el, init.getText(), prop);
    }
  }
  for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression();
    const symbol = symbolOf(target);
    if (!symbol || !typed.has(symbol)) continue;
    const prop = access.getName();
    const parent = access.getParent();
    if (prop === "response" && Node.isPropertyAccessExpression(parent) && parent.getName() === "messages") {
      flag(parent, parent.getText(), "response.messages");
    } else if (reads(prop)) {
      flag(access, access.getText(), prop);
    }
  }
}

/** `GenerateTextResult<...>`, `Awaited<ReturnType<typeof generateText>>` and the like, with `ai` as the source. */
function namesResultType(type: TypeNode, names: Map<string, string>): boolean {
  if (Node.isParenthesizedTypeNode(type)) return namesResultType(type.getTypeNode(), names);
  if (Node.isUnionTypeNode(type)) return type.getTypeNodes().some((t) => namesResultType(t, names));
  if (!Node.isTypeReference(type)) return false;
  const ai = (text: string) => {
    const dot = text.lastIndexOf(".");
    return names.get(text) ?? (dot > 0 && names.has(`${text.slice(0, dot)}.*`) ? text.slice(dot + 1) : undefined);
  };
  const name = type.getTypeName().getText();
  const arg = type.getTypeArguments()[0];
  if (RESULT_TYPES.has(ai(name) ?? "")) return true;
  if (name === "Awaited" && arg) return namesResultType(arg, names);
  if (name === "ReturnType" && arg && Node.isTypeQuery(arg)) return RESULT_FNS.has(ai(arg.getExprName().getText()) ?? "");
  return false;
}

function resultDeclaration(call: CallExpression) {
  let node: Node = call;
  const parent = node.getParent();
  if (parent && Node.isAwaitExpression(parent)) node = parent;
  const decl = node.getParent();
  return decl && Node.isVariableDeclaration(decl) && decl.getInitializer() === node ? decl : undefined;
}

/** `onFinish(event)` / `onEnd(event)` on a multi-step call: event.usage etc. changed meaning too. */
function checkEndCallback(ctx: RuleContext, { options }: AiCall) {
  if (!options) return;
  for (const name of END_CALLBACKS) {
    const prop = options.getProperty(name);
    if (!prop) continue;
    const fnNode = Node.isMethodDeclaration(prop)
      ? prop
      : Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined;
    if (!fnNode || !(Node.isMethodDeclaration(fnNode) || Node.isArrowFunction(fnNode) || Node.isFunctionExpression(fnNode))) continue;
    const param = fnNode.getParameters()[0];
    if (!param) continue;
    const pname = param.getNameNode();

    if (Node.isObjectBindingPattern(pname)) {
      for (const el of pname.getElements()) {
        const p = el.getPropertyNameNode()?.getText() ?? el.getName();
        if (p === "usage" || ACCUMULATED_PROPS.has(p)) {
          add(ctx, el, "multi-step-end-event", "silent", "agent",
            `\`${p}\` in ${name} now covers every step. Destructure \`finalStep\` and read \`finalStep.${p}\` to keep the v6 value.`);
        }
      }
      continue;
    }
    const symbol = pname.getSymbol();
    for (const access of fnNode.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const t = access.getExpression();
      if (!Node.isIdentifier(t) || t.getSymbol() !== symbol) continue;
      const p = access.getName();
      if (p === "usage" || ACCUMULATED_PROPS.has(p)) {
        add(ctx, access, "multi-step-end-event", "silent", "auto",
          `\`${t.getText()}.${p}\` in ${name} now covers every step. \`${t.getText()}.finalStep.${p}\` keeps the v6 value.`);
        ctx.edits.push({ node: access, text: `${t.getText()}.finalStep.${p}` });
      }
    }
  }
}

/**
 * `totalUsage` is deprecated; `usage` now means the same thing. Only on AI SDK results: the repo's own
 * objects can have a `totalUsage` field that means something else.
 */
function checkTotalUsage(ctx: RuleContext, { call }: AiCall) {
  const decl = resultDeclaration(call);
  const nameNode = decl?.getNameNode();
  if (!decl || !nameNode || !Node.isIdentifier(nameNode)) return;
  const symbol = nameNode.getSymbol();
  const scope = decl.getFirstAncestor((n) => Node.isBlock(n) || Node.isSourceFile(n)) ?? decl.getSourceFile();
  for (const access of scope.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const target = access.getExpression();
    if (access.getName() !== "totalUsage" || !Node.isIdentifier(target) || target.getSymbol() !== symbol) continue;
    add(ctx, access, "total-usage", "deprecated", "auto", "`totalUsage` is deprecated; `usage` now covers all steps.");
    ctx.edits.push({ node: access, text: `${target.getText()}.usage` });
  }
}

/**
 * AI SDK 7 added a required `context` field to `ToolExecutionOptions`. Code (mostly tests) that
 * builds an options literal with `toolCallId`/`messages` but no `context` stopped type-checking.
 * Flag such literals so the fixer adds the minimal `context` field it is now allowed to make.
 */
const TOOL_EXEC_CONTEXT_MSG =
  "AI SDK 7's `ToolExecutionOptions` now has a required `context` field; this literal is missing it. " +
  "Add a `context` property matching the tool's `contextSchema` (or `{}` when the tool defines none) " +
  "so the call type-checks. In a test this is a minimal type-only edit.";

function hasProp(literal: ObjectLiteralExpression, name: string): boolean {
  return literal.getProperty(name) !== undefined;
}

function checkToolExecutionOptions(ctx: RuleContext, sf: SourceFile, names: Map<string, string>) {
  // Route 1: an object literal passed as the 2nd arg to a tool's `.execute(...)`.
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!(Node.isPropertyAccessExpression(callee) && callee.getName() === "execute")) continue;
    const literal = call.getArguments()[1];
    if (!literal || !Node.isObjectLiteralExpression(literal)) continue;
    // The `toolCallId` marker keeps this precise: a ToolExecutionOptions literal missing `context`.
    if (hasProp(literal, "toolCallId") && !hasProp(literal, "context")) {
      add(ctx, literal, "tool-execution-context", "break", "agent", TOOL_EXEC_CONTEXT_MSG);
    }
  }
  // Route 2: a variable explicitly annotated as ToolExecutionOptions, initialized with a literal.
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const type = decl.getTypeNode();
    if (!type || !namesToolExecOptions(type, names)) continue;
    const init = decl.getInitializer();
    if (!init || !Node.isObjectLiteralExpression(init)) continue;
    if (!hasProp(init, "context")) {
      add(ctx, init, "tool-execution-context", "break", "agent", TOOL_EXEC_CONTEXT_MSG);
    }
  }
}

/** `ToolExecutionOptions`, `ToolExecutionOptions<...>`, and `ns.ToolExecutionOptions`, with `ai` as the source. */
function namesToolExecOptions(type: TypeNode, names: Map<string, string>): boolean {
  if (!Node.isTypeReference(type)) return false;
  const ai = (text: string) => {
    const dot = text.lastIndexOf(".");
    return names.get(text) ?? (dot > 0 && names.has(`${text.slice(0, dot)}.*`) ? text.slice(dot + 1) : undefined);
  };
  return ai(type.getTypeName().getText()) === "ToolExecutionOptions";
}

function add(ctx: RuleContext, node: Node, ruleId: string, severity: Severity, fix: FixKind, message: string) {
  const sf = node.getSourceFile();
  ctx.findings.push({
    ruleId,
    severity,
    fix,
    file: path.relative(ctx.root, sf.getFilePath()),
    line: node.getStartLineNumber(),
    snippet: node.getText().split("\n")[0]!.slice(0, 160),
    message,
  });
}

/** Apply collected rewrites, innermost-last so outer edits don't invalidate inner nodes. */
export async function applyAutoFixes(project: Project, ctx: RuleContext): Promise<number> {
  const edits = [...ctx.edits].sort((a, b) => b.node.getStart() - a.node.getStart());
  let applied = 0;
  // Plain-text edits: the file is not in the ts-morph project, so rewrite it line-by-line by number.
  // Done before the ts-morph edits; project.save() only writes the project's own files, so they don't collide.
  for (const fe of ctx.fileEdits) {
    const abs = path.join(ctx.root, fe.file);
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const map = new Map(fe.lines.map((o) => [o.line, o]));
    const out: string[] = [];
    for (let i = 1; i <= lines.length; i++) {
      const op = map.get(i);
      if (!op) {
        out.push(lines[i - 1]!);
        continue;
      }
      if (op.delete) {
        applied++;
        continue;
      }
      out.push(op.text ?? "");
      applied++;
    }
    fs.writeFileSync(abs, out.join("\n"));
  }
  for (const { node, text, after } of edits) {
    if (after || node.wasForgotten()) continue;
    (node as PropertyAccessExpression).replaceWithText(text);
    applied++;
  }
  // New members go in last, as plain text per file: ts-morph reindents text it inserts around a node.
  const inserts = new Map<SourceFile, Array<{ end: number; text: string }>>();
  for (const { node, text, after } of edits) {
    if (!after || node.wasForgotten()) continue;
    const full = node.getSourceFile().getFullText();
    const lead = full.slice(full.lastIndexOf("\n", node.getStart() - 1) + 1, node.getStart());
    const sep = /^\s*$/.test(lead) ? `,\n${lead}` : ", ";
    const list = inserts.get(node.getSourceFile()) ?? [];
    list.push({ end: node.getEnd(), text: sep + text });
    inserts.set(node.getSourceFile(), list);
    applied++;
  }
  for (const [sf, list] of inserts) {
    let full = sf.getFullText();
    for (const { end, text } of list.sort((a, b) => b.end - a.end)) full = full.slice(0, end) + text + full.slice(end);
    sf.replaceWithText(full);
  }
  await project.save();
  return applied;
}
