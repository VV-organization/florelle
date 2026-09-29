# Florelle — flower storefront

Reference mapping: Flower Point provides catalogue, images, product metadata, B2C/B2B, RUB/KZT/TRY, EN/RU, delivery countries and city/weight tariffs. Frags provides technical shopping patterns, cart persistence, full details, quick view, confirmation, account and order history. No Steam/Frags currency mechanics.

Visual direction: Urban Living plum backdrop and monumental sans typography; LxL handwritten emphasis and full-width typographic footer; ERA spacious editorial image composition; Sobha large photographic transitions and compact labels. Botanical hero references user screenshot of Squarespace Foundations / Resn, with local cursor-driven reveal between foliage and blossom states. Reduced-motion and touch alternatives required.

Data: read-only snapshot from Flower Point public catalogue. Never call its purchase/auth/cart APIs or send user data to that service. Imported stock and prices are a snapshot, not inventory reserved for this store. Seller identity and photos are reference content; this project is not the original merchant.

No merchant credentials provided. Real payment, florist fulfilment, authoritative inventory, mail delivery and legal entity must be connected before commercial launch. Do not simulate successful payments. New accounts and saved order drafts, if implemented, use this project's own storage.

Verification: desktop/mobile layout; search/filter/sort; currencies and segment changes; add → visible top-layer confirmation → cart → correct item; duplicate prevention; quantity/remove; reload; keyboard/Escape; delivery calculation; checkout validation; build and typecheck.

The Sites skill's referenced setup/hosting runtime is absent from the installed filesystem; use the available Next.js runtime matching Frags and provide a local preview. No deployment claimed.

Brand: Florelle, “Цветы вместо слов”.
Typography correction: inspect the supplied reference CSS before selecting typefaces. Use Google Sans from Urban Living for Cyrillic/Latin headings and interface, Owners Wide Medium from LxL for the Latin wordmark, Comforter Brush from Uprock for Russian and English handwritten accents (user request 29.09.2026). No Cormorant, Onest, Marck Script, or arbitrary substitutes. Exact source audit and glyph coverage: TYPOGRAPHY.md. The supplied Scribo subset has no Cyrillic; do not claim Russian handwriting is rendered in Scribo. User explicitly requested Cyrillic handwriting from Uprock: use the visually selected Comforter Brush, locally hosted with OFL. Pair meaningful handwritten words with sans in main page and section headings.
