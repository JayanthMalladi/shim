"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./icons";
import { SiteLink } from "./site-link";
import { links } from "@/lib/site";

const nav = [
  { href: "#how", label: "How it works" },
  { href: "#prs", label: "Live PRs" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

/** Floating pill nav. On phones the links open in a full height panel. */
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
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return (
    <header className="sticky top-4 z-40 px-4">
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-4 rounded-full border border-line bg-white/80 py-2 pr-2 pl-4 backdrop-blur-lg">
        <a href="#top" className="flex items-center gap-2 no-underline">
          <LogoMark />
          <span className="title-2 font-semibold">shim</span>
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="body-6 font-medium text-body no-underline transition-colors duration-300 hover:text-ink"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <SiteLink href={links.booking} className="btn btn-primary btn-sm">
            Join the pilot
          </SiteLink>
          <button
            ref={buttonRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="relative grid size-10 cursor-pointer place-items-center rounded-full border border-line bg-white md:hidden"
          >
            <span
              aria-hidden="true"
              className={`absolute h-0.5 w-4 rounded-full bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "rotate-45" : "-translate-y-[4px]"}`}
            />
            <span
              aria-hidden="true"
              className={`absolute h-0.5 w-4 rounded-full bg-ink transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${open ? "-rotate-45" : "translate-y-[4px]"}`}
            />
          </button>
        </div>
      </div>

      <nav
        id="mobile-nav"
        aria-label="Primary"
        hidden={!open}
        className="fixed inset-0 top-0 -z-10 bg-white/95 px-6 pt-24 backdrop-blur-xl md:hidden"
      >
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {nav.map((item, i) => (
            <li
              key={item.href}
              className="motion-safe:animate-[menu-in_500ms_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${Math.min(i * 60, 400)}ms` }}
            >
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="heading-5 flex min-h-12 items-center text-ink no-underline"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
