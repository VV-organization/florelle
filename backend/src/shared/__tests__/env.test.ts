import { describe, it, expect } from 'vitest';
import { envSchema } from '../env';

const validBase = {
  NODE_ENV: 'test',
  PORT: '3000',
  HOST: '0.0.0.0',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/testdb',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'support@example.com',
  SMTP_PASSWORD: 'smtp-password',
  EMAIL_FROM: 'test@example.com',
  FX_API_KEY: 'fx-key',
  FX_BASE_CURRENCY: 'USD',
  FX_CACHE_TTL_SECONDS: '3600',
  PLATFORM_COMMISSION_PERCENT: '12',
  PLATFORM_RETAIL_MARKUP: '2.5',
};

describe('envSchema — PLATFORM_RETAIL_MARKUP', () => {
  it('parses valid "2.5" to 2.5', () => {
    const result = envSchema.safeParse({ ...validBase, PLATFORM_RETAIL_MARKUP: '2.5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PLATFORM_RETAIL_MARKUP).toBe(2.5);
    }
  });

  it('rejects "0.5" (≤ 1)', () => {
    const result = envSchema.safeParse({ ...validBase, PLATFORM_RETAIL_MARKUP: '0.5' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.PLATFORM_RETAIL_MARKUP).toBeDefined();
    }
  });

  it('rejects "abc" (non-numeric)', () => {
    const result = envSchema.safeParse({ ...validBase, PLATFORM_RETAIL_MARKUP: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.PLATFORM_RETAIL_MARKUP).toBeDefined();
    }
  });

  it('uses 2.5 as default when omitted', () => {
    const { PLATFORM_RETAIL_MARKUP: _, ...baseWithout } = validBase;
    const result = envSchema.safeParse(baseWithout);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PLATFORM_RETAIL_MARKUP).toBe(2.5);
    }
  });
});

describe('envSchema — payment provider', () => {
  it('defaults to disabled payment provider', () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PAYMENT_PROVIDER).toBe('disabled');
    }
  });

  it('accepts Arcopay SBP configuration', () => {
    const result = envSchema.safeParse({
      ...validBase,
      PAYMENT_PROVIDER: 'arcopay',
      PUBLIC_API_URL: 'https://flowers.example.com/api/v1',
      PUBLIC_FRONTEND_URL: 'https://flowers.example.com',
      ARCOPAY_API_URL: 'https://api.mapsign.pro/api/v1',
      ARCOPAY_API_KEY: 'api-key',
      ARCOPAY_BEARER_TOKEN: 'bearer-token',
      ARCOPAY_PUBLIC_KEY: 'public-key',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PAYMENT_PROVIDER).toBe('arcopay');
      expect(result.data.ARCOPAY_API_URL).toBe('https://api.mapsign.pro/api/v1');
    }
  });
});

describe('envSchema — SMTP email', () => {
  it('parses SMTP configuration', () => {
    const result = envSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.SMTP_HOST).toBe('smtp.example.com');
      expect(result.data.SMTP_PORT).toBe(465);
      expect(result.data.SMTP_SECURE).toBe(true);
      expect(result.data.SMTP_USER).toBe('support@example.com');
    }
  });

  it('rejects missing SMTP password', () => {
    const { SMTP_PASSWORD: _, ...withoutPassword } = validBase;
    const result = envSchema.safeParse(withoutPassword);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.SMTP_PASSWORD).toBeDefined();
    }
  });
});

it("preserves independent Florelle operator token",()=>{expect(envSchema.parse({...validBase,FLORELLE_INTEGRATION_TOKEN:"local-test-token"})).toHaveProperty("FLORELLE_INTEGRATION_TOKEN","local-test-token");});

describe('Arc Pay configuration',()=>{
 const arc={...validBase,PAYMENT_PROVIDER:'arc_pay',ARC_PAY_SECRET_KEY:'sk_test_local',ARC_PAY_WEBHOOK_SECRET:'local-webhook-secret',PUBLIC_FRONTEND_URL:'https://shop.test',PUBLIC_API_URL:'https://shop.test/api/v1'};
 it('accepts the new provider with independent secret and webhook keys',()=>{const value=envSchema.parse(arc);expect(value.PAYMENT_PROVIDER).toBe('arc_pay');expect(value.ARC_PAY_BASE_URL).toBe('https://api.arcpay.space/v1');});
 it.each(['ARC_PAY_SECRET_KEY','ARC_PAY_WEBHOOK_SECRET','PUBLIC_FRONTEND_URL','PUBLIC_API_URL'])('requires %s when enabled',name=>{expect(envSchema.safeParse({...arc,[name]:''}).success).toBe(false);});
 it('requires HTTPS return origins',()=>{expect(envSchema.safeParse({...arc,PUBLIC_FRONTEND_URL:'http://shop.test'}).success).toBe(false);});
});
