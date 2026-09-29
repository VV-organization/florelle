# Commerce frontend handoff

## Scope agreed 2026-09-29
The remaining commerce flows are **frontend previews**. Real payment, email, server cart, order lifecycle and final merchant documents are a developer/owner follow-up. Existing account/session and saved-draft APIs remain available; new preview screens do not call them to fabricate completed transactions.

## Routes and review path
- `/cart` → `/checkout`: recipient, country/city, phone, address, date/time, delivery and consent.
- `/payment/demo-…`: payment currency RUB/KZT, provider slot, success/failure/cancellation states.
- `/orders`, `/orders/demo-…`: empty state, history, pagination, line items and lifecycle state preview.
- `/auth/register`: individual/company fields, password confirmation, email verification (visible demo code `123456`), resend/error/success states. No credentials persisted or sent.
- `/privacy`, `/terms`: structured draft layouts; owner approval and content still required.
- `/contacts`: own merchant details intentionally pending, no copied foreign contacts.

## Data boundaries
`florelle-preview-orders-v1` stores demo order items, totals, location and status in this browser only. Recipient name, phone, street address and password are not saved by the preview. The existing storefront cart remains browser-local, not server-synchronised. Demo transactions do not clear the cart. Status changes never update a real order.

Retail minimum: 1,000 RUB, converted for the chosen display currency. Wholesale estimated weight: ceil(stems × 0.092 kg), including box quantities. These frontend estimates require authoritative server validation at integration. Commission has a reserved summary row; no rate was supplied, so the UI does not invent one and totals explicitly exclude commission.

## Developer integration checklist
Replace local demo order storage with authenticated server APIs and immutable price snapshots; enforce inventory, minimum, weight, commission and currencies server-side. Integrate an idempotent checkout/payment intent flow and verified provider webhooks. Replace simulated email verification with expiring, rate-limited codes. Synchronise cart after authentication and across devices. Replace status selector with real fulfilment events. Supply approved merchant details, legal content, retention and support channels before public trading.

## Deployment
Repository includes Render blueprint and production Docker build. A published service URL is not registered in GitHub deployments or repository homepage. GitHub CI passing is **not** evidence of a running production service. Provisioning and the public domain remain to be confirmed; see DEPLOY.md.
