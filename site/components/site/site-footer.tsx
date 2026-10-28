import { links, placeholders } from "@/lib/site";
import { PlaceholderText } from "./placeholder";

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto box-border flex max-w-[1280px] flex-wrap justify-between gap-x-8 gap-y-3 px-[clamp(16px,4vw,48px)] pt-6 pb-8 text-[13px] text-muted">
        <p className="m-0">
          <span className="font-semibold text-fg">shim</span> — API breaking changes in, tested pull requests out.
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <span>
            Built by <PlaceholderText>{placeholders.founder}</PlaceholderText>
          </span>
          <a href={links.repo} className="text-fg-2 underline underline-offset-2 hover:text-amber">
            GitHub
          </a>
          <span>Not affiliated with Vercel.</span>
        </div>
      </div>
    </footer>
  );
}
