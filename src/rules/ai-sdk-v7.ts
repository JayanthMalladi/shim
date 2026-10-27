/**
 * AI SDK 6 -> 7 rules that the official codemod (`npx @ai-sdk/codemod v7`) and
 * the type checker do not cover. Most of them are silent: the code still
 * compiles but reads different data at runtime.
 *
 * Source: ai@7 docs/08-migration-guides/23-migration-guide-7-0.mdx
 */
import path from "node:path";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type Project,
  type PropertyAccessExpression,
  type SourceFile,
} from "ts-morph";
import type { Finding, FixKind, Severity } from "../types.js";

const RESULT_FNS = new Set(["generateText", "streamText"]);
const PROMPT_FNS = new Set(["generateText", "streamText", "generateObject", "streamObject", "streamUI"]);

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

const END_CALLBACKS = new Set(["onFinish", "onEnd", "experimental_onFinish"]);

interface AiCall {
  fn: string;
  call: CallExpression;
  options: ObjectLiteralExpression | undefined;
  /** "maybe": the options are built elsewhere (a variable or a spread), so stopWhen can't be seen. */
  multiStep: boolean | "maybe";
}

export interface RuleContext {
  root: string;
  findings: Finding[];
  /** Deferred, behavior-preserving rewrites. Applied by applyAutoFixes. */
  edits: Array<{ node: Node; text: string }>;
}

export function scanAiSdkV7(project: Project, root: string): RuleContext {
  const ctx: RuleContext = { root, findings: [], edits: [] };
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

      if (aiCall.options) {
        checkSystemMessages(ctx, aiCall.options);
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

function calleeName(call: CallExpression, names: Map<string, string>): string | undefined {
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
  const literals = options ? [options, ...options.getProperties().flatMap((p) => (Node.isSpreadAssignment(p) ? spreadLiterals(p.getExpression()) ?? [] : []))] : [];
  const explicit = literals.some((o) => !!o.getProperty("stopWhen") || !!o.getProperty("maxSteps"));
  // Options we can't see into: a variable, or a spread of anything but inline object literals.
  const hidden = !!arg && (!options || options.getProperties().some((p) => Node.isSpreadAssignment(p) && !spreadLiterals(p.getExpression())));
  return { fn, call, options, multiStep: explicit || (hidden ? "maybe" : false) };
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

function checkSystemMessages(ctx: RuleContext, options: ObjectLiteralExpression) {
  for (const key of ["messages", "prompt"]) {
    const prop = options.getProperty(key);
    if (!prop || !Node.isPropertyAssignment(prop)) continue;
    const init = prop.getInitializer();
    if (!init || !Node.isArrayLiteralExpression(init)) continue;
    for (const el of init.getElements()) {
      if (!Node.isObjectLiteralExpression(el)) continue;
      const role = el.getProperty("role");
      if (role && Node.isPropertyAssignment(role) && /^['"`]system['"`]$/.test(role.getInitializer()?.getText() ?? "")) {
        add(ctx, el, "system-in-messages", "break", "agent",
          "AI SDK 7 rejects system messages inside `messages`/`prompt` at runtime. " +
          "Move the content to the top-level `instructions` option.");
      }
    }
  }
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
  for (const { node, text } of edits) {
    if (node.wasForgotten()) continue;
    (node as PropertyAccessExpression).replaceWithText(text);
    applied++;
  }
  await project.save();
  return applied;
}
