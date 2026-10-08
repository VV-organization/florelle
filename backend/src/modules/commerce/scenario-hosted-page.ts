import { AppError } from '../../shared/middleware/error.middleware';

/** Read only: never submit a payment or follow a redirect outside Arc Pay. */
export async function verifyHostedPaymentPage(value: string): Promise<void> {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'pay.arcpay.space' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Unsafe URL');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(6000) });
    try {
      if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) throw new Error('Unavailable page');
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty page');
      let size = 0;
      let html = '';
      const decoder = new TextDecoder();
      try {
        while (size < 65536) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          html += decoder.decode(chunk.value, { stream: true });
          if (/<(?:!doctype html|html|head|body)[\s>]/i.test(html)) return;
        }
        throw new Error('Invalid page');
      } finally { await reader.cancel(); }
    } finally { if (!response.body?.locked) await response.body?.cancel(); }
  } catch {
    throw new AppError(503, 'SYNTHETIC_HOSTED_PAGE_UNAVAILABLE', 'Hosted payment page is unavailable');
  }
}
