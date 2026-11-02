import { founder, links } from "@/lib/site";
import { stats } from "@/lib/stats";

export function SiteFooter() {
  const asOf = new Date(stats.asOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <footer className="px-4 sm:px-8">
      <div className="mx-auto flex max-w-[1184px] flex-wrap justify-between gap-x-8 gap-y-2 border-t-[3px] border-ink py-8 text-sm leading-5 font-medium">
        <span>
          <span className="font-bold">shim</span> · made by {founder}
        </span>
        <span className="flex flex-wrap gap-x-6 gap-y-2">
          <span>PR counts as of {asOf}</span>
          <a href={links.repo} className="underline-offset-4 hover:underline">
            GitHub
          </a>
          <span>Not affiliated with Vercel</span>
        </span>
      </div>
    </footer>
  );
}
