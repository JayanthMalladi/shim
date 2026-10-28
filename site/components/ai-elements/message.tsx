import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** After AI Elements' <Message>: one turn in a conversation. */
export type MessageProps = ComponentProps<"div"> & { from: "user" | "assistant" | "system" };

export function Message({ from, className, ...props }: MessageProps) {
  return <div data-from={from} className={cn("group w-full", className)} {...props} />;
}

export function MessageContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex min-w-0 flex-col", className)} {...props} />;
}
