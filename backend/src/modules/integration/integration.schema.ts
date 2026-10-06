import { z } from 'zod';

export const integrationManifestSchema = z.object({
  site: z.object({
    key: z.literal('florelle'),
    displayName: z.literal('Florelle'),
    publicOrigin: z.string().url(),
    adminOrigin: z.string().url(),
  }),
  commerceEvents: z.object({
    schemaVersion: z.literal(1),
    delivery: z.literal('site_to_vv_admin_webhook'),
  }),
  healthChecks: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/),
    label: z.string().min(1),
    kind: z.literal('http_status'),
    method: z.literal('GET'),
    url: z.string().url(),
    timeoutMs: z.number().int().positive(),
    intervalSeconds: z.number().int().positive(),
  })),
  syntheticScenarios: z.array(z.object({
    key: z.literal('checkout_payment_reached'),
    label: z.string().min(1),
    kind: z.literal('synthetic_transaction'),
    productionSafe: z.literal(true),
    effect: z.literal('creates_synthetic_entities'),
    requiresCleanup: z.literal(true),
    timeoutMs: z.number().int().positive(),
    intervalSeconds: z.number().int().positive(),
    run: z.object({ method: z.literal('POST'), url: z.string().url() }),
  })),
  actions: z.array(z.never()),
  catalog: z.object({
    baseUrl: z.string().url(),
    auth: z.object({ scheme: z.literal('vv_hmac') }),
    locales: z.array(z.enum(['ru', 'en'])),
    categories: z.object({
      enabled: z.literal(true),
      maxDepth: z.union([z.literal(1), z.literal(2)]),
      fields: z.array(z.string()),
      deletion: z.object({
        mode: z.literal('blocked_by_references'),
        dryRun: z.literal(true),
      }),
    }),
    resources: z.object({
      products: z.object({ enabled: z.boolean() }).passthrough(),
      offers: z.object({ enabled: z.boolean() }).passthrough(),
      destinations: z.object({ enabled: z.boolean() }).passthrough(),
      sellers: z.object({ enabled: z.boolean() }).passthrough(),
      collections: z.object({ enabled: z.boolean() }).passthrough(),
    }),
    media: z.object({
      mode: z.literal('url'),
      upload:z.object({url:z.string().url(),method:z.literal('POST'),auth:z.literal('bearer'),body:z.literal('raw')}).optional(),
      maxBytes: z.number().int().positive(),
      mimeTypes: z.array(z.string()),
    }),
  }),
});

export const integrationReadinessSchema = z.object({
  status: z.enum(['ready', 'not_configured', 'degraded']),
  checks: z.array(
    z.object({
      name: z.enum([
        'postgres',
        'redis',
        'payment_provider',
        'vv_admin_dispatch',
      ]),
      status: z.enum(['ok', 'not_configured', 'failed']),
      message: z.string(),
    }),
  ),
});

export const integrationScenarioResultSchema = z.object({
  status: z.enum(['healthy', 'down']),
  summary: z.string().min(1),
  error: z.string().min(1).nullable(),
  payment: z.object({ reached: z.boolean() }),
  syntheticEntities: z.array(z.object({
    type: z.literal('order'),
    externalId: z.string().uuid(),
    cleanupStatus: z.enum(['cancelled', 'failed']),
  })),
  steps: z.null(),
  artifacts: z.null(),
  metadata: z.null(),
});

export const integrationScenarioRunRequestSchema = z.object({
  runId: z.string().min(1).max(191),
  siteId: z.string().min(1).max(191),
  scenarioKey: z.literal('checkout_payment_reached'),
  requestedAt: z.string().datetime({ offset: true }),
}).strict();
