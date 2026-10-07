# Arc Pay hosted SBP checkout

Florelle uses `POST /checkout/sessions` with `sbp + h2h`, `one_stage`, RUB integer kopecks, and no `fiscal_items`. The buyer completes payment on the **URL returned by Arc Pay**. The old `arcopay` adapter is the legacy PaymentAPI and remains separate for historical orders.

## Enable in a configured environment

1. Apply migrations `0028_arc_pay_hosted` and `0029_arc_pay_rate_gate` through the existing migration service. It is additive and preserves all existing payments. Back up the database before the release.
2. Keep `PAYMENT_PROVIDER=disabled` until keys are ready. Set independent Florelle `ARC_PAY_SECRET_KEY` (`sk_test_*` or `sk_live_*`), `ARC_PAY_WEBHOOK_SECRET`, and `ARC_PAY_BASE_URL=https://api.arcpay.space/v1`. Never reuse KANSO credentials or put keys in frontend variables/build arguments.
3. Set HTTPS `PUBLIC_FRONTEND_URL` and `PUBLIC_API_URL` (including `/api/v1`). Register return URLs for `/orders/{orderId}` with Arc. All success/fail/cancel returns use that order page.
4. In the Arc merchant portal, register `<PUBLIC_API_URL>/payments/webhooks/arc-pay` and subscribe to payment events. Use this **endpoint's** webhook secret; the API key and tenant dynamic-callback secret are not substitutes. Checkout sessions do not carry `callback_url`.
5. Confirm `GET /payment-methods/available?environment=sandbox` (or `live`, matching the secret key) advertises active `sbp + h2h`, RUB and suitable amount limits. Sandbox SBP must be enabled by Arc for the merchant/terminal.
6. Set `PAYMENT_PROVIDER=arc_pay` and use the normal release workflow. `/health/ready/payment_provider` checks discovery; cached results last 60 seconds. A healthy result proves method availability, **not** actual settlement.
7. Complete a sandbox SBP checkout, observe the signed webhook and provider payment, and verify the order, reservation and outbox. Only then perform an owner-authorized live acceptance payment. No real payment, push or deployment is performed by local tests.

The current release selects one Arc environment through the secret key. Do not switch sandbox/live while that environment has unresolved attempts or events: workers deliberately refuse to process another environment. Keep legacy `ARCOPAY_*` configuration until legacy attempts are drained; `/payments/callback` never processes `arc_pay` attempts.

## Durable behavior

- Order and reservation are persisted with one checkout attempt before provider I/O. The request snapshot, customer email, return URLs and RUB amount are immutable. The attempt UUID is both `external_id` and the creation `Idempotency-Key`.
- `session_id` identifies the hosted session; `external_id` in the **local checkout_attempts table** identifies the provider payment when learned. Never call `/payments/{id}` with a session ID.
- Creation retries use the same body/key with backoff, respecting `Retry-After`. The retry window is 72 hours minus a one-minute safety margin from the first request. Unknown outcomes beyond this window enter review, retaining their reservation. A new key is never generated automatically.
- Webhook HMAC is checked against raw bytes before JSON parsing, including the event ID, matching timestamps and ±300 seconds clock tolerance. Missing/invalid signatures return 401; malformed signed payloads return 400; persistence failures return 503. A 200 means durable receipt, not completed settlement.
- The inbox stores only event routing fields. Workers read the authoritative payment and correlate exact attempt ID, amount, RUB currency, SBP mode and available metadata. Paginated search discovers the provider payment and detects multiple exact matches. Both webhook and polling use the same transactional projection.
- `captured`/`settled` mark paid; `declined`/`failed`/`expired`/`voided` cancel a pending order and release reserved stock once. `timeout`, browser return, cancellation of the browser page and absence of a provider payment never release stock.
- Refunds (including a positive `refunded_amount` on a still-captured payment), chargebacks, identity conflicts, amount/method mismatches and multiple payments enter review without automatic stock changes. Review anomalies are sticky. Creation-window/rejection review may recover from an authoritative matching provider payment.
- The worker runs every 15 seconds, with bounded batches and database leases. A shared database request gate spaces Arc requests by at least 150 ms and applies tenant-environment `Retry-After` cooldown across workers, browser-triggered requests and backend replicas. Expected payment failures have persisted retry/review state; infrastructure worker failures are logged. Paid/failed attempts leave routine polling; later refund/chargeback events still enter the webhook inbox.
- Order, payment, attempt, VV Admin event and paid-email enqueue commit together. Email uses a separate durable outbox and stable Message-ID. SMTP cannot guarantee exactly-once delivery across a crash after SMTP acceptance; retries may redeliver an email, but never reapply settlement or enqueue a second logical paid notification.
- Automated cancellation, refunds, wallet funding and fiscalization are outside this integration. Synthetic checkout remains unadvertised because authoritative SBP cancellation is not implemented.

## Monitoring and recovery

Inspect only identifiers/state; do not export keys or request snapshots containing customer data.

```sql
SELECT id, order_id, state, provider_status, review_reason, retry_count,
       first_request_at, next_attempt_at, updated_at
FROM checkout_attempts WHERE provider = 'arc_pay'
  AND state NOT IN ('paid', 'failed') ORDER BY updated_at;

SELECT id, event_type, payment_id, status, reason, retry_count, next_attempt_at
FROM arc_pay_events WHERE status <> 'processed' ORDER BY created_at;

SELECT order_id, status, retry_count, next_attempt_at
FROM payment_emails WHERE status <> 'sent' ORDER BY created_at;
```

Investigate growing inbox age, persistent creation retries, unmatched events, failed discovery, and any review record. Resolve review using the Arc portal/current payment API and the immutable local amount/identity. Do not clear review, release reservations, create replacement sessions or rewrite provider IDs merely because a browser returned an error or a local timeout elapsed.

To stop new sales while keeping reconciliation active, block new `POST /api/v1/orders` requests at the ingress and leave the Arc worker/webhook configured until pending payments drain. Switching `PAYMENT_PROVIDER=disabled` stops the Arc worker and route too; it is not a safe draining mechanism. Do not roll back the additive migration or send new attempts through the legacy provider.

## Local verification

Use an isolated, migrated PostgreSQL database with the repository delivery fixtures, as in backend CI:

```sh
cd backend
pnpm typecheck
TEST_DATABASE_URL=postgresql://... pnpm test
pnpm build
cd ../frontend
pnpm test
pnpm typecheck
pnpm build
```

Provider HTTP responses and signed events in automated tests are controlled fixtures. Passing tests demonstrate our integration logic, not a payment accepted by Arc or a bank.
