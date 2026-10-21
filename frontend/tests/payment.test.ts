import { test } from "node:test";
import assert from "node:assert/strict";
import {
  paymentHref,
  hostedPaymentForm,
  paymentRubles,
  formatPaymentRubles,
} from "../src/lib/payment.ts";
test("only a pending non-review order can reopen an HTTPS hosted session", () => {
  const order = {
    status: "pending",
    paymentStatus: "pending",
    paymentUrl: "https://payment.paidlayer.com/session",
  };
  assert.equal(paymentHref(order), order.paymentUrl);
  for (const patch of [
    { status: "paid" },
    { status: "cancelled" },
    { paymentStatus: "review" },
    { paymentUrl: "http://checkout.test" },
    { paymentUrl: "https://checkout.arcpay.space/session" },
    { paymentUrl: "https://payment.paidlayer.com/session?redirect=evil" },
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

test('hosted checkout posts both return URLs to the same order page', () => {
 const order={id:'order-1',status:'pending',paymentUrl:'https://payment.paidlayer.com/provider-1'};
 assert.deepEqual(hostedPaymentForm(order,'https://bloom-send.com'), {action:order.paymentUrl,method:'POST',fields:{successUrl:'https://bloom-send.com/orders/order-1',failUrl:'https://bloom-send.com/orders/order-1'}});
 assert.throws(()=>hostedPaymentForm({...order,paymentUrl:'https://evil.test/payment'},'https://bloom-send.com'));
});
