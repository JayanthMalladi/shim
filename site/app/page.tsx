import { Hero } from "@/components/site/hero";
import { PipelineSection } from "@/components/site/pipeline-section";
import { PrSection } from "@/components/site/pr-section";
import { ProblemSection } from "@/components/site/problem-section";
import { ProofSection } from "@/components/site/proof-section";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { StartSection } from "@/components/site/start-section";

export default function Home() {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-50 rounded-lg bg-amber px-4 py-2 font-semibold text-ground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <div className="mx-auto box-border max-w-[1280px] px-[clamp(16px,4vw,48px)] pb-10">
          <ProblemSection />
          <PipelineSection />
          <ProofSection />
          <PrSection />
          <StartSection />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
