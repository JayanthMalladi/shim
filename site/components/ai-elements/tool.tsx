"use client";

import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  type CollapsibleProps,
} from "./collapsible";
import { CheckCircleIcon, ChevronRightIcon, SpinnerIcon, XCircleIcon } from "./icons";

/**
 * Tool row, after AI Elements' <Tool>: a collapsible step in an agent
 * transcript with a name, status and expandable input/output.
 * States mirror the AI SDK `ToolUIPart["state"]` values.
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "approval-responded"
  | "output-available"
  | "output-error"
  | "output-denied";

const defaultStatusLabel: Record<ToolState, string> = {
  "input-streaming": "Pending",
  "input-available": "Running",
  "approval-responded": "Approved",
  "output-available": "Done",
  "output-error": "Error",
  "output-denied": "Rejected",
};

export type ToolProps = CollapsibleProps;

export function Tool({ className, ...props }: ToolProps) {
  return <Collapsible className={cn("border-b border-line-soft", className)} {...props} />;
}

function StatusIcon({ state, label }: { state: ToolState; label: string }) {
  if (state === "output-error" || state === "output-denied") return <XCircleIcon label={label} />;
  if (state === "input-streaming" || state === "input-available")
    return <SpinnerIcon role="img" aria-label={label} aria-hidden={undefined} />;
  return <CheckCircleIcon label={label} />;
}

export type ToolHeaderProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "title"> & {
  title: string;
  state: ToolState;
  description?: ReactNode;
  /** Keep the description on one line with an ellipsis. */
  truncate?: boolean;
  badge?: ReactNode;
  statusLabel?: string;
  /** Show a brief "running" spinner before the final status (CSS-timed, see .stream-row). */
  streaming?: boolean;
};

export function ToolHeader({
  className,
  title,
  state,
  description,
  truncate = false,
  badge,
  statusLabel,
  streaming = false,
  ...props
}: ToolHeaderProps) {
  const label = statusLabel ?? defaultStatusLabel[state];
  return (
    <CollapsibleTrigger
      className={cn(
        // Phones: name + badge on one line, description below. sm+: one row, as in the mockup.
        "group grid w-full cursor-pointer grid-cols-[12px_16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-3 text-left text-sm transition-colors hover:bg-hover focus-visible:-outline-offset-2 sm:flex",
        className,
      )}
      {...props}
    >
      <ChevronRightIcon className="row-start-1 shrink-0 text-faint transition-transform duration-150 group-aria-expanded:rotate-90 motion-reduce:transition-none" />
      <span className="relative row-start-1 grid size-4 shrink-0 place-items-center">
        {streaming && (
          <span className="status-running absolute inset-0 grid place-items-center motion-reduce:hidden">
            <SpinnerIcon />
          </span>
        )}
        <span className={cn("grid place-items-center", streaming && "status-done")}>
          <StatusIcon state={state} label={label} />
        </span>
      </span>
      <span className="col-start-3 row-start-1 min-w-[72px] font-mono text-fg">{title}</span>
      {description && (
        <span
          className={cn(
            "col-span-2 col-start-3 row-start-2 min-w-0 flex-1 text-muted",
            truncate && "sm:truncate",
          )}
        >
          {description}
        </span>
      )}
      {badge && <span className="col-start-4 row-start-1 flex shrink-0 justify-end">{badge}</span>}
    </CollapsibleTrigger>
  );
}

export type ToolBadgeProps = ComponentProps<"span"> & { tone?: "outline" | "approved" | "rejected" };

export function ToolBadge({ tone = "outline", className, ...props }: ToolBadgeProps) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-md font-mono text-xs",
        tone === "outline" && "border border-edge px-1.5 py-px text-muted",
        tone === "approved" && "bg-blue px-2 py-px font-semibold text-ground",
        tone === "rejected" && "bg-amber px-2 py-px font-semibold text-ground",
        className,
      )}
      {...props}
    />
  );
}

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export function ToolContent({ className, ...props }: ToolContentProps) {
  return <CollapsibleContent className={cn("pr-4 pb-3.5 pl-[68px] sm:pl-14", className)} {...props} />;
}

export type ToolOutputProps = Omit<ComponentProps<"div">, "children"> & {
  output: ReactNode;
  errorText?: string;
};

export function ToolOutput({ className, output, errorText, ...props }: ToolOutputProps) {
  if (!output && !errorText) return null;
  return (
    <div className={cn("text-[13px] text-muted", className)} {...props}>
      {errorText ? <p className="text-amber">{errorText}</p> : output}
    </div>
  );
}

/** Wraps a row so it streams into view; `index` sets its place in the sequence. */
export function StreamRow({
  index,
  className,
  style,
  ...props
}: ComponentProps<"div"> & { index: number }) {
  return (
    <div
      className={cn("stream-row", className)}
      style={{ ...style, "--i": index } as CSSProperties}
      {...props}
    />
  );
}
