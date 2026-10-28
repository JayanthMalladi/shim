"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  type CollapsibleProps,
} from "./collapsible";
import { CheckCircleIcon, ChevronRightIcon, ProgressIcon, XCircleIcon } from "./icons";
import { Shimmer } from "./shimmer";

/** After AI Elements' <Task>: a collapsible checklist with per-step status. */
export type TaskProps = CollapsibleProps;

export function Task({ className, defaultOpen = true, ...props }: TaskProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={cn("rounded-[14px] border border-line bg-panel", className)}
      {...props}
    />
  );
}

export type TaskTriggerProps = Omit<ComponentProps<typeof CollapsibleTrigger>, "title"> & {
  title: ReactNode;
  meta?: ReactNode;
};

export function TaskTrigger({ className, title, meta, ...props }: TaskTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full cursor-pointer items-center justify-between gap-3 rounded-t-[14px] border-b border-line px-[18px] py-3.5 text-left transition-colors hover:bg-hover focus-visible:-outline-offset-2 aria-[expanded=false]:rounded-b-[14px] aria-[expanded=false]:border-b-0",
        className,
      )}
      {...props}
    >
      <span className="font-semibold">{title}</span>
      <span className="flex items-center gap-2.5 font-mono text-xs text-muted">
        {meta}
        <ChevronRightIcon
          size={10}
          className="text-faint transition-transform duration-150 group-aria-expanded:rotate-90 motion-reduce:transition-none"
        />
      </span>
    </CollapsibleTrigger>
  );
}

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>;

export function TaskContent({ className, children, ...props }: TaskContentProps) {
  return (
    <CollapsibleContent {...props}>
      <ol className={cn("m-0 flex list-none flex-col px-[18px] pt-2 pb-[18px]", className)}>{children}</ol>
    </CollapsibleContent>
  );
}

export type TaskStatus = "done" | "in-progress" | "failed";

const statusLabel: Record<TaskStatus, string> = {
  done: "Done",
  "in-progress": "In review",
  failed: "Failed",
};

export type TaskItemProps = Omit<ComponentProps<"li">, "title"> & {
  status: TaskStatus;
  title: string;
  file?: ReactNode;
  statusText?: string;
};

export function TaskItem({ status, title, file, statusText, className, children, ...props }: TaskItemProps) {
  const label = statusText ?? statusLabel[status];
  const Icon = status === "done" ? CheckCircleIcon : status === "failed" ? XCircleIcon : ProgressIcon;
  return (
    <li
      className={cn(
        "grid grid-cols-[20px_1fr] gap-x-3.5 gap-y-1.5 border-b border-line-soft py-3.5 last:border-b-0",
        className,
      )}
      {...props}
    >
      <Icon size={18} label={label} className="mt-0.5" />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {status === "in-progress" ? (
          <Shimmer className="font-semibold">{title}</Shimmer>
        ) : (
          <span className="font-semibold">{title}</span>
        )}
        {file}
      </div>
      <span aria-hidden="true" />
      <span className="text-sm text-fg-3">{children}</span>
    </li>
  );
}

export function TaskItemFile({ className, ...props }: ComponentProps<"code">) {
  return <code className={cn("font-mono text-xs text-muted", className)} {...props} />;
}
