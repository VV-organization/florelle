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
};

type ArcopayApiResponse = {
  Response?: ArcopayResponse;
};

type ArcopayCreateResponse = ArcopayApiResponse & {
  Order?: ArcopayOrder;
};

type ArcopayQrcDataResponse = ArcopayApiResponse & {
  Order?: ArcopayOrder;
  Qrc?: {
    QrcId: string;
    Payload: string;
  };
};

type ArcopayCallbackPayload = ArcopayApiResponse & {
  Order?: ArcopayOrder;
};

const PAID_STATUSES = new Set(["CHARGED", "IPS_ACCEPTED"]);
const FAILED_STATUSES = new Set(["DECLINED", "EXPIRED"]);
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
        IsForm: false,
        LifeTime: 1800,
      },
    );

    const orderId = createResponse.Order?.OrderId;
    if (!orderId) {
      throw new Error("Arcopay create payment response has no Order.OrderId");
    }

    return { externalId: orderId };
  }

  async getPaymentUrl(
    params: PaymentUrlParams,
  ): Promise<{ paymentUrl: string }> {
    const qrcResponse = await this.post<ArcopayQrcDataResponse>(
      "/payments/ips/qrcData",
      {
        OrderId: params.externalId,
        QrcType: "02",
        TemplateVersion: "01",
        QrTtl: "15",
        Description: params.description,
        ...(params.buyerPhone ? { PhoneNumber: params.buyerPhone } : {}),
      },
    );

    const paymentUrl = qrcResponse.Qrc?.Payload;
    if (!paymentUrl) {
      throw new Error("Arcopay QRC response has no Qrc.Payload");
    }

    return {
      paymentUrl,
    };
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
    if (!order?.OrderId || !order.MerchantOrderId || !order.Status) {
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
    };
  }

  private async post<T extends ArcopayApiResponse>(
    endpoint: string,
    body: unknown,
  ): Promise<T> {
    const response = await this.fetchFn(`${this.apiUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.bearerToken}`,
        "x-api-key": this.config.apiKey,
        "x-req-id": randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      ),
    });

    const data = (await response.json()) as T;
    if (!response.ok || !data.Response?.Success) {
      const message =
        data.Response?.ErrMessage ??
        data.Response?.Message ??
        `Arcopay API error: ${response.status}`;
      throw new Error(message);
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
