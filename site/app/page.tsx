import { Hero } from "@/components/hero";
import {
  ChangelogSection,
  FaqSection,
  FinalCta,
  HowSection,
  PrMarquee,
  ScanSection,
  WatchSection,
  WobblesSection,
} from "@/components/sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-ink px-4 py-2 font-semibold text-page focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <PrMarquee />
        <WatchSection />
        <WobblesSection />
        <HowSection />
        <ScanSection />
        <ChangelogSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
