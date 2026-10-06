# Photo delivery

The storefront uses local responsive WebP variants through `FlowerPhoto`.
Original source files in `public/catalog` and `public/images` are retained.

- All 482 unique catalog photographs (used across 1,000 offers) have restored versions. The old grayscale placeholder 1018 uses the reviewed pink spray-rose photograph 27132.
- Three editorial/botanical photographs have variants up to 3072 px on the long edge.
- Catalog variants are 640, 1024 and 1200–1800 px on the long edge, according to restoration output. Width descriptors use actual pixel widths, including portrait images.
- Real-ESRGAN x4plus processes small source photographs; RealESRGAN General x4 v3 processes larger sources. The original alpha channel is retained and resampled to preserve cutout silhouettes.
- Luciano (3730), Jacaranda (1326), Crystal Blush (1637) and Odessa (18062) have individually reviewed generative restorations in `public/catalog/restored`. They preserve the source appearance but are not pixel-identical reproductions. AI enhancement cannot recover guaranteed botanical detail absent from tiny originals.
- The botanical canvas and CSS fallback both use restored photos. Catalog cards retain the restrained opacity reveal.

`src/data/image-quality.json` records original dimensions, source SHA-256, restoration method, and all delivered variants. `scripts/upscale-site-photos.py` rebuilds/resumes the batch using an external official Real-ESRGAN NCNN runtime and Pillow. Model/runtime binaries and scratch images are intentionally not committed. Use `--force --only <id>` to refresh a reviewed restoration.

Run `npm test` for asset coverage and file integrity metadata checks. The original import is not a live supplier feed; developer integration remains separate.

## Storefront integration handoff

Customer-facing pages contain customer copy only. Keep implementation notes out of the UI. Checkout/order storage is still browser-local; registration/email, payment processing and live order statuses require developer integration. Payment actions must never mark an order paid without a provider response. Seller contact details and approved legal documents remain outstanding; do not invent phone numbers, addresses, company identifiers or legal claims. Current privacy/purchase pages describe the interface and are not a replacement for approved seller documents.
