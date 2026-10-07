import 'dotenv/config';
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(1).optional());

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .preprocess(emptyToUndefined, z.enum(['true', 'false']).default('true'))
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().email(),
  SMTP_PASSWORD: z.string().min(1),
  EMAIL_FROM: z.string().email(),

  FX_API_KEY: z.string().min(1),
  FX_BASE_CURRENCY: z.string().length(3).default('USD'),
  FX_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  PLATFORM_COMMISSION_PERCENT: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(12),
  PLATFORM_RETAIL_MARKUP: z.coerce
    .number()
    .finite()
    .gt(1, 'PLATFORM_RETAIL_MARKUP must be > 1')
    .default(2.5),

  PAYMENT_PROVIDER: z.enum(['disabled', 'mock', 'arcopay', 'arc_pay']).default('disabled'),
  FX_OFFLINE: z.preprocess(emptyToUndefined, z.enum(['true','false']).default('false')).transform(v => v === 'true'),
  MEDIA_ROOT: z.string().default('.runtime/media'),
  PUBLIC_API_URL: optionalUrl,
  PUBLIC_FRONTEND_URL: optionalUrl,

  ARC_PAY_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().default('https://api.arcpay.space/v1')),
  ARC_PAY_SECRET_KEY: optionalSecret,
  ARC_PAY_WEBHOOK_SECRET: optionalSecret,
  ARCOPAY_API_URL: optionalUrl,
  ARCOPAY_API_KEY: optionalSecret,
  ARCOPAY_BEARER_TOKEN: optionalSecret,
  ARCOPAY_PUBLIC_KEY: optionalSecret,

  VV_ADMIN_INTEGRATION_ENABLED: z
    .preprocess(emptyToUndefined, z.enum(['true', 'false']).optional())
    .transform((value) => value === 'true'),
  VV_ADMIN_WEBHOOK_URL: optionalUrl,
  VV_ADMIN_WEBHOOK_SITE_KEY: optionalSecret,
  VV_ADMIN_WEBHOOK_SECRET: optionalSecret,
  VV_ADMIN_WEBHOOK_SECRET_VERSION: z
    .preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
  VV_ADMIN_INTEGRATION_SECRET: optionalSecret,
  FLORELLE_INTEGRATION_TOKEN: optionalSecret,
  FLOWER_POINT_INTEGRATION_TOKEN: optionalSecret,
}).superRefine((value, ctx) => {
  if (value.PAYMENT_PROVIDER !== 'arc_pay') return;
  for (const field of ['ARC_PAY_SECRET_KEY','ARC_PAY_WEBHOOK_SECRET','PUBLIC_FRONTEND_URL','PUBLIC_API_URL'] as const) {
    if (!value[field]) ctx.addIssue({code:z.ZodIssueCode.custom,path:[field],message:'Required for Arc Pay'});
  }
  if (value.ARC_PAY_SECRET_KEY && !/^sk_(test|live)_\S+$/.test(value.ARC_PAY_SECRET_KEY)) ctx.addIssue({code:z.ZodIssueCode.custom,path:['ARC_PAY_SECRET_KEY'],message:'Expected Arc Pay secret key'});
  for (const field of ['ARC_PAY_BASE_URL','PUBLIC_FRONTEND_URL','PUBLIC_API_URL'] as const) {
    if (!value[field]) continue;
    try {const url=new URL(value[field]!);if(url.protocol!=='https:' || url.username || url.password) throw Error();}
    catch {ctx.addIssue({code:z.ZodIssueCode.custom,path:[field],message:'An HTTPS URL without credentials is required'});}
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables');
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
