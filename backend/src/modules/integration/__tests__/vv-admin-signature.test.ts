import { describe, expect, it } from 'vitest';
import { signVvAdminWebhook } from '../vv-admin-signature';

describe('signVvAdminWebhook', () => {
  it('signs the canonical VV Admin webhook payload', () => {
    const body = Buffer.from('{"eventId":"event-1"}');
    const signed = signVvAdminWebhook({
      secret: 'secret',
      version: '1',
      timestamp: '2026-08-14T10:00:00.000Z',
      eventId: 'event-1',
      rawBody: body,
    });

    expect(signed.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signed.signature).toBe(
      'sha256=9479ecd484ee219b5f99f8392ca8ae088b4058e2acaf92996afbece3368861b5',
    );
    expect(signed.canonicalPayload).toBe(
      'v1.2026-08-14T10:00:00.000Z.event-1.{"eventId":"event-1"}',
    );
  });
});
