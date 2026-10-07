import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ArcPayClient, verifyArcPayWebhook } from "../arc-pay-client";
const key = "sk_test_local_only";
const request = {
  amount: 188563,
  currency: "RUB" as const,
  capture_mode: "one_stage" as const,
  payment_methods: [{ method: "sbp" as const, payment_mode: "h2h" as const }],
  external_id: "attempt",
  customer_email: "buyer@example.test",
  success_url: "https://shop.test/orders/1",
  fail_url: "https://shop.test/orders/1",
  cancel_url: "https://shop.test/orders/1",
  locale: "ru" as const,
  metadata: { florelle_order_id: "order" },
};
describe("Arc Pay hosted contract", () => {
  it("creates hosted SBP with persisted minor units, secret auth and stable idempotency key", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json({
          id: "session-id",
          url: "https://checkout.arcpay.space/session-id",
        });
      },
    });
    expect(
      await client.createSession(
        request,
        "10b49b08-ad34-40f4-bc11-9710ce554b98",
      ),
    ).toEqual({
      id: "session-id",
      url: "https://checkout.arcpay.space/session-id",
    });
    expect(calls[0]?.url).toBe("https://api.arcpay.space/v1/checkout/sessions");
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer " + key,
      "Idempotency-Key": "10b49b08-ad34-40f4-bc11-9710ce554b98",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
  });
  it("fails closed when discovery does not enable sbp h2h", async () => {
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async () =>
        Response.json([
          { method: "sbp", payment_mode: "redirect", is_active: true },
        ]),
    });
    await expect(client.assertAvailable(188563)).rejects.toThrow(
      "SBP_H2H_UNAVAILABLE",
    );
  });
  it("checks environment, currency and amount limits", async () => {
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async (url) => {
        expect(String(url)).toContain("environment=sandbox");
        return Response.json([
          {
            method: "sbp",
            payment_mode: "h2h",
            is_active: true,
            supported_currencies: ["RUB"],
            min_amount: 100,
            max_amount: 200000,
          },
        ]);
      },
    });
    await expect(client.assertAvailable(188563)).resolves.toBeUndefined();
    await expect(client.assertAvailable(200001)).rejects.toThrow(
      "SBP_AMOUNT_UNAVAILABLE",
    );
  });
  it("rejects unsafe hosted URLs", async () => {
    for (const url of [
      "http://checkout.test",
      "https://user:pass@checkout.test",
      "javascript:alert(1)",
    ]) {
      const client = new ArcPayClient({
        secretKey: key,
        fetchFn: async () => Response.json({ id: "session", url }),
      });
      await expect(client.createSession(request, "key")).rejects.toThrow();
    }
  });
  it("searches every cursor page and returns only exact external_id matches", async () => {
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async (url) =>
        String(url).includes("cursor=")
          ? Response.json({
              data: [
                {
                  id: "p2",
                  external_id: "attempt",
                  status: "captured",
                  amount: 188563,
                  currency: "RUB",
                  payment_method: "sbp",
                },
              ],
              next_cursor: null,
            })
          : Response.json({
              data: [
                {
                  id: "p1",
                  external_id: "other",
                  status: "captured",
                  amount: 1,
                  currency: "RUB",
                  payment_method: "sbp",
                },
              ],
              next_cursor: "next",
            }),
    });
    expect((await client.findPayments("attempt")).map((p) => p.id)).toEqual([
      "p2",
    ]);
  });
  it("does not leak API response bodies or credentials in errors", async () => {
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async () =>
        Response.json(
          {
            error: {
              code: "service_unavailable",
              message: "secret buyer data",
            },
          },
          { status: 503 },
        ),
    });
    await expect(client.getPayment("p")).rejects.toMatchObject({
      message: "ARC_PAY_HTTP_503",
      retryable: true,
    });
  });
});
describe("Arc HMAC", () => {
  const raw = Buffer.from(
    '{ "event_type": "payment.captured", "data":{"payment_id":"p"} }',
  );
  const now = Date.now(),
    ts = String(Math.floor(now / 1000)),
    id = "event-1",
    secret = "webhook-local-secret";
  const digest = createHmac("sha256", secret)
    .update(`${id}.${ts}.`)
    .update(raw)
    .digest("hex");
  const headers = {
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `t=${ts},v1=${digest}`,
  };
  it("verifies raw bytes and accepts either v1 during rotation", () => {
    expect(verifyArcPayWebhook(raw, headers, secret, now)).toBe(true);
    expect(
      verifyArcPayWebhook(
        raw,
        {
          ...headers,
          "webhook-signature": `t=${ts},v1=${"0".repeat(64)},v1=${digest}`,
        },
        secret,
        now,
      ),
    ).toBe(true);
  });
  it("rejects tampered bytes, absent ids, stale/future timestamps and mismatched signature timestamps", () => {
    expect(
      verifyArcPayWebhook(
        Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
        headers,
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyArcPayWebhook(raw, { ...headers, "webhook-id": "" }, secret, now),
    ).toBe(false);
    expect(verifyArcPayWebhook(raw, headers, secret, now + 301000)).toBe(false);
    expect(verifyArcPayWebhook(raw, headers, secret, now - 301000)).toBe(false);
    expect(
      verifyArcPayWebhook(
        raw,
        { ...headers, "webhook-timestamp": "NaN" },
        secret,
        now,
      ),
    ).toBe(false);
    expect(
      verifyArcPayWebhook(
        raw,
        { ...headers, "webhook-signature": `t=1,v1=${digest}` },
        secret,
        now,
      ),
    ).toBe(false);
  });
});

it("applies Retry-After across reads, creates, searches and discovery without extra requests", async () => {
  vi.useFakeTimers();
  let requests = 0;
  try {
    const client = new ArcPayClient({
      secretKey: key,
      fetchFn: async () => {
        requests++;
        return Response.json(
          {},
          { status: 429, headers: { "Retry-After": "60" } },
        );
      },
    });
    await expect(client.getPayment("p")).rejects.toMatchObject({ status: 429 });
    for (const call of [
      () => client.getPayment("other"),
      () => client.findPayments("attempt"),
      () => client.createSession(request, "key"),
      () => client.assertAvailable(),
    ])
      await expect(call()).rejects.toMatchObject({ status: 429 });
    expect(requests).toBe(1);
    vi.advanceTimersByTime(61000);
    await expect(client.getPayment("p")).rejects.toMatchObject({ status: 429 });
    expect(requests).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

it("never dispatches creation if rate-gate waiting crosses the idempotency deadline", async () => {
  vi.useFakeTimers();
  let requests = 0;
  const deadline = Date.now() + 1000;
  try {
    const client = new ArcPayClient({
      secretKey: key,
      rateGate: {
        acquire: async () => {
          vi.advanceTimersByTime(2000);
        },
        block: async () => {},
      },
      fetchFn: async () => {
        requests++;
        return Response.json({
          id: "session",
          url: "https://checkout.test/session",
        });
      },
    });
    await expect(
      client.createSession(request, "key", deadline),
    ).rejects.toThrow("ARC_CREATE_WINDOW_EXPIRED");
    expect(requests).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
