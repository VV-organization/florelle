import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { AuthService } from '../../modules/auth/auth.service';
import { UnauthorizedError } from './error.middleware';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      role: 'buyer' | 'admin';
    };
  }
}

/**
 * Factory that returns a Fastify preHandler hook closing over an AuthService.
 *
 * Usage in app.ts:
 *   app.decorate('authenticate', createAuthenticateHandler(authService));
 *
 * Usage in protected routes:
 *   app.get('/me', { preHandler: [app.authenticate] }, ...)
 */
export function createAuthenticateHandler(
  authService: AuthService,
): preHandlerAsyncHookHandler {
  return async function authenticate(
    request: FastifyRequest,
    _reply: FastifyReply,
  ): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedError('Missing Bearer token');
    }
    const token = header.slice('Bearer '.length);
    const { userId, role } = await authService.verifyAccessToken(token);
    request.user = { id: userId, role };
  };
}
