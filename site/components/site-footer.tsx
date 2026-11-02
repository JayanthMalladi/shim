import { founder, links } from "@/lib/site";
import { stats } from "@/lib/stats";

export function SiteFooter() {
  const asOf = new Date(stats.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <footer className="border-t border-line px-4">
      <div className="body-6 mx-auto flex max-w-[1040px] flex-wrap justify-between gap-x-8 gap-y-2 py-8 text-muted">
        <span>
          <span className="font-semibold text-ink">shim</span> · built by {founder}
        </span>
        <span className="flex flex-wrap gap-x-6 gap-y-2">
          <span>PR counts as of {asOf}</span>
          <a href={links.repo} className="underline-offset-4 hover:text-ink hover:underline">
            GitHub
          </a>
          <span>Not affiliated with Vercel</span>
        </span>
      </div>
    </footer>
  );
}
