import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../shared/middleware/error.middleware';

type HeaderValue = string | string[] | undefined;

export type CatalogProtocolActor = {
  actorId: string;
  idempotencyKey: string | null;
  requestId: string;
  siteKey: string;
};

export type CatalogProtocolAuthInput = {
  headers: Record<string, HeaderValue>;
  method: string;
  path: string;
  rawBody: Buffer;
};

const actorIdMaxLength = 128;
const timestampWindowMilliseconds = 300_000;
const strictUtcTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authenticateCatalogProtocolRequest(
  input: CatalogProtocolAuthInput,
  secret: string | undefined,
  expectedSiteKey = 'florelle',
  now = new Date(),
): CatalogProtocolActor {
  if (!secret) {
    throw new UnauthorizedError('Integration protocol secret is not configured');
  }

  const actorId = readHeader(input.headers, 'x-vv-actor-id')?.trim();
  const requestId = readHeader(input.headers, 'x-vv-request-id');
  const siteKey = readHeader(input.headers, 'x-vv-site-key');
  const timestamp = readHeader(input.headers, 'x-vv-timestamp');
  const suppliedSignature = readHeader(input.headers, 'x-vv-signature');
  const idempotencyKey = readHeader(input.headers, 'idempotency-key');
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(
    input.method.toUpperCase(),
  );

  if (
    !actorId ||
    actorId.length > actorIdMaxLength ||
    !requestId ||
    !isUuid(requestId) ||
    siteKey !== expectedSiteKey ||
    !timestamp ||
    !isCurrentTimestamp(timestamp, now) ||
    !suppliedSignature ||
    (isMutation && (!idempotencyKey || !isUuid(idempotencyKey)))
  ) {
    throw new UnauthorizedError('Integration authentication failed');
  }

  const bodyDigest = createHash('sha256').update(input.rawBody).digest('hex');
  const canonical = `vv-admin.${timestamp}.${requestId}.${input.method.toUpperCase()}.${input.path}.${bodyDigest}`;
  const expectedSignature = `sha256=${createHmac('sha256', secret)
    .update(canonical)
    .digest('hex')}`;

  if (!matchesSignature(suppliedSignature, expectedSignature)) {
    throw new UnauthorizedError('Integration authentication failed');
  }

  return {
    actorId,
    idempotencyKey: idempotencyKey ?? null,
    requestId,
    siteKey,
  };
}

export function signedCatalogPathCandidates(path: string): string[] {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const relative = toRelativeCatalogPath(normalized);
  return [
    normalized,
    ...(normalized.startsWith('/api/v1/integration/catalog')
      ? [normalized.replace(/^\/api\/v1/, '')]
      : []),
    ...(relative ? [relative] : []),
  ];
}

function toRelativeCatalogPath(path: string): string | null {
  const [pathname = '', query = ''] = path.split('?');
  const prefixes = ['/api/v1/integration/catalog', '/admin/integration/catalog'];
  const prefix = prefixes.find(
    (candidate) =>
      pathname === candidate || pathname.startsWith(`${candidate}/`),
  );
  if (!prefix) return null;
  const relativePath = pathname.slice(prefix.length) || '/';
  return query ? `${relativePath}?${query}` : relativePath;
}

function readHeader(
  headers: Record<string, HeaderValue>,
  name: string,
): string | undefined {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
}

function isCurrentTimestamp(value: string, now: Date): boolean {
  if (!strictUtcTimestampPattern.test(value)) return false;
  const timestamp = Date.parse(value);
  const normalizedValue = value.includes('.')
    ? value
    : `${value.slice(0, -1)}.000Z`;
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === normalizedValue &&
    Math.abs(now.getTime() - timestamp) <= timestampWindowMilliseconds
  );
}

function isUuid(value: string): boolean {
  return uuidPattern.test(value);
}

function matchesSignature(received: string, expected: string): boolean {
  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
