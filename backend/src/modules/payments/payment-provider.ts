export type CreatePaymentParams = {
  merchantOrderId: string;
  amountUsd: string;
  amountMinor?: number;
  description: string;
  buyerEmail?: string;
  buyerPhone?: string;
  callbackUrl: string;
  successUrl?: string;
  failUrl?: string;
};

export type PaymentUrlParams = {
  externalId: string;
  description: string;
  buyerPhone?: string;
};

export type CreatePaymentResult = {
  externalId: string;
  paymentUrl: string;
};

export type WebhookPayload = {
  merchantOrderId: string;
  externalId: string;
  status: 'paid' | 'failed' | 'pending';
  amountMinor?: number;
  currency?: string;
};

export interface PaymentProvider {
  createPaymentOrder?(params: CreatePaymentParams): Promise<{externalId:string}>;
  createPayment(params: CreatePaymentParams): Promise<CreatePaymentResult>;
  getPaymentUrl(params: PaymentUrlParams): Promise<{ paymentUrl: string }>;
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  parseWebhookPayload(body: unknown): WebhookPayload;
}
