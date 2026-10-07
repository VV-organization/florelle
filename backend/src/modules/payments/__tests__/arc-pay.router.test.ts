import { createHmac } from "node:crypto";
import Fastify from "fastify";
import { describe, it, expect } from "vitest";
import { buildArcPayRouter } from "../arc-pay.router";
const secret = "local-webhook-secret";
describe("Arc webhook HTTP boundary", () => {
  async function request(body: string, valid = true, fail = false) {
    const accepted: unknown[] = [];
    const app = Fastify();
    await app.register(
      buildArcPayRouter(
        {
          receive: async (id, body) => {
            if (fail) throw Error("db down");
            accepted.push({ id, body });
          },
        },
        secret,
      ),
    );
    const ts = String(Math.floor(Date.now() / 1000)),
      id = "evt";
    const signature = createHmac("sha256", secret)
      .update(`${id}.${ts}.`)
      .update(body)
      .digest("hex");
    const response = await app.inject({
      method: "POST",
      url: "/payments/webhooks/arc-pay",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": ts,
        "webhook-signature": valid ? `t=${ts},v1=${signature}` : "bad",
      },
      payload: body,
    });
    await app.close();
    return { response, accepted };
  }
  it("authenticates exact raw bytes and durably accepts before acknowledging", async () => {
    const body =
      '{ "event_type":"payment.captured", "data":{"payment_id":"p"} }';
    const { response, accepted } = await request(body);
    expect(response.statusCode).toBe(200);
    expect(accepted).toEqual([{ id: "evt", body: JSON.parse(body) }]);
  });
  it("rejects invalid signatures before parsing even malformed JSON", async () => {
    const { response, accepted } = await request("{broken", false);
    expect(response.statusCode).toBe(401);
    expect(accepted).toEqual([]);
  });
  it("rejects authenticated malformed JSON without enqueueing", async () => {
    const { response, accepted } = await request("{broken");
    expect(response.statusCode).toBe(400);
    expect(accepted).toEqual([]);
  });
  it("returns a retryable response when durable acceptance fails", async () => {
    const { response } = await request(
      '{"event_type":"payment.captured","data":{"payment_id":"p"}}',
      true,
      true,
    );
    expect(response.statusCode).toBe(503);
  });
});
