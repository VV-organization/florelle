import {describe, expect, it} from 'vitest';
import type {Database} from '../../../shared/db/client';
import {ArcPayClient} from '../arc-pay-client';
import {ArcPayService} from '../arc-pay.service';

describe('Arc Pay storefront branding', () => {
 it('brands new payments without changing SBP or reconciliation identifiers', () => {
  const service = new ArcPayService({} as Database, new ArcPayClient({secretKey: 'sk_test_local_only'}));
  const request = service.sessionRequest({attemptId: 'attempt', orderId: 'order', amount: 188563, email: 'buyer@example.test', returnUrl: 'https://shop.example.test/orders/order'});
  expect(request).toMatchObject({description: 'Bloom-send order order', payment_methods: [{method: 'sbp', payment_mode: 'h2h'}], external_id: 'attempt', metadata: {florelle_order_id: 'order'}, amount: 188563, currency: 'RUB'});
 });
});
