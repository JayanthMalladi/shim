import { CodeBlockCopyButton } from "@/components/ai-elements/code-block";

export function CopyCommand({ command }: { command: string }) {
  return (
    <div className="flex min-h-12 max-w-full items-center rounded-[10px] border border-edge bg-field font-mono text-sm">
      <span aria-hidden="true" className="pl-4 text-faint">
        $
      </span>
      <code className="min-w-0 truncate px-2.5 text-fg">{command}</code>
      <CodeBlockCopyButton value={command} aria-label="Copy command" className="mr-0.5 size-11" />
    </div>
  );
}
