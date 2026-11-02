import { Hero } from "@/components/hero";
import { FaqSection, FinalCta, HowSection, PricingSection, PrsSection, ScanSection } from "@/components/sections";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SpotSection } from "@/components/spot-section";
import { Tagline } from "@/components/tagline";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-full bg-accent px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <SpotSection />
        <HowSection />
        <Tagline />
        <PrsSection />
        <PricingSection />
        <ScanSection />
        <FaqSection />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
