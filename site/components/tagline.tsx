"use client";

import { useEffect, useRef } from "react";

const text = "The upgrade you keep postponing is one review away.";

/**
 * Tagline reveal: each word goes from muted to full ink as it crosses a line
 * 60% down the viewport. Words render in full ink without JS or with reduced motion.
 */
export function Tagline() {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const words = Array.from(el.querySelectorAll<HTMLSpanElement>(".tag-word"));
    words.forEach((w) => (w.style.color = "rgba(15, 23, 42, 0.28)"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).style.color = "";
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -40% 0px" },
    );
    words.forEach((w) => io.observe(w));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-label="Tagline" className="px-4 py-24">
      <p
        ref={ref}
        className="mx-auto m-0 max-w-[880px] text-4xl leading-10 font-semibold tracking-[-0.03em] text-balance text-ink sm:text-6xl sm:leading-none"
      >
        {text.split(" ").map((w, i) => (
          <span key={i} className="tag-word">
            {w}{" "}
          </span>
        ))}
      </p>
    </section>
  );
}
