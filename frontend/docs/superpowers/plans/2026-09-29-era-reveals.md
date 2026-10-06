# ERA-inspired entrance motion

User selected ERA's existing motion direction and authorized applying it across the site.

Reference inspected: https://www.era-residence.com, public motion module 20164/60900.js on 2026-09-29.
ERA: headings rotateY(90deg), yPercent50, opacity0 → natural position; 1.2s, 0.05s character stagger, Out(.25,1,.5,1). Paragraph lines rise110% through masks, .1s line stagger. Images use a diagonal polygon wipe and scale1.5/x25% → normal over1.2s, InOut(.75,0,.25,1). Elements reveal once at the viewport edge including horizontal tracks.

Implementation:
- React-owned text spans, preserving natural headings, inline markup and joined handwriting. No DOM text replacement that could conflict with reconciliation.
- Shared observer/WAAPI controller for text, images, controls and details; dynamic content and routes included. Animation-only styles never hide SSR content without JavaScript.
- Keep script words whole; give generous mask margins for flourishes. Line grouping measured from actual layout. No transform changes to pinned rails or rotating flower logo.
- Delay hero entrances to the arch opening; remove earlier generic fade/slide duplicates.
- Finish on keyboard focus, reduced motion and document hiding. Clean up animations and observers on unmount; preserve native dialogs and cart feedback.

Validation: build/typecheck, desktop/mobile visual inspection, gateway→arch→home, horizontal cards, catalogue filtering/language, quick-view→cart, reduced motion and no-JS visibility. Check no layout overflow and settled animations release styles.
