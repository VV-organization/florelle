import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paymentHref,
  paymentRubles,
  formatPaymentRubles,
} from "../src/lib/payment.ts";
test("only a pending non-review order can reopen an HTTPS hosted session", () => {
  const order = {
    status: "pending",
    paymentStatus: "pending",
    paymentUrl: "https://checkout.arcpay.space/session",
  };
  assert.equal(paymentHref(order), order.paymentUrl);
  for (const patch of [
    { status: "paid" },
    { status: "cancelled" },
    { paymentStatus: "review" },
    { paymentUrl: "http://checkout.test" },
    { paymentUrl: "https://user:pass@checkout.test" },
    { paymentUrl: "javascript:alert(1)" },
  ])
    assert.equal(paymentHref({ ...order, ...patch }), null);
});
test("the amount displayed for SBP comes from authoritative RUB minor units", () => {
  assert.equal(paymentRubles({ paymentAmountMinor: 188563 }), 1885.63);
  for (const value of [undefined, NaN, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(paymentRubles({ paymentAmountMinor: value }), null);
});

test("SBP total never rounds away kopecks", () => {
  assert.equal(formatPaymentRubles(1885.63).replace(/\s/g, " "), "1 885,63 ₽");
});
