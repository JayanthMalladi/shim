import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Text with a moving highlight; static under prefers-reduced-motion. */
export function Shimmer({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("shimmer", className)} {...props} />;
}
