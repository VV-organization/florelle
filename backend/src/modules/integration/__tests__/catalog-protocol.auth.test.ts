import { createHash, createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authenticateCatalogProtocolRequest,
  signedCatalogPathCandidates,
} from '../catalog-protocol.auth';

const secret = 'test-vv-admin-integration-secret';
const now = new Date('2026-08-18T09:00:00.000Z');

describe('catalog protocol auth', () => {
  it('accepts VV Admin HMAC without a signature-version header', () => {
    const body = Buffer.from(JSON.stringify({ name: 'Rose' }));
    const requestId = randomUUID();
    const timestamp = now.toISOString();
    const path = '/categories';
    const digest = createHash('sha256').update(body).digest('hex');
    const canonical = `vv-admin.${timestamp}.${requestId}.POST.${path}.${digest}`;
    const signature = `sha256=${createHmac('sha256', secret)
      .update(canonical)
      .digest('hex')}`;

    expect(
      authenticateCatalogProtocolRequest(
        {
          headers: {
            'idempotency-key': randomUUID(),
            'x-vv-actor-id': 'operator-1',
            'x-vv-request-id': requestId,
            'x-vv-signature': signature,
            'x-vv-site-key': 'florelle',
            'x-vv-timestamp': timestamp,
          },
          method: 'POST',
          path,
          rawBody: body,
        },
        secret,
        'florelle',
        now,
      ),
    ).toMatchObject({ actorId: 'operator-1', requestId, siteKey: 'florelle' });
  });

  it('tries the public integration path and the relative catalog resource path', () => {
    expect(
      signedCatalogPathCandidates('/api/v1/integration/catalog/products?limit=1'),
    ).toEqual([
      '/api/v1/integration/catalog/products?limit=1',
      '/integration/catalog/products?limit=1',
      '/products?limit=1',
    ]);
  });
});
