import type {
  PaymentProvider,
  CreatePaymentParams,
  PaymentUrlParams,
  WebhookPayload,
} from "./payment-provider";
import { AppError } from "../../shared/middleware/error.middleware";
export class DisabledPaymentProvider implements PaymentProvider {
  async createPayment(_params: CreatePaymentParams): Promise<never> {
    throw new AppError(503, "PAYMENTS_DISABLED", "Оплата пока не настроена");
  }
  async getPaymentUrl(_params: PaymentUrlParams): Promise<never> {
    throw new AppError(503, "PAYMENTS_DISABLED", "Оплата пока не настроена");
  }
  verifyWebhookSignature(): boolean {
    return false;
  }
  parseWebhookPayload(): WebhookPayload {
    throw new Error("Payments disabled");
  }
}
