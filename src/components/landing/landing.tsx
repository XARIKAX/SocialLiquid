import { Cta } from "./cta";
import { Features } from "./features";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { How } from "./how";
import { RevealObserver, SpotlightTracker } from "./motion";
import { Nav } from "./nav";
import { Tape } from "./tape";
import { Terminal } from "./terminal";
import type { LandingData } from "./types";

/** hides [data-reveal] content only when js is running, before first paint */
const JS_FLAG = "document.documentElement.classList.add('lp-js')";

export function Landing(d: LandingData) {
  return (
    <div className="lp theme-dark">
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
      <Nav />
      <main>
        <Hero d={d} />
        <Tape d={d} />
        <Features d={d} />
        <Terminal d={d} />
        <How d={d} />
        <Cta d={d} />
      </main>
      <Footer d={d} />
      <RevealObserver />
      <SpotlightTracker />
    </div>
  );
}
