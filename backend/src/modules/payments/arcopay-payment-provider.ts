import crypto, { randomUUID } from "node:crypto";
import type {
  CreatePaymentParams,
  CreatePaymentResult,
  PaymentUrlParams,
  PaymentProvider,
  WebhookPayload,
} from "./payment-provider";

type ArcopayPaymentProviderConfig = {
  apiUrl: string;
  apiKey: string;
  bearerToken: string;
  publicKey: string;
  shopId: string;
  fetchFn?: typeof fetch;
  requestTimeoutMs?: number;
  convertUsdToRub: (amountUsd: string) => Promise<string>;
};

type ArcopayResponse = {
  Success: boolean;
  Message?: string;
  ErrCode?: string;
  ErrMessage?: string;
  ErrorCode?: number;
};

type ArcopayOrder = {
  OrderId: string;
  MerchantOrderId: string;
  Amount: number;
  Currency: string;
  Status: string;
  ShopId: string | number;
  PaymentType?: string;
};

type ArcopayApiResponse = {
  Response?: ArcopayResponse;
};

type ArcopayCreateResponse = ArcopayApiResponse & {
  Order?: ArcopayOrder;
};

type ArcopayCallbackPayload = ArcopayApiResponse & {
  Order?: ArcopayOrder;
};

const PAID_STATUSES = new Set(["CHARGED", "IPS_ACCEPTED"]);
const FAILED_STATUSES = new Set(["DECLINED", "EXPIRED", "VOIDED"]);
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export class ArcopayPaymentProvider implements PaymentProvider {
  private readonly apiUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: ArcopayPaymentProviderConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async createPayment(
    params: CreatePaymentParams,
  ): Promise<CreatePaymentResult> {
    const { externalId: orderId } = await this.createPaymentOrder(params);
    const { paymentUrl } = await this.getPaymentUrl({
      externalId: orderId,
      description: params.description,
      buyerPhone: params.buyerPhone,
    });

    return {
      externalId: orderId,
      paymentUrl,
    };
  }

  async createPaymentOrder(
    params: CreatePaymentParams,
  ): Promise<{ externalId: string }> {
    const amountKopeks =
      params.amountMinor ??
      this.toKopeks(await this.config.convertUsdToRub(params.amountUsd));
    if (!Number.isSafeInteger(amountKopeks) || amountKopeks <= 0)
      throw new Error("Invalid payment amount");
    const buyer = {
      ...(params.buyerEmail ? { Email: params.buyerEmail } : {}),
      ...(params.buyerPhone ? { Phone: params.buyerPhone } : {}),
    };

    const createResponse = await this.post<ArcopayCreateResponse>(
      "/payments/create",
      {
        MerchantOrderId: params.merchantOrderId,
        Currency: "RUB",
        Type: "PayIn",
        PaymentTypes: ["IPS"],
        Amount: amountKopeks,
        FiscalData: { FiscalEnabled: false },
        ...(Object.keys(buyer).length > 0 ? { Buyer: buyer } : {}),
        CallbackUrl: params.callbackUrl,
        IsForm: true,
        LifeTime: 900,
        Description: params.description,
        RedirectUrl: { SuccessUrl: params.successUrl, FailUrl: params.failUrl },
      },
      params.idempotencyKey,
    );

    const parsed = this.parseWebhookPayload(createResponse);
    if (parsed.merchantOrderId !== params.merchantOrderId || parsed.amountMinor !== amountKopeks) throw new Error("Arco Pay order mismatch");
    const orderId = parsed.externalId;
    if (!orderId) {
      throw new Error("Arcopay create payment response has no Order.OrderId");
    }

    return { externalId: orderId };
  }

  async getPaymentUrl(
    params: PaymentUrlParams,
  ): Promise<{ paymentUrl: string }> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(params.externalId)) throw new Error("Invalid provider order ID");
    return { paymentUrl: `https://payment.paidlayer.com/${params.externalId}` };
  }

  async getPaymentStatus(externalId: string): Promise<WebhookPayload> {
    const data = await this.post<ArcopayCreateResponse>("/payments/status", { OrderId: externalId });
    const payload = this.parseWebhookPayload(data);
    if (payload.externalId !== externalId) throw new Error("Arco Pay status identity mismatch");
    return payload;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    if (!signature) return false;

    try {
      const verifier = crypto.createVerify("RSA-SHA1");
      verifier.update(rawBody);
      verifier.end();
      return verifier.verify(this.normalizedPublicKey(), signature, "base64");
    } catch {
      return false;
    }
  }

  parseWebhookPayload(body: unknown): WebhookPayload {
    const payload = body as ArcopayCallbackPayload;
    const order = payload.Order;
    if (!payload.Response?.Success || !order || typeof order.OrderId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(order.OrderId) ||
      typeof order.MerchantOrderId !== "string" || !order.MerchantOrderId || order.MerchantOrderId.length > 50 ||
      String(order.ShopId) !== this.config.shopId || order.Currency !== "RUB" ||
      !Number.isSafeInteger(order.Amount) || order.Amount <= 0 || !order.Status ||
      (order.PaymentType && !["CARD", "IPS"].includes(order.PaymentType)) ||
      (order.Status === "CHARGED" && order.PaymentType && order.PaymentType !== "CARD") ||
      (order.Status === "IPS_ACCEPTED" && order.PaymentType && order.PaymentType !== "IPS")) {
      throw new Error("Invalid Arcopay callback payload");
    }

    let status: WebhookPayload["status"] = "pending";
    if (PAID_STATUSES.has(order.Status)) {
      status = "paid";
    } else if (FAILED_STATUSES.has(order.Status)) {
      status = "failed";
    }

    return {
      merchantOrderId: order.MerchantOrderId,
      externalId: order.OrderId,
      status,
      amountMinor: order.Amount,
      currency: order.Currency,
      ...(order.Status === "CHARGED" || order.PaymentType === "CARD" ? {method: "card" as const} : order.Status === "IPS_ACCEPTED" || order.PaymentType === "IPS" ? {method: "sbp" as const} : {}),
    };
  }

  private async post<T extends ArcopayApiResponse>(
    endpoint: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await this.fetchFn(`${this.apiUrl}${endpoint}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.bearerToken}`,
        "x-api-key": this.config.apiKey,
        "x-req-id": idempotencyKey ?? randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      ),
    });

    const data = (await response.json()) as T;
    if (!response.ok || !data.Response?.Success) {
      throw new Error("Arco Pay API unavailable");
    }

    return data;
  }

  private toKopeks(amountRub: string): number {
    const value = Number(amountRub);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("Invalid RUB amount for Arcopay payment");
    }
    return Math.round(value * 100);
  }

  private normalizedPublicKey(): string {
    return this.config.publicKey.replace(/\\n/g, "\n");
  }
}
