"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  type CollapsibleProps,
} from "./collapsible";
import { BulbIcon, ChevronRightIcon } from "./icons";
import { Shimmer } from "./shimmer";

/** After AI Elements' <Reasoning>: a collapsible block of model reasoning. */
const ReasoningContext = createContext<{ isStreaming: boolean }>({ isStreaming: false });

export type ReasoningProps = CollapsibleProps & { isStreaming?: boolean };

export function Reasoning({ className, isStreaming = false, defaultOpen = true, ...props }: ReasoningProps) {
  return (
    <ReasoningContext.Provider value={{ isStreaming }}>
      <Collapsible
        defaultOpen={defaultOpen}
        className={cn("overflow-hidden rounded-[10px] border border-line bg-inset", className)}
        {...props}
      />
    </ReasoningContext.Provider>
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  label?: ReactNode;
};

export function ReasoningTrigger({ className, label = "Reasoning", ...props }: ReasoningTriggerProps) {
  const { isStreaming } = useContext(ReasoningContext);
  return (
    <CollapsibleTrigger
      className={cn(
        "group flex w-full cursor-pointer items-center gap-2 border-b border-line-soft px-3 py-2.5 text-left text-[13px] text-muted transition-colors aria-[expanded=false]:border-b-0 hover:bg-hover hover:text-fg-2 focus-visible:-outline-offset-2",
        className,
      )}
      {...props}
    >
      <BulbIcon />
      {isStreaming ? <Shimmer>Thinking…</Shimmer> : <span>{label}</span>}
      <ChevronRightIcon
        size={10}
        className="ml-auto text-faint transition-transform duration-150 group-aria-expanded:rotate-90 motion-reduce:transition-none"
      />
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export function ReasoningContent({ className, ...props }: ReasoningContentProps) {
  return <CollapsibleContent className={cn("text-[13px] text-fg-3", className)} {...props} />;
}
