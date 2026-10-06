import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import type { integrationScenarioRunRequestSchema } from './integration.schema';

const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

type ScenarioRunRequest = z.infer<typeof integrationScenarioRunRequestSchema>;

export function canonicalScenarioRequestBody(input: ScenarioRunRequest): string {
  return JSON.stringify({
    runId: input.runId,
    siteId: input.siteId,
    scenarioKey: input.scenarioKey,
    requestedAt: input.requestedAt,
  });
}

export function isAuthorizedVvAdminScenarioRequest(input: {
  secret: string | undefined;
  signature: string | string[] | undefined;
  timestamp: string | string[] | undefined;
  path: string;
  body: string;
  now?: Date;
}): boolean {
  if (!input.secret || typeof input.signature !== 'string' || typeof input.timestamp !== 'string') {
    return false;
  }
  if (!/^[a-f0-9]{64}$/i.test(input.signature)) return false;

  const parsedTimestamp = Date.parse(input.timestamp);
  const now = input.now ?? new Date();
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now.getTime() - parsedTimestamp) > MAX_TIMESTAMP_AGE_MS) {
    return false;
  }

  const bodyHash = createHash('sha256').update(input.body).digest('hex');
  const expected = createHmac('sha256', input.secret)
    .update(['POST', input.path, input.timestamp, bodyHash].join('\n'))
    .digest();
  const received = Buffer.from(input.signature, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
