// route-scoped stylesheet: only "/" loads the landing system. its rules sit in @layer components,
// whose order (theme, base, components, utilities) the root layout's globals.css declares first.
import "./landing.css";
import { Cta } from "./cta";
import { Features } from "./features";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { How } from "./how";
import { MotionGate, RevealObserver, SpotlightTracker } from "./motion";
import { Nav } from "./nav";
import { Tape } from "./tape";
import { Terminal } from "./terminal";
import type { LandingData } from "./types";

/**
 * hides [data-reveal] content only when js is running, before first paint.
 * watchdog: if the page has loaded and <RevealObserver> still has not run 2.5s later
 * (a chunk failed or was blocked), drop the flag so nothing stays invisible.
 */
const JS_FLAG =
  "(function(){var d=document.documentElement;d.classList.add('lp-js');function c(){setTimeout(function(){if(!window.__lpReveal)d.classList.remove('lp-js')},2500)}if(document.readyState==='complete')c();else addEventListener('load',c)})()";

export function Landing(d: LandingData) {
  return (
    <div className="lp theme-dark">
      <script dangerouslySetInnerHTML={{ __html: JS_FLAG }} />
      <a href="#main" className="lp-skip">Skip to content</a>
      <Nav />
      <main id="main" tabIndex={-1}>
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
      <MotionGate />
    </div>
  );
}
