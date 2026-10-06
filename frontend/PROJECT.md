# Florelle — flower storefront

Reference mapping: Flower Point provides catalogue, images, product metadata, B2C/B2B, RUB/KZT/TRY, EN/RU, delivery countries and city/weight tariffs. Frags provides technical shopping patterns, cart persistence, full details, quick view, confirmation, account and order history. No Steam/Frags currency mechanics.

Visual direction: Urban Living plum backdrop and monumental sans typography; LxL handwritten emphasis and full-width typographic footer; ERA spacious editorial image composition; Sobha large photographic transitions and compact labels. Botanical hero references user screenshot of Squarespace Foundations / Resn, with local cursor-driven reveal between foliage and blossom states. Reduced-motion and touch alternatives required.

Data: read-only snapshot from Flower Point public catalogue. Never call its purchase/auth/cart APIs or send user data to that service. Imported stock and prices are a snapshot, not inventory reserved for this store. Seller identity and photos are reference content; this project is not the original merchant.

No merchant credentials provided. Real payment, florist fulfilment, authoritative inventory, mail delivery and legal entity must be connected before commercial launch. Do not simulate successful payments. New accounts and saved order drafts, if implemented, use this project's own storage.

Verification: desktop/mobile layout; search/filter/sort; currencies and segment changes; add → visible top-layer confirmation → cart → correct item; duplicate prevention; quantity/remove; reload; keyboard/Escape; delivery calculation; checkout validation; build and typecheck.

The Sites skill's referenced setup/hosting runtime is absent from the installed filesystem; use the available Next.js runtime matching Frags and provide a local preview. No deployment claimed.

Brand: Florelle, “Цветы вместо слов”.
Approved typography (29.09.2026): Prata for headings, Manrope for body/UI, Passions Conflict RUS for handwritten accents. Locally hosted. Previous Google Sans, Owners Wide and Comforter Brush experiments are superseded.

Functional parity is incomplete. FLOWER-POINT-AUDIT.md records confirmed matches, fixes and remaining work. Prioritize the full shopping flow. Do not describe drafts as paid orders or a passing build as commercial readiness.
