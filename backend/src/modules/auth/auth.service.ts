import bcrypt from 'bcrypt';
import { SignJWT, jwtVerify } from 'jose';
import { createHmac, randomInt, randomUUID } from 'node:crypto';
import type { Database } from '../../shared/db/client';
import type { RedisClient } from '../../shared/redis/client';
import type {
  LoginBody,
  UpdateProfileBody,
  PublicUser,
  RegisterBody,
  RegistrationChallengeResponse,
  VerifyRegistrationCodeBody,
} from './auth.schema';
import { users } from '../../shared/db/schema/users';
import { emailVerificationChallenges } from '../../shared/db/schema/email-verification-challenges';
import {
  AccountSuspendedError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRegistrationCodeError,
  InvalidRefreshTokenError,
  RegistrationEmailNotVerifiedError,
} from './auth.errors';
import { AppError, UnauthorizedError, ValidationError } from '../../shared/middleware/error.middleware';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { NotificationsService } from '../notifications/notifications.service';

// Constant-time equalization for /auth/login: run bcrypt.compare even when
// the email is not found, so response time does not leak user existence.
const FAKE_PASSWORD_HASH = bcrypt.hashSync('unused-placeholder', 12);
const REGISTRATION_CODE_RESEND_COOLDOWN_SECONDS = 60;
const REGISTRATION_CODE_MAX_ATTEMPTS = 5;

export type AuthServiceConfig = {
  accessSecret: Uint8Array;
  refreshSecret: Uint8Array;
  accessTtl: string;   // e.g. '15m'
  refreshTtl: string;  // e.g. '30d'
  refreshTtlSeconds: number; // e.g. 2592000 (used for Redis EX)
  registrationCodeTtlSeconds: number;
  registrationCodePepper: string;
};

export type AuthSuccess = {
  user: PublicUser;
  tokens: { accessToken: string; refreshToken: string };
};

export type AuthRuntime = {
  createRegistrationCode: () => string;
  now: () => Date;
};

export class AuthService {
  private readonly runtime: AuthRuntime;

  constructor(
    private readonly db: Database,
    private readonly redis: RedisClient,
    private readonly config: AuthServiceConfig,
    private readonly notifications?: Pick<
      NotificationsService,
      'sendRegistrationCode'
    >,
    runtime?: AuthRuntime,
  ) {
    this.runtime = runtime ?? {
      createRegistrationCode: () => String(randomInt(100_000, 1_000_000)),
      now: () => new Date(),
    };
  }

  async register(input: RegisterBody): Promise<RegistrationChallengeResponse> {
    const passwordHash = await bcrypt.hash(input.password, 12);

    const baseValues = {
      email: input.email,
      passwordHash,
      customerType: input.customerType,
      name: input.name ?? ([input.firstName, input.lastName].filter(Boolean).join(' ') || null),
      phone: input.phone || null,
      status: 'pending' as const,
    };

    const values = {...baseValues,firstName:input.firstName??null,lastName:input.lastName??null,
      companyName:input.customerType==='legal_entity'?(input.company??input.companyName??null):null};
    const registrationPayload = {passwordHash,customerType:values.customerType,name:values.name,firstName:values.firstName,lastName:values.lastName,companyName:values.companyName,phone:values.phone};

    let inserted: typeof users.$inferSelect;
    try {
      const result = await this.db.insert(users).values(values).returning();
      inserted = result[0]!;
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existingRows = await this.db
          .select()
          .from(users)
          .where(eq(users.email, input.email))
          .limit(1);
        const existing = existingRows[0];
        if (existing?.status === 'pending') {
          return this.createAndSendRegistrationChallenge(existing, registrationPayload);
        }
        throw new EmailAlreadyRegisteredError();
      }
      throw err;
    }

    return this.createAndSendRegistrationChallenge(inserted, registrationPayload);
  }

  private async createAndSendRegistrationChallenge(
    user: typeof users.$inferSelect,
    registrationPayload: NonNullable<typeof emailVerificationChallenges.$inferSelect['registrationPayload']>,
  ): Promise<RegistrationChallengeResponse> {
    if (!this.notifications) throw new Error('REGISTRATION_EMAIL_NOT_CONFIGURED');
    const cooldownKey = `registration-cooldown:${user.email}`;
    const acquired = await this.redis.set(cooldownKey, '1', 'EX', REGISTRATION_CODE_RESEND_COOLDOWN_SECONDS, 'NX');
    if (!acquired) throw new AppError(429, 'REGISTRATION_RESEND_COOLDOWN', 'Please wait before requesting another registration code');
    try {
      const code = this.runtime.createRegistrationCode();
      if (!/^\d{6}$/.test(code)) {
        throw new Error('REGISTRATION_CODE_GENERATOR_INVALID');
      }
      const now = this.runtime.now();
      const expiresAt = new Date(
        now.getTime() + this.config.registrationCodeTtlSeconds * 1000,
      );
      const resendAvailableAt = new Date(
        now.getTime() + REGISTRATION_CODE_RESEND_COOLDOWN_SECONDS * 1000,
      );
      const challengeId = randomUUID();
      const challengeResult = await this.db
        .insert(emailVerificationChallenges)
        .values({
          id: challengeId,
          userId: user.id,
          email: user.email,
          codeHash: this.digestRegistrationCode(challengeId, code),
          registrationPayload,
          expiresAt,
          resendAvailableAt,
        })
        .returning();
      const challenge = challengeResult[0]!;

      await this.notifications.sendRegistrationCode({
        to: user.email,
        code,
        expiresAt,
        idempotencyKey: `registration-code/${challenge.id}`,
      });

      return {
        challengeId:challenge.id,
        email: user.email,
        expiresAt: challenge.expiresAt.toISOString(),
        resendAvailableAt: challenge.resendAvailableAt.toISOString(),
      };
    } catch (error) {
      await this.redis.del(cooldownKey);
      throw error;
    }
  }

  async verifyRegistrationCode(
    input: VerifyRegistrationCodeBody,
  ): Promise<AuthSuccess> {
    const now = this.runtime.now();
    const activated = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: emailVerificationChallenges.id,
          userId: emailVerificationChallenges.userId,
          email: emailVerificationChallenges.email,
          codeHash: emailVerificationChallenges.codeHash,
          registrationPayload: emailVerificationChallenges.registrationPayload,
          attemptCount: emailVerificationChallenges.attemptCount,
          expiresAt: emailVerificationChallenges.expiresAt,
          consumedAt: emailVerificationChallenges.consumedAt,
          user: users,
        })
        .from(emailVerificationChallenges)
        .innerJoin(users, eq(users.id, emailVerificationChallenges.userId))
        .where(
          and(
            eq(emailVerificationChallenges.email, input.email),
            eq(emailVerificationChallenges.id, input.challengeId),
            eq(users.status, 'pending'),
            isNull(emailVerificationChallenges.consumedAt),
          ),
        )
        .orderBy(desc(emailVerificationChallenges.createdAt))
        .for('update')
        .limit(1);

      const challenge = rows[0];
      if (
        !challenge ||
        challenge.attemptCount >= REGISTRATION_CODE_MAX_ATTEMPTS ||
        challenge.expiresAt.getTime() <= now.getTime() ||
        this.digestRegistrationCode(challenge.id, input.code) !== challenge.codeHash
      ) {
        if (
          challenge &&
          challenge.attemptCount < REGISTRATION_CODE_MAX_ATTEMPTS &&
          challenge.expiresAt.getTime() > now.getTime()
        ) {
          await tx
            .update(emailVerificationChallenges)
            .set({ attemptCount: challenge.attemptCount + 1, updatedAt: now })
            .where(eq(emailVerificationChallenges.id, challenge.id))
            .returning();
        }
        return null;
      }

      const consumed = await tx
        .update(emailVerificationChallenges)
        .set({ consumedAt: now, updatedAt: now })
        .where(and(eq(emailVerificationChallenges.id, challenge.id), isNull(emailVerificationChallenges.consumedAt)))
        .returning();
      if (!consumed[0]) return null;

      const activatedRows = await tx
        .update(users)
        .set({ ...challenge.registrationPayload, status: 'active', updatedAt: now })
        .where(and(eq(users.id, challenge.userId), eq(users.status, 'pending')))
        .returning();
      if (!activatedRows[0]) throw new InvalidRegistrationCodeError();
      return activatedRows[0];
    });
    if (!activated) throw new InvalidRegistrationCodeError();

    const tokens = await this.issueTokens(activated.id, activated.role);
    await this.persistRefreshSession(activated.id, tokens.refreshJti);

    return {
      user: toPublicUser(activated),
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    };
  }

  async login(input: LoginBody): Promise<AuthSuccess> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1);

    const user = rows[0];
    const hashToCompare = user?.passwordHash ?? FAKE_PASSWORD_HASH;
    const passwordOk = await bcrypt.compare(input.password, hashToCompare);

    if (!user || !passwordOk) {
      throw new InvalidCredentialsError();
    }
    if (user.status === 'suspended') {
      throw new AccountSuspendedError();
    }
    if (user.status === 'pending') {
      throw new RegistrationEmailNotVerifiedError();
    }

    const tokens = await this.issueTokens(user.id, user.role);
    await this.persistRefreshSession(user.id, tokens.refreshJti);

    return {
      user: toPublicUser(user),
      tokens: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
    };
  }

  async refresh(refreshToken: string | undefined): Promise<{ accessToken: string }> {
    const { sub, role } = await this.verifyRefreshTokenAndSession(refreshToken);

    const accessToken = await new SignJWT({ role, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuedAt()
      .setExpirationTime(this.config.accessTtl)
      .sign(this.config.accessSecret);

    return { accessToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      const verified = await jwtVerify(refreshToken, this.config.refreshSecret);
      const sub = verified.payload.sub;
      if (typeof sub === 'string' && sub.length > 0) {
        await this.redis.del(`refresh:${sub}`);
      }
    } catch {
      // Swallow: the token is already dead, logout is idempotent.
    }
  }

  async verifyAccessToken(
    token: string,
  ): Promise<{ userId: string; role: 'buyer' | 'admin' }> {
    let payload: { sub?: string; role?: string; type?: string };
    try {
      const verified = await jwtVerify(token, this.config.accessSecret);
      payload = verified.payload as typeof payload;
    } catch {
      throw new UnauthorizedError('Invalid access token');
    }

    if (
      payload.type !== 'access' ||
      !payload.sub ||
      (payload.role !== 'buyer' && payload.role !== 'admin')
    ) {
      throw new UnauthorizedError('Invalid access token');
    }

    const user = await this.requireActiveUser(payload.sub);
    return { userId: user.id, role: user.role };
  }

  private async requireActiveUser(userId: string): Promise<typeof users.$inferSelect> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedError('User no longer exists');
    if (user.status === 'suspended') throw new AccountSuspendedError();
    if (user.status === 'pending') throw new RegistrationEmailNotVerifiedError();
    return user;
  }

  async getMe(userId: string): Promise<PublicUser> {
    return toPublicUser(await this.requireActiveUser(userId));
  }

  async updateMe(userId: string, input: UpdateProfileBody): Promise<PublicUser> {
    const user = await this.requireActiveUser(userId);
    if (input.company !== undefined && !input.company && user.customerType === 'legal_entity') {
      throw new ValidationError('Company is required for business profiles');
    }
    const [updated] = await this.db.update(users).set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
      ...(input.company !== undefined ? { companyName: input.company || null } : {}),
      updatedAt: this.runtime.now(),
    }).where(and(eq(users.id, userId), eq(users.status, 'active'))).returning();
    if (!updated) throw new UnauthorizedError('Profile is no longer active');
    return toPublicUser(updated);
  }

  private async issueTokens(
    userId: string,
    role: 'buyer' | 'admin',
  ): Promise<{ accessToken: string; refreshToken: string; refreshJti: string }> {
    const accessToken = await new SignJWT({ role, type: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(this.config.accessTtl)
      .sign(this.config.accessSecret);

    const jti = randomUUID();
    const refreshToken = await new SignJWT({ type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(jti)
      .setIssuedAt()
      .setExpirationTime(this.config.refreshTtl)
      .sign(this.config.refreshSecret);

    return { accessToken, refreshToken, refreshJti: jti };
  }

  private async persistRefreshSession(userId: string, jti: string): Promise<void> {
    await this.redis.set(
      `refresh:${userId}`,
      jti,
      'EX',
      this.config.refreshTtlSeconds,
    );
  }

  private digestRegistrationCode(challengeId: string, code: string): string {
    return createHmac('sha256', this.config.registrationCodePepper)
      .update(`${challengeId}:${code}`, 'utf8')
      .digest('hex');
  }

  private async verifyRefreshTokenAndSession(
    token: string | undefined,
  ): Promise<{ sub: string; role: 'buyer' | 'admin' }> {
    if (!token) {
      throw new InvalidRefreshTokenError();
    }

    let payload: { sub?: string; jti?: string; type?: string };
    try {
      const verified = await jwtVerify(token, this.config.refreshSecret);
      payload = verified.payload as typeof payload;
    } catch {
      throw new InvalidRefreshTokenError();
    }

    if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
      throw new InvalidRefreshTokenError();
    }

    const storedJti = await this.redis.get(`refresh:${payload.sub}`);
    if (!storedJti || storedJti !== payload.jti) {
      throw new InvalidRefreshTokenError();
    }

    const rows = await this.db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    const row = rows[0];
    if (!row) {
      throw new InvalidRefreshTokenError();
    }
    if (row.status === 'suspended') {
      throw new AccountSuspendedError();
    }

    if (row.status === 'pending') throw new RegistrationEmailNotVerifiedError();
    return { sub: row.id, role: row.role };
  }
}

function toPublicUser(row: typeof users.$inferSelect): PublicUser {
  return {
    id: row.id,
    email: row.email,
    customerType: row.customerType,
    name: row.name ?? [row.firstName, row.lastName].filter(Boolean).join(' '),
    company: row.companyName ?? '',
    companyName: row.companyName,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps the PostgreSQL error; preserve the unique-constraint branch.
  for(let depth=0;depth<5&&typeof error==='object'&&error!==null;depth++){
    if('code' in error&&error.code==='23505')return true;
    error='cause' in error?error.cause:undefined;
  }
  return false;
}
