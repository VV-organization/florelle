import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  authSuccessResponseSchema,
  publicUserSchema,
  updateProfileBodySchema,
  loginBodySchema,
  refreshSuccessResponseSchema,
  registrationChallengeResponseSchema,
  registerBodySchema,
  verifyRegistrationCodeBodySchema,
} from './auth.schema';
import { createAuthenticateHandler } from '../../shared/middleware/auth.middleware';
import type { AuthService } from './auth.service';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export function buildAuthRouter(
  authService: AuthService,
  options: { isProduction: boolean },
): FastifyPluginAsync {
  const cookieBase = {
    httpOnly: true,
    secure: options.isProduction,
    sameSite: 'lax' as const,
    path: '/api/v1/auth',
  };

  const plugin: FastifyPluginAsync = async (app: FastifyInstance) => {
    const typed = app.withTypeProvider<ZodTypeProvider>();
    const authenticate = createAuthenticateHandler(authService);
    typed.get('/me', {
      preHandler: authenticate,
      schema: { tags: ['auth'], response: { 200: publicUserSchema } },
    }, async (request) => authService.getMe(request.user!.id));
    typed.patch('/me', {
      preHandler: authenticate,
      schema: { tags: ['auth'], body: updateProfileBodySchema, response: { 200: publicUserSchema } },
    }, async (request) => authService.updateMe(request.user!.id, request.body));


    typed.post(
      '/register',
      {
        schema: {
          tags: ['auth'],
          body: registerBodySchema,
          response: { 202: registrationChallengeResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await authService.register(request.body);
        reply.status(202);
        return result;
      },
    );

    typed.post(
      '/register/verify',
      {
        schema: {
          tags: ['auth'],
          body: verifyRegistrationCodeBodySchema,
          response: { 200: authSuccessResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await authService.verifyRegistrationCode(request.body);
        reply.setCookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
          ...cookieBase,
          maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
        });
        return { user: result.user, accessToken: result.tokens.accessToken };
      },
    );

    typed.post(
      '/login',
      {
        schema: {
          tags: ['auth'],
          body: loginBodySchema,
          response: { 200: authSuccessResponseSchema },
        },
      },
      async (request, reply) => {
        const result = await authService.login(request.body);
        reply.setCookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
          ...cookieBase,
          maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
        });
        return { user: result.user, accessToken: result.tokens.accessToken };
      },
    );

    typed.post(
      '/refresh',
      {
        schema: {
          tags: ['auth'],
          response: { 200: refreshSuccessResponseSchema },
        },
      },
      async (request) => {
        const token = request.cookies[REFRESH_COOKIE_NAME];
        return authService.refresh(token);
      },
    );

    typed.post(
      '/logout',
      {
        schema: { tags: ['auth'] },
      },
      async (request, reply) => {
        const token = request.cookies[REFRESH_COOKIE_NAME];
        await authService.logout(token);
        reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
        reply.status(204);
        return;
      },
    );
  };

  return plugin;
}
