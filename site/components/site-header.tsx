"use client";

import { useEffect, useRef, useState } from "react";
import { LogoMark } from "./icons";
import { SiteLink } from "./site-link";
import { links } from "@/lib/site";

const nav = [
  { href: "#watch", label: "Watch it work" },
  { href: "#wobbles", label: "The wobbles" },
  { href: "#how", label: "How it works" },
  { href: "#faq", label: "FAQ" },
];

/** Top nav. On phones the links open in a full height panel. */
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
    <header className="relative z-40 px-4 sm:px-8">
      <div className="mx-auto flex max-w-[1184px] items-center justify-between gap-4 py-6">
        <a href="#top" className="flex items-center gap-2 text-3xl leading-9 font-bold tracking-[-0.03em] no-underline">
          <LogoMark />
          shim
        </a>

        <nav aria-label="Primary" className="hidden items-center gap-6 md:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-base leading-6 font-medium no-underline underline-offset-4 hover:underline"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <SiteLink href={links.booking} className="btn btn-sm">
            Join the pilot
          </SiteLink>
          <button
            ref={buttonRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
            className="relative grid size-11 cursor-pointer place-items-center rounded-xl border-[3px] border-ink bg-paper md:hidden"
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
        className="fixed inset-0 top-0 -z-10 bg-page px-6 pt-28 md:hidden"
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
                className="flex min-h-12 items-center text-3xl leading-9 font-bold text-ink no-underline"
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
