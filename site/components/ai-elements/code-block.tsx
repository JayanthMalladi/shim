"use client";

import { createContext, useContext, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon, CopyIcon } from "./icons";

/**
 * After AI Elements' <CodeBlock>: code in a scrollable box with an optional
 * filename tab and actions (e.g. <CodeBlockCopyButton/>). Instead of syntax
 * colors, lines can be marked as the changed line (`highlight`) or a fix note.
 */
const CodeBlockContext = createContext<{ code: string }>({ code: "" });

export type CodeBlockProps = Omit<ComponentProps<"div">, "children"> & {
  code: string;
  filename?: string;
  /** Secondary label shown in the header, e.g. the rule id. */
  label?: string;
  /** 1-based line numbers to mark as the changed line. */
  highlight?: number[];
  /** 1-based line numbers rendered as a fix note (blue). */
  notes?: number[];
  variant?: "panel" | "inset";
  /** Header actions, rendered at the right of the filename tab. */
  children?: ReactNode;
};

export function CodeBlock({
  code,
  filename,
  label,
  highlight = [],
  notes = [],
  variant = "panel",
  className,
  children,
  ...props
}: CodeBlockProps) {
  const lines = code.split("\n");
  const pad = variant === "inset" ? "px-3" : "px-3.5";
  return (
    <CodeBlockContext.Provider value={{ code }}>
      <div className={cn("flex min-w-0 flex-col", className)} {...props}>
        {filename && (
          <div className="flex items-stretch justify-between gap-2 border-b border-line font-mono text-xs">
            <span className="shrink-0 border-r border-line bg-raised px-3.5 py-2.5 text-fg">{filename}</span>
            <span className="flex min-w-0 items-center gap-1">
              {label && <span className="truncate py-2.5 pl-1 text-muted">{label}</span>}
              {children}
            </span>
          </div>
        )}
        <pre
          tabIndex={0}
          role="region"
          aria-label={filename ? `Code: ${filename}` : "Code"}
          className={cn(
            "m-0 flex-1 overflow-x-auto font-mono text-[13px] leading-[1.75]",
            variant === "inset" ? "py-2.5" : "py-3.5",
          )}
        >
          <code className="block min-w-max">
            {lines.map((line, i) => {
              const n = i + 1;
              const isHl = highlight.includes(n);
              const isNote = notes.includes(n);
              return (
                <span
                  key={n}
                  className={cn(
                    "block whitespace-pre",
                    pad,
                    isHl ? "bg-amber-wash text-fg shadow-[inset_2px_0_0_var(--color-amber)]" : isNote ? "text-blue" : "text-muted",
                  )}
                >
                  {line || " "}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </CodeBlockContext.Provider>
  );
}

export type CodeBlockCopyButtonProps = Omit<ComponentProps<"button">, "type" | "onCopy" | "onError"> & {
  /** Text to copy; defaults to the enclosing CodeBlock's code. */
  value?: string;
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function CodeBlockCopyButton({
  value,
  onCopy,
  onError,
  timeout = 2000,
  className,
  "aria-label": ariaLabel = "Copy code",
  ...props
}: CodeBlockCopyButtonProps) {
  const { code } = useContext(CodeBlockContext);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API not available");
      await navigator.clipboard.writeText(value ?? code);
      setCopied(true);
      onCopy?.();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={copy}
      className={cn(
        "btn-ghost grid shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-muted transition-colors hover:text-fg",
        className,
      )}
      {...props}
    >
      {copied ? <CheckIcon className="text-blue" /> : <CopyIcon />}
      <span role="status" className="sr-only">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
