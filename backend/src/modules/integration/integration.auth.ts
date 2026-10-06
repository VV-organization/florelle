import { createHash, timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../../shared/middleware/error.middleware';

export function authorizeIntegrationRequest(
  authorization: string | undefined,
  expectedToken: string | undefined,
): { authorized: true } {
  if (!expectedToken) {
    throw new UnauthorizedError('Integration admin token is not configured');
  }
  if (!authorization?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Integration authorization is required');
  }
  const token = authorization.slice('Bearer '.length);
  if (!tokensMatch(token, expectedToken)) {
    throw new UnauthorizedError('Integration authorization is invalid');
  }
  return { authorized: true };
}

function tokensMatch(token: string, expectedToken: string): boolean {
  const tokenHash = createHash('sha256').update(token).digest();
  const expectedTokenHash = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(tokenHash, expectedTokenHash);
}
