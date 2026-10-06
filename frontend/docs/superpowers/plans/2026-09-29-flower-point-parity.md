# Flower Point parity implementation plan

> Execute locally task-by-task; keep the user's approved visual direction.

**Goal:** Audit all public Flower Point shopping surfaces and remove confirmed storefront gaps.
**Architecture:** Preserve the local catalogue and original image cutouts. Public source data is read-only. Merchant payments, email verification and fulfilment must use Florelle's own services.
**Tech Stack:** Next.js 16, React 19, TypeScript, SQLite.

## Constraints
- Prata + Manrope + Passions Conflict RUS; sentence-case names, compact single-line headings.
- No source authentication, cart or purchase requests; inspect public UI and delivered client code only.
- Do not represent order drafts as paid orders or another merchant's identity as Florelle.
- Preserve cart notice, native-dialog top layer, duplicate prevention and working cart links.

## Verified fixes for this pass
- [ ] Catalogue: store exact collection listing IDs instead of selecting every seller of a collection product. Match 20 / 20 / 15 source offers.
- [ ] Product detail: expose all sellers for the selected product with independent quantities and cart actions.
- [ ] Cards: display stock in stems/boxes and AMS benchmark on wholesale listings.
- [ ] Catalogue: multi-select categories and colours with independent remove/reset controls.
- [ ] Homepage: include the three source curated collection links alongside botanical category navigation.
- [ ] Delivery: show express/same-day/scheduled information and 100 kg example column; retain all 37 verified city rows.
- [ ] Verify browser filters, seller → add → notice → cart, currency updates, mobile layout and production build.
- [ ] Write full audit with source routes, exact data comparison, remaining payment/auth/order/legal gaps and evidence limitations.

## Remaining parity work
- Email registration challenge, delivery provider and sender domain.
- Checkout minimum 1000 RUB, server cart/commission, automatic wholesale weight (ceil(stems × .092)), country phone validation, order state/detail and payment callbacks.
- Own merchant legal text/contact; source legal pages have Turkish, English and Russian versions.
- Live inventory/price/currency refresh requires an authoritative backend rather than static imported snapshots.

Checkout rules, account fields, server cart, order pages and filter/sort parity do not require merchant credentials and can be implemented independently. Only real external email/payment connections and merchant-specific content require the corresponding services/data. See FLOWER-POINT-AUDIT.md for the complete distinction.

Production build and all 5 automated tests passed. Browser collection counts and AMS/stock confirmed. Multi-filter and seller/cart journey remain unchecked after the browser session became unavailable.
