import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyHostedPaymentPage } from '../scenario-hosted-page';

afterEach(() => vi.unstubAllGlobals());

describe('synthetic hosted payment page verification', () => {
  it('reads the provider page without submitting payment or following redirects', async () => {
    const request = vi.fn(async () => new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', request);
    await expect(verifyHostedPaymentPage('https://pay.arcpay.space/checkout/test')).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(new URL('https://pay.arcpay.space/checkout/test'), { redirect: 'error', signal: expect.any(AbortSignal) });
  });

  it.each(['http://pay.arcpay.space/test', 'https://example.com/test', 'https://user:secret@pay.arcpay.space/test', 'https://pay.arcpay.space:8443/test'])('rejects unsafe URL %s before any request', async (url) => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    await expect(verifyHostedPaymentPage(url)).rejects.toMatchObject({ code: 'SYNTHETIC_HOSTED_PAGE_UNAVAILABLE' });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    new Response('<html>error</html>', { status: 503, headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
    new Response('', { headers: { 'content-type': 'text/html' } }),
  ])('rejects unavailable or empty provider responses', async (response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response));
    await expect(verifyHostedPaymentPage('https://pay.arcpay.space/checkout/test')).rejects.toMatchObject({ code: 'SYNTHETIC_HOSTED_PAGE_UNAVAILABLE' });
  });
});
