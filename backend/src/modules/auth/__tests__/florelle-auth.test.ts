import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { SignJWT } from 'jose';
import { AuthService, type AuthServiceConfig } from '../auth.service';
import { registerBodySchema, updateProfileBodySchema } from '../auth.schema';
import { buildAuthRouter } from '../auth.router';
import { errorHandler } from '../../../shared/middleware/error.middleware';
import type { Database } from '../../../shared/db/client';
import type { RedisClient } from '../../../shared/redis/client';

vi.mock('bcrypt', () => ({ default: { hash: vi.fn(async () => 'hash'), hashSync: () => 'fake', compare: vi.fn(async () => true) } }));
const id = '00000000-0000-0000-0000-000000000001';
const user = { id, email: 'buyer@example.com', passwordHash: 'hash', customerType: 'legal_entity', name: 'Анна Мария Иванова', companyName: 'Цветы', firstName: null, lastName: null, phone: '+79991234567', role: 'buyer', status: 'active', createdAt: new Date(), updatedAt: new Date() };
const config: AuthServiceConfig = { accessSecret: new TextEncoder().encode('access-secret-long-enough-for-test'), refreshSecret: new TextEncoder().encode('refresh-secret-long-enough-for-test'), accessTtl: '15m', refreshTtl: '30d', refreshTtlSeconds: 2592000, registrationCodeTtlSeconds: 600, registrationCodePepper: 'test-pepper' };
function fixture() {
  const db = { select: vi.fn().mockReturnThis(), from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([user]), insert: vi.fn().mockReturnThis(), values: vi.fn().mockReturnThis(), returning: vi.fn().mockResolvedValue([user]), update: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis() };
  const redis = { get: vi.fn(), set: vi.fn().mockResolvedValue('OK'), del: vi.fn() };
  const mail = { sendRegistrationCode: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(db as unknown as Database, redis as unknown as RedisClient, config, mail);
  return { db, redis, mail, service };
}
async function token() { return new SignJWT({ role: 'admin', type: 'access' }).setProtectedHeader({ alg: 'HS256' }).setSubject(id).setExpirationTime('15m').sign(config.accessSecret); }

describe('Florelle registration and profile', () => {
  it('accepts full names without requiring a surname split or phone', () => {
    const result = registerBodySchema.safeParse({ customerType: 'individual', email: 'A@EXAMPLE.COM', password: 'password1', name: ' Анна Мария Иванова ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ name: 'Анна Мария Иванова', email: 'a@example.com' });
  });
  it('accepts B2B company and optional contact fields', () => {
    expect(registerBodySchema.safeParse({ customerType: 'legal_entity', email: 'a@example.com', password: 'password1', company: 'Цветы' }).success).toBe(true);
  });
  it('requires a name for individuals and company for businesses', () => {
    for (const customerType of ['individual', 'legal_entity']) expect(registerBodySchema.safeParse({ customerType, email: 'a@example.com', password: 'password1' }).success).toBe(false);
  });
  it('checks persisted active identity and uses its current role', async () => {
    const { service } = fixture();
    expect(await service.verifyAccessToken(await token())).toEqual({ userId: id, role: 'buyer' });
  });
  it.each(['pending', 'suspended'])('rejects access tokens for %s users', async (status) => {
    const { service, db } = fixture(); db.limit.mockResolvedValue([{ ...user, status }]);
    await expect(service.verifyAccessToken(await token())).rejects.toThrow();
  });
  it('returns a safe public profile with unified fields', async () => {
    const { service } = fixture();
    const result = await service.getMe(id);
    expect(result).toMatchObject({ name: user.name, company: 'Цветы', customerType: 'legal_entity' });
    expect(result).not.toHaveProperty('passwordHash');
  });
  it('updates full name, phone and company without changing segment', async () => {
    const { service, db } = fixture(); db.returning.mockResolvedValue([{ ...user, name: 'Новое полное имя', companyName: 'Компания' }]);
    const result = await service.updateMe(id, { name: 'Новое полное имя', company: 'Компания' });
    expect(result).toMatchObject({ name: 'Новое полное имя', company: 'Компания', customerType: 'legal_entity' });
    expect(db.set.mock.calls[0]![0]).not.toHaveProperty('customerType');
    expect(db.set.mock.calls[0]![0]).not.toHaveProperty('firstName');
  });
  it('preserves optional company on individual profiles without changing customer type', async () => {
    const { service, db } = fixture();
    db.limit.mockResolvedValue([{ ...user, customerType: 'individual', companyName: null }]);
    db.returning.mockResolvedValue([{ ...user, customerType: 'individual', companyName: 'Личная компания' }]);
    expect(await service.updateMe(id, { company: 'Личная компания' })).toMatchObject({ customerType: 'individual', company: 'Личная компания' });
    expect(db.set.mock.calls[0]![0]).toMatchObject({ companyName: 'Личная компания' });
    expect(db.set.mock.calls[0]![0]).not.toHaveProperty('customerType');
  });

  it('accepts clearing optional company and rejects clearing required business company', async () => {
    expect(updateProfileBodySchema.safeParse({ company: '' }).success).toBe(true);
    const { service, db } = fixture();
    await expect(service.updateMe(id, { company: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    db.limit.mockResolvedValue([{ ...user, customerType: 'individual' }]);
    db.returning.mockResolvedValue([{ ...user, customerType: 'individual', companyName: null }]);
    expect(await service.updateMe(id, { company: '' })).toMatchObject({ company: '', customerType: 'individual' });
  });

  it('enforces resend cooldown before any SMTP delivery', async () => {
    const { service, redis, mail } = fixture(); redis.set.mockResolvedValue(null as never);
    await expect(service.register({ customerType: 'legal_entity', email: user.email, password: 'password1', companyName: 'Цветы' })).rejects.toMatchObject({ statusCode: 429 });
    expect(mail.sendRegistrationCode).not.toHaveBeenCalled();
  });
  it('fails registration and releases cooldown when SMTP fails', async () => {
    const { service, db, mail, redis } = fixture();
    db.returning.mockResolvedValueOnce([{ ...user, status: 'pending' }]).mockResolvedValueOnce([{ id, expiresAt: new Date(), resendAvailableAt: new Date() }]);
    mail.sendRegistrationCode.mockRejectedValue(new Error('SMTP unavailable'));
    await expect(service.register({ customerType: 'legal_entity', email: user.email, password: 'password1', companyName: 'Цветы' })).rejects.toThrow('SMTP unavailable');
    expect(redis.del).toHaveBeenCalledWith(`registration-cooldown:${user.email}`);
  });
  it('serves protected GET/PATCH /me and rejects changing customer type', async () => {
    const { service } = fixture(); const app = Fastify();
    app.setValidatorCompiler(validatorCompiler); app.setSerializerCompiler(serializerCompiler); app.setErrorHandler(errorHandler);
    await app.register(cookie); await app.register(buildAuthRouter(service, { isProduction: false }), { prefix: '/api/v1/auth' });
    try {
      expect((await app.inject({ url: '/api/v1/auth/me' })).statusCode).toBe(401);
      const headers = { authorization: `Bearer ${await token()}` };
      const me = await app.inject({ url: '/api/v1/auth/me', headers });
      expect(me.statusCode).toBe(200); expect(me.json()).toMatchObject({ name: user.name, company: 'Цветы' });
      const patched = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers, payload: { name: user.name, phone: user.phone, company: 'Цветы' } });
      expect(patched.statusCode).toBe(200);
      const invalid = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers, payload: { customerType: 'individual' } });
      expect([400,422]).toContain(invalid.statusCode);
    } finally { await app.close(); }
  });
});
