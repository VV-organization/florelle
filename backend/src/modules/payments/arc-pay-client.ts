import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type ArcSessionRequest = {
  amount: number;
  currency: "RUB";
  capture_mode: "one_stage";
  payment_methods: { method: "sbp"; payment_mode: "h2h" }[];
  external_id: string;
  customer_email: string;
  description?: string;
  success_url: string;
  fail_url: string;
  cancel_url: string;
  locale: "ru" | "en";
  metadata: Record<string, string>;
};
const paymentSchema = z.object({
  id: z.string().min(1),
  external_id: z.string().optional(),
  status: z.string().min(1),
  amount: z.number().int().nonnegative().safe(),
  currency: z.string(),
  payment_method: z.string(),
  payment_mode: z.string().optional(),
  metadata: z.record(z.string()).optional(),
  captured_amount: z.number().int().nonnegative().safe().optional(),
  refunded_amount: z.number().int().nonnegative().safe().optional(),
});
export type ArcPayment = z.infer<typeof paymentSchema>;
export class ArcPayError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterMs = 0,
  ) {
    super(`ARC_PAY_HTTP_${status}`);
  }
  get retryable() {
    return [408, 409, 429].includes(this.status) || this.status >= 500;
  }
}
export function safeHostedUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("ARC_PAY_UNSAFE_URL");
  return value;
}
export interface ArcPayRequestGate {
  acquire(): Promise<void>;
  block(delayMs: number): Promise<void>;
}
export class ArcPayClient {
  readonly environment: "sandbox" | "live";
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private blockedUntil = 0;
  private discovery?: {
    expires: number;
    methods: ReturnType<typeof methodSchema.parse>[];
  };
  constructor(
    private config: {
      secretKey: string;
      baseUrl?: string;
      fetchFn?: typeof fetch;
      rateGate?: ArcPayRequestGate;
    },
  ) {
    if (!/^sk_(test|live)_\S+$/.test(config.secretKey))
      throw Error("ARC_PAY_INVALID_SECRET_KEY");
    this.environment = config.secretKey.startsWith("sk_live_")
      ? "live"
      : "sandbox";
    this.baseUrl = safeHostedUrl(
      config.baseUrl ?? "https://api.arcpay.space/v1",
    ).replace(/\/$/, "");
    this.fetchFn = config.fetchFn ?? fetch;
  }
  async assertAvailable(amount?: number) {
    if (!this.discovery || this.discovery.expires < Date.now()) {
      const data = await this.request(
        `/payment-methods/available?environment=${this.environment}`,
      );
      this.discovery = {
        methods: z.array(methodSchema).parse(data),
        expires: Date.now() + 60000,
      };
    }
    const method = this.discovery.methods.find(
      (m) => m.method === "sbp" && m.payment_mode === "h2h" && m.is_active,
    );
    if (
      !method ||
      (method.supported_currencies &&
        !method.supported_currencies.includes("RUB"))
    )
      throw Error("SBP_H2H_UNAVAILABLE");
    if (
      amount !== undefined &&
      (!Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount < (method.min_amount ?? 1) ||
        amount > (method.max_amount ?? Number.MAX_SAFE_INTEGER))
    )
      throw Error("SBP_AMOUNT_UNAVAILABLE");
  }
  async amountValidator(): Promise<(amount: number) => void> {
    await this.assertAvailable();
    // Capture the advertised limits before entering the order transaction. No network under order locks.
    const method = this.discovery!.methods.find(
      (m) => m.method === "sbp" && m.payment_mode === "h2h" && m.is_active,
    )!;
    return (amount) => {
      if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount < (method.min_amount ?? 1) ||
        amount > (method.max_amount ?? Number.MAX_SAFE_INTEGER)
      )
        throw Error("SBP_AMOUNT_UNAVAILABLE");
    };
  }
  async createSession(
    request: ArcSessionRequest,
    key: string,
    notAfter?: number,
  ) {
    safeHostedUrl(request.success_url);
    safeHostedUrl(request.fail_url);
    safeHostedUrl(request.cancel_url);
    const result = z
      .object({ id: z.string().min(1), url: z.string() })
      .parse(await this.request("/checkout/sessions", request, key, notAfter));
    safeHostedUrl(result.url);
    return result;
  }
  async getPayment(id: string): Promise<ArcPayment> {
    return paymentSchema.parse(
      await this.request(`/payments/${encodeURIComponent(id)}`),
    );
  }
  async findPayments(externalId: string): Promise<ArcPayment[]> {
    const matches: ArcPayment[] = [],
      seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const query = new URLSearchParams({
        search: externalId,
        page_size: "100",
      });
      if (cursor) query.set("cursor", cursor);
      const page = z
        .object({
          payments: z.array(paymentSchema),
          next_cursor: z.string().nullable().optional(),
        })
        .parse(await this.request(`/payments?${query}`));
      matches.push(...page.payments.filter((p) => p.external_id === externalId));
      cursor = page.next_cursor ?? undefined;
      if (cursor && seen.has(cursor)) throw Error("ARC_PAY_REPEATED_CURSOR");
      if (cursor) seen.add(cursor);
      // Do not silently accept incomplete search results.
      if (seen.size > 100) throw Error("ARC_PAY_SEARCH_TOO_LARGE");
    } while (cursor);
    return [...new Map(matches.map((p) => [p.id, p])).values()];
  }
  private async request(
    path: string,
    body?: unknown,
    key?: string,
    notAfter?: number,
  ): Promise<unknown> {
    if (Date.now() < this.blockedUntil)
      throw new ArcPayError(429, this.blockedUntil - Date.now());
    await this.config.rateGate?.acquire();
    if (notAfter !== undefined && Date.now() >= notAfter)
      throw Error("ARC_CREATE_WINDOW_EXPIRED");
    if (Date.now() < this.blockedUntil)
      throw new ArcPayError(429, this.blockedUntil - Date.now());
    const response = await this.fetchFn(this.baseUrl + path, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.config.secretKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
      redirect: "error",
    });
    if (!response.ok) {
      const retry = response.headers.get("retry-after");
      const delay = retry
        ? /^\d+$/.test(retry)
          ? Number(retry) * 1000
          : Date.parse(retry) - Date.now()
        : 0;
      const retryAfter = Number.isFinite(delay) ? Math.max(0, delay) : 0;
      if (response.status === 429) {
        const cooldown = retryAfter || 60000;
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + cooldown);
        await this.config.rateGate?.block(cooldown);
        throw new ArcPayError(429, cooldown);
      }
      throw new ArcPayError(response.status, retryAfter);
    }
    return response.json();
  }
}
const methodSchema = z.object({
  method: z.string(),
  payment_mode: z.string(),
  is_active: z.boolean(),
  supported_currencies: z.array(z.string()).optional(),
  min_amount: z.number().optional(),
  max_amount: z.number().optional(),
});

export function verifyArcPayWebhook(
  raw: Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  now = Date.now(),
): boolean {
  const id = headers["webhook-id"],
    ts = headers["webhook-timestamp"],
    signature = headers["webhook-signature"];
  if (
    !secret ||
    typeof id !== "string" ||
    !id ||
    id.length > 255 ||
    typeof ts !== "string" ||
    !/^\d+$/.test(ts) ||
    typeof signature !== "string"
  )
    return false;
  if (
    !Number.isSafeInteger(Number(ts)) ||
    Math.abs(now / 1000 - Number(ts)) > 300
  )
    return false;
  const parts = signature.split(",").map((s) => s.trim());
  if (
    parts.filter((p) => p.startsWith("t=")).length !== 1 ||
    !parts.includes(`t=${ts}`)
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${id}.${ts}.`)
    .update(raw)
    .digest();
  return parts
    .filter((p) => p.startsWith("v1="))
    .some((p) => {
      const value = p.slice(3);
      return (
        /^[a-f0-9]{64}$/i.test(value) &&
        timingSafeEqual(Buffer.from(value, "hex"), expected)
      );
    });
}
