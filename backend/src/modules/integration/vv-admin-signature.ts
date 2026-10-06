import { createHmac } from 'node:crypto';

export type SignVvAdminWebhookInput = {
  secret: string;
  version: string;
  timestamp: string;
  eventId: string;
  rawBody: Buffer;
};

export function signVvAdminWebhook(input: SignVvAdminWebhookInput) {
  const canonicalPayload = `v${input.version}.${input.timestamp}.${input.eventId}.${input.rawBody.toString('utf8')}`;
  const signature = `sha256=${createHmac('sha256', input.secret)
    .update(canonicalPayload)
    .digest('hex')}`;

  return { canonicalPayload, signature };
}
