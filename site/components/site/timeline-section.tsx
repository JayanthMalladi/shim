import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** A section hung on the page's left rail: amber node + connecting line. */
export function TimelineSection({
  id,
  labelledBy,
  last = false,
  className,
  children,
}: {
  id: string;
  labelledBy: string;
  last?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className="flex gap-[clamp(14px,3vw,32px)]">
      <div aria-hidden="true" className="flex flex-[0_0_18px] flex-col items-center pt-1.5">
        {last ? (
          <span className="block size-3 rounded-full bg-amber" />
        ) : (
          <>
            <span className="box-border block size-3 rounded-full border-2 border-amber" />
            <span className="mt-1.5 block w-px flex-1 bg-line" />
          </>
        )}
      </div>
      <div className={cn("min-w-0 flex-1", last ? "pb-24" : "pb-28", className)}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="m-0 font-mono text-[13px] text-muted">{children}</p>;
}

export function SectionTitle({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className={cn(
        "mt-3 mb-0 text-[clamp(32px,3.6vw,48px)] leading-[1.08] font-semibold tracking-[-0.03em]",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function Lede({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn("mt-4 mb-0 text-[17px] text-fg-3", className)}>{children}</p>;
}
