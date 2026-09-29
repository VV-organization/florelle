# Commerce UI implementation plan

Goal: Complete reviewable frontend shopping screens; real email, payments, server cart and fulfilment will be connected by the developer per user instruction.
Architecture: Keep existing account/draft APIs unchanged. Add explicitly labelled client-only demonstration routes for registration verification, checkout, payment and order states. Do not store passwords or card details. Save only demo order snapshots in browser storage. Preserve cart notice and existing add links.

- [ ] Add checkout route with minimum retail total, automatic wholesale weight, delivery fields, consent, commission pending confirmation and currency equivalents.
- [ ] Add payment result success/failure/cancel demonstrations, order list/detail with status states.
- [ ] Add registration type fields, password confirmation and consent, email verification UI.
- [ ] Add structured legal/contact layouts using clearly identified unpublished merchant data; no fabricated company/contact.
- [ ] Link screens from cart/account, document integration boundaries.
- [ ] Build, test existing APIs, verify demo journey; commit and push.
