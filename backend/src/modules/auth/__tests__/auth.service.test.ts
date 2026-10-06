import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthService, type AuthServiceConfig } from '../auth.service';
import type { Database } from '../../../shared/db/client';
import type { RedisClient } from '../../../shared/redis/client';
import bcrypt from 'bcrypt';
import { createHmac } from 'node:crypto';

vi.mock('bcrypt', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn(),
    hashSync: vi.fn(() => 'fake-hash'),
  },
}));

/**
 * Build a chainable Drizzle mock whose terminal methods can be overridden
 * per test.
 */
function createDbMock() {
  const db = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    for: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
  return db as unknown as Database & typeof db;
}

function createRedisMock() {
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  };
  return redis as unknown as RedisClient & typeof redis;
}

function createNotificationsMock() {
  return {
    sendRegistrationCode: vi.fn().mockResolvedValue(undefined),
  };
}

function buildStoredRegistrationChallenge(input: {
  userId: string;
  email: string;
  code: string;
  createdAt: Date;
}) {
  const id = '11111111-1111-1111-1111-111111111111';
  return {
    id,
    userId: input.userId,
    email: input.email,
    codeHash: createHmac('sha256', testConfig.registrationCodePepper)
      .update(`${id}:${input.code}`, 'utf8')
      .digest('hex'),
    attemptCount: 0,
    expiresAt: new Date(input.createdAt.getTime() + 10 * 60 * 1000),
    consumedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

const testConfig: AuthServiceConfig = {
  accessSecret: new TextEncoder().encode(
    'test-access-secret-at-least-32-characters-long',
  ),
  refreshSecret: new TextEncoder().encode(
    'test-refresh-secret-at-least-32-characters-long',
  ),
  accessTtl: '15m',
  refreshTtl: '30d',
  refreshTtlSeconds: 60 * 60 * 24 * 30,
  registrationCodeTtlSeconds: 10 * 60,
  registrationCodePepper: 'registration-code-pepper-at-least-32-chars',
};

describe('AuthService', () => {
  let db: ReturnType<typeof createDbMock>;
  let redis: ReturnType<typeof createRedisMock>;
  let notifications: ReturnType<typeof createNotificationsMock>;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDbMock();
    redis = createRedisMock();
    notifications = createNotificationsMock();
    service = new AuthService(db, redis, testConfig, notifications, {
      createRegistrationCode: () => '123456',
      now: () => new Date('2026-04-10T10:00:00.000Z'),
    });
  });

  async function forgeAccessToken(options: {
    sub: string;
    role: 'buyer' | 'admin';
    secret?: Uint8Array;
    expiresIn?: string;
    type?: string;
  }): Promise<string> {
    const { SignJWT } = await import('jose');
    return new SignJWT({ role: options.role, type: options.type ?? 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(options.sub)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '15m')
      .sign(options.secret ?? testConfig.accessSecret);
  }

  async function forgeRefreshToken(options: {
    sub: string;
    jti: string;
    secret?: Uint8Array;
    expiresIn?: string;
    type?: string;
  }): Promise<string> {
    const { SignJWT } = await import('jose');
    return new SignJWT({ type: options.type ?? 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(options.sub)
      .setJti(options.jti)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '30d')
      .sign(options.secret ?? testConfig.refreshSecret);
  }

  it('instantiates', () => {
    expect(service).toBeInstanceOf(AuthService);
  });

  describe('register', () => {
    const validInput = {
      customerType: 'legal_entity' as const,
      email: 'buyer@example.com',
      password: 'correct-horse-battery',
      companyName: 'Acme Flowers',
    };

    const dbUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'buyer@example.com',
      passwordHash: 'hashed-value',
      companyName: 'Acme Flowers',
      customerType: 'legal_entity' as const,
      firstName: null,
      lastName: null,
      phone: null,
      role: 'buyer' as const,
      status: 'active' as const,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    };

    const pendingDbUser = { ...dbUser, status: 'pending' as const };

    const dbChallenge = {
      id: '11111111-1111-1111-1111-111111111111',
      userId: pendingDbUser.id,
      email: pendingDbUser.email,
      codeHash: 'code-hash',
      attemptCount: 0,
      expiresAt: new Date('2026-04-10T10:10:00.000Z'),
      resendAvailableAt: new Date('2026-04-10T10:01:00.000Z'),
      consumedAt: null,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    };

    it('hashes the password with bcrypt cost factor 12', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
      db.returning
        .mockResolvedValueOnce([pendingDbUser])
        .mockResolvedValueOnce([dbChallenge]);

      await service.register(validInput);

      expect(bcrypt.default.hash).toHaveBeenCalledWith('correct-horse-battery', 12);
    });

    it('throws EmailAlreadyRegisteredError when insert hits unique constraint', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);

      const uniqueErr = Object.assign(new Error('unique'), { code: '23505' });
      db.returning.mockRejectedValue(uniqueErr);
      db.limit.mockResolvedValue([{ ...dbUser, status: 'active' }]);

      await expect(service.register(validInput)).rejects.toThrow(
        'Email is already registered',
      );
    });

    it('sends a fresh code when the email already has a pending registration', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
      const uniqueErr = Object.assign(new Error('unique'), { code: '23505' });
      db.returning
        .mockRejectedValueOnce(uniqueErr)
        .mockResolvedValueOnce([dbChallenge]);
      db.limit.mockResolvedValue([pendingDbUser]);

      const result = await service.register(validInput);

      expect(result.email).toBe('buyer@example.com');
      expect(notifications.sendRegistrationCode).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'buyer@example.com',
          code: '123456',
        }),
      );
      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
    });

    it('creates user with role=buyer and status=pending', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
      db.returning
        .mockResolvedValueOnce([pendingDbUser])
        .mockResolvedValueOnce([dbChallenge]);

      const result = await service.register(validInput);

      expect(db.insert).toHaveBeenCalled();
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'buyer@example.com',
          passwordHash: 'hashed-value',
          companyName: 'Acme Flowers',
          status: 'pending',
        }),
      );
      expect(result).toEqual({
        challengeId:'11111111-1111-1111-1111-111111111111',
        email: 'buyer@example.com',
        expiresAt: '2026-04-10T10:10:00.000Z',
        resendAvailableAt: '2026-04-10T10:01:00.000Z',
      });
    });

    it('stores a registration code challenge and sends the code by email', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
      db.returning
        .mockResolvedValueOnce([pendingDbUser])
        .mockResolvedValueOnce([dbChallenge]);

      const result = await service.register(validInput);

      expect(result.email).toBe('buyer@example.com');
      expect(db.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: pendingDbUser.id,
          email: 'buyer@example.com',
          expiresAt: new Date('2026-04-10T10:10:00.000Z'),
          resendAvailableAt: new Date('2026-04-10T10:01:00.000Z'),
        }),
      );
      expect(notifications.sendRegistrationCode).toHaveBeenCalledWith({
        to: 'buyer@example.com',
        code: '123456',
        expiresAt: new Date('2026-04-10T10:10:00.000Z'),
        idempotencyKey: 'registration-code/11111111-1111-1111-1111-111111111111',
      });
      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
    });

    it('does not issue tokens before the email code is verified', async () => {
      const bcrypt = await import('bcrypt');
      vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
      db.returning
        .mockResolvedValueOnce([pendingDbUser])
        .mockResolvedValueOnce([dbChallenge]);

      const result = await service.register(validInput);

      expect(result).not.toHaveProperty('tokens');
      expect(result).not.toHaveProperty('user');
      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
    });

    describe('individual', () => {
      const validIndividual = {
        customerType: 'individual' as const,
        email: 'jane@example.com',
        password: 'correct-horse-battery',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+1 555 123 4567',
      };

      const dbIndividual = {
        id: '00000000-0000-0000-0000-000000000002',
        email: 'jane@example.com',
        passwordHash: 'hashed-value',
        customerType: 'individual' as const,
        companyName: null,
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '+1 555 123 4567',
        role: 'buyer' as const,
        status: 'active' as const,
        createdAt: new Date('2026-04-29T10:00:00.000Z'),
        updatedAt: new Date('2026-04-29T10:00:00.000Z'),
      };

      it('inserts firstName/lastName/phone and leaves companyName null', async () => {
        const bcrypt = await import('bcrypt');
        vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
        db.returning
          .mockResolvedValueOnce([{ ...dbIndividual, status: 'pending' as const }])
          .mockResolvedValueOnce([{ ...dbChallenge, userId: dbIndividual.id, email: dbIndividual.email }]);

        await service.register(validIndividual);

        expect(db.values).toHaveBeenCalledWith(
          expect.objectContaining({
            email: 'jane@example.com',
            passwordHash: 'hashed-value',
            customerType: 'individual',
            firstName: 'Jane',
            lastName: 'Doe',
            phone: '+1 555 123 4567',
          }),
        );
        const args = vi.mocked(db.values).mock.calls[0]![0] as Record<string, unknown>;
        expect(args.companyName).toBeNull();
      });

      it('returned user exposes individual fields and customerType', async () => {
        const bcrypt = await import('bcrypt');
        vi.mocked(bcrypt.default.hash).mockResolvedValue('hashed-value' as never);
        db.returning
          .mockResolvedValueOnce([{ ...dbIndividual, status: 'pending' as const }])
          .mockResolvedValueOnce([{ ...dbChallenge, userId: dbIndividual.id, email: dbIndividual.email }]);

        const result = await service.register(validIndividual);

        expect(result.email).toBe('jane@example.com');
      });
    });
  });

  describe('verifyRegistrationCode', () => {
    const pendingUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'buyer@example.com',
      passwordHash: 'hashed-value',
      companyName: 'Acme Flowers',
      customerType: 'legal_entity' as const,
      firstName: null,
      lastName: null,
      phone: null,
      role: 'buyer' as const,
      status: 'pending' as const,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    };

    const activeUser = { ...pendingUser, status: 'active' as const };

    it('activates the user and issues tokens when the code is correct', async () => {
      const challenge = buildStoredRegistrationChallenge({
        userId: pendingUser.id,
        email: pendingUser.email,
        code: '123456',
        createdAt: new Date('2026-04-10T10:00:00.000Z'),
      });
      db.limit.mockResolvedValueOnce([{ ...challenge, user: pendingUser }]);
      db.returning
        .mockResolvedValueOnce([{ ...challenge, consumedAt: new Date('2026-04-10T10:00:00.000Z') }])
        .mockResolvedValueOnce([activeUser]);

      const result = await service.verifyRegistrationCode({ challengeId:'11111111-1111-1111-1111-111111111111',
        email: 'buyer@example.com',
        code: '123456',
      });

      expect(result.user.status).toBe('active');
      expect(result.tokens.accessToken).toMatch(/^eyJ/);
      expect(result.tokens.refreshToken).toMatch(/^eyJ/);
      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${pendingUser.id}`,
        expect.any(String),
        'EX',
        60 * 60 * 24 * 30,
      );
    });

    it('rejects an invalid code without issuing tokens', async () => {
      const challenge = buildStoredRegistrationChallenge({
        userId: pendingUser.id,
        email: pendingUser.email,
        code: '123456',
        createdAt: new Date('2026-04-10T10:00:00.000Z'),
      });
      db.limit.mockResolvedValueOnce([{ ...challenge, user: pendingUser }]);

      await expect(
        service.verifyRegistrationCode({ challengeId:'11111111-1111-1111-1111-111111111111', email: 'buyer@example.com', code: '000000' }),
      ).rejects.toThrow('Registration code is invalid or expired');

      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
      expect(db.update).toHaveBeenCalledTimes(1);
    });

    it('does not issue tokens if another request already consumed the code', async () => {
      const challenge = buildStoredRegistrationChallenge({ userId: pendingUser.id, email: pendingUser.email, code: '123456', createdAt: new Date('2026-04-10T10:00:00.000Z') });
      db.limit.mockResolvedValueOnce([{ ...challenge, user: pendingUser }]);
      db.returning.mockResolvedValueOnce([]);
      await expect(service.verifyRegistrationCode({ challengeId:'11111111-1111-1111-1111-111111111111', email: pendingUser.email, code: '123456' })).rejects.toThrow('Registration code is invalid or expired');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('rejects an expired code', async () => {
      const challenge = buildStoredRegistrationChallenge({
        userId: pendingUser.id,
        email: pendingUser.email,
        code: '123456',
        createdAt: new Date('2026-04-10T09:00:00.000Z'),
      });
      db.limit.mockResolvedValueOnce([{ ...challenge, user: pendingUser }]);

      await expect(
        service.verifyRegistrationCode({ challengeId:'11111111-1111-1111-1111-111111111111', email: 'buyer@example.com', code: '123456' }),
      ).rejects.toThrow('Registration code is invalid or expired');

      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
    });
  });

  describe('login', () => {
    const validInput = {
      email: 'buyer@example.com',
      password: 'correct-horse-battery',
    };

    const dbUser = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'buyer@example.com',
      passwordHash: 'stored-hash',
      companyName: 'Acme Flowers',
      customerType: 'legal_entity' as const,
      firstName: null,
      lastName: null,
      phone: null,
      role: 'buyer' as const,
      status: 'active' as const,
      createdAt: new Date('2026-04-10T10:00:00.000Z'),
      updatedAt: new Date('2026-04-10T10:00:00.000Z'),
    };

    it('happy path returns token pair and public user', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      db.limit.mockResolvedValue([dbUser]);

      const result = await service.login(validInput);

      expect(result.user.id).toBe(dbUser.id);
      expect(result.tokens.accessToken).toMatch(/^eyJ/);
      expect(result.tokens.refreshToken).toMatch(/^eyJ/);
    });

    it('throws InvalidCredentialsError for unknown email AND still calls bcrypt.compare', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      db.limit.mockResolvedValue([]);

      await expect(service.login(validInput)).rejects.toThrow(
        'Invalid email or password',
      );
      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('throws InvalidCredentialsError on wrong password', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
      db.limit.mockResolvedValue([dbUser]);

      await expect(service.login(validInput)).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('throws AccountSuspendedError when user is suspended', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      db.limit.mockResolvedValue([{ ...dbUser, status: 'suspended' }]);

      await expect(service.login(validInput)).rejects.toThrow(
        'Account is suspended',
      );
    });

    it('does not allow login before registration code verification', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      db.limit.mockResolvedValue([{ ...dbUser, status: 'pending' }]);

      await expect(service.login(validInput)).rejects.toThrow(
        'Registration email is not verified',
      );
    });

    it('login overwrites the existing refresh key (single-session)', async () => {
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
      db.limit.mockResolvedValue([dbUser]);

      await service.login(validInput);

      expect(redis.set).toHaveBeenCalledWith(
        `refresh:${dbUser.id}`,
        expect.any(String),
        'EX',
        60 * 60 * 24 * 30,
      );
      expect(redis.set).toHaveBeenCalledTimes(1);
    });
  });

  describe('refresh', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const jti = '11111111-1111-1111-1111-111111111111';
    const activeUser = {
      id: userId,
      role: 'buyer' as const,
      status: 'active' as const,
    };

    it('happy path: returns new access token without touching cookie or Redis', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti });
      redis.get.mockResolvedValue(jti);
      db.limit.mockResolvedValue([activeUser]);

      const result = await service.refresh(token);

      expect(result.accessToken).toMatch(/^eyJ/);
      expect(redis.set.mock.calls.some(([key]) => String(key).startsWith('refresh:'))).toBe(false);
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('throws InvalidRefreshTokenError when token is undefined', async () => {
      await expect(service.refresh(undefined)).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws InvalidRefreshTokenError for a malformed JWT', async () => {
      await expect(service.refresh('not.a.jwt')).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws InvalidRefreshTokenError for a JWT signed with wrong secret', async () => {
      const wrongSecret = new TextEncoder().encode(
        'different-secret-that-is-also-32-chars-long-enough',
      );
      const token = await forgeRefreshToken({
        sub: userId,
        jti,
        secret: wrongSecret,
      });

      await expect(service.refresh(token)).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws InvalidRefreshTokenError when payload.type is not "refresh"', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti, type: 'access' });

      await expect(service.refresh(token)).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws InvalidRefreshTokenError when Redis has a different jti', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti });
      redis.get.mockResolvedValue('22222222-2222-2222-2222-222222222222');

      await expect(service.refresh(token)).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws InvalidRefreshTokenError when Redis has no session at all', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti });
      redis.get.mockResolvedValue(null);

      await expect(service.refresh(token)).rejects.toThrow(
        'Refresh token is invalid or expired',
      );
    });

    it('throws AccountSuspendedError when the user is suspended', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti });
      redis.get.mockResolvedValue(jti);
      db.limit.mockResolvedValue([{ ...activeUser, status: 'suspended' }]);

      await expect(service.refresh(token)).rejects.toThrow(
        'Account is suspended',
      );
    });
  });

  describe('logout', () => {
    const userId = '00000000-0000-0000-0000-000000000001';
    const jti = '11111111-1111-1111-1111-111111111111';

    it('deletes the refresh key for valid token', async () => {
      const token = await forgeRefreshToken({ sub: userId, jti });

      await service.logout(token);

      expect(redis.del).toHaveBeenCalledWith(`refresh:${userId}`);
    });

    it('does not throw when token is undefined', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(redis.del).not.toHaveBeenCalled();
    });

    it('does not throw when token is malformed', async () => {
      await expect(service.logout('garbage')).resolves.toBeUndefined();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  describe('verifyAccessToken', () => {
    const userId = '00000000-0000-0000-0000-000000000001';

    it('returns { userId, role } for valid access token', async () => {
      const token = await forgeAccessToken({ sub: userId, role: 'buyer' });
      db.limit.mockResolvedValue([{ id: userId, role: 'buyer', status: 'active' }]);

      const result = await service.verifyAccessToken(token);

      expect(result).toEqual({ userId, role: 'buyer' });
    });

    it('throws UnauthorizedError on malformed token', async () => {
      await expect(service.verifyAccessToken('garbage')).rejects.toThrow(
        'Invalid access token',
      );
    });

    it('throws UnauthorizedError on wrong-secret token', async () => {
      const wrongSecret = new TextEncoder().encode(
        'different-secret-that-is-also-32-chars-long-enough',
      );
      const token = await forgeAccessToken({
        sub: userId,
        role: 'buyer',
        secret: wrongSecret,
      });
      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'Invalid access token',
      );
    });

    it('throws UnauthorizedError when type is not "access"', async () => {
      const token = await forgeAccessToken({
        sub: userId,
        role: 'buyer',
        type: 'refresh',
      });
      await expect(service.verifyAccessToken(token)).rejects.toThrow(
        'Invalid access token',
      );
    });
  });
});
