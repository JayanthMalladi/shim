"use client";

import { useEffect, useRef, useState } from "react";
import { CloseIcon, LogoMark, MenuIcon } from "@/components/ai-elements/icons";
import { links } from "@/lib/site";
import { SiteLink } from "./placeholder";

const nav = [
  { href: "#problem", label: "Problem" },
  { href: "#pipeline", label: "Pipeline" },
  { href: "#proof", label: "Proof" },
  { href: "#pr", label: "The PR" },
  { href: links.repo, label: "GitHub" },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onResize = () => {
      if (window.matchMedia("(min-width: 768px)").matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className="border-b border-line">
      <div className="mx-auto box-border flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-[clamp(16px,4vw,48px)] py-3.5">
        <a href="#top" className="flex items-center gap-2.5 text-fg no-underline hover:text-fg">
          <LogoMark />
          <span className="text-lg font-semibold tracking-[-0.01em]">shim</span>
          <span className="rounded-full border border-edge px-2 py-0.5 font-mono text-xs text-muted">
            ai 6 → 7
          </span>
        </a>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden flex-wrap items-center gap-x-5 gap-y-1 text-sm md:flex">
          {nav.map((item) => (
            <a key={item.href} href={item.href} className="py-2.5 text-fg-2 no-underline hover:text-amber">
              {item.label}
            </a>
          ))}
          <SiteLink
            href={links.waitlist}
            className="btn-amber inline-flex min-h-10 items-center rounded-lg px-4 font-semibold no-underline"
          >
            Join waitlist
          </SiteLink>
        </nav>

        {/* Mobile: CTA stays visible, links collapse behind a menu button */}
        <div className="flex items-center gap-2 md:hidden">
          <SiteLink
            href={links.waitlist}
            className="btn-amber inline-flex min-h-10 items-center rounded-lg px-3.5 text-sm font-semibold no-underline"
          >
            Join waitlist
          </SiteLink>
          <button
            ref={buttonRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="btn-ghost grid size-10 cursor-pointer place-items-center rounded-lg border border-edge bg-transparent text-fg-2"
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>

        <nav
          id="mobile-nav"
          aria-label="Primary"
          hidden={!open}
          className="w-full border-t border-line-soft pt-2 md:hidden"
        >
          <ul className="m-0 flex list-none flex-col p-0">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-11 items-center text-[15px] text-fg-2 no-underline hover:text-amber"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </header>
  );
}
