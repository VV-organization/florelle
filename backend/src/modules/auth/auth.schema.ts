import { z } from 'zod';

/**
 * Request schemas
 */
const fullNameSchema = z.string().trim().min(1).max(300);
const phoneSchema = z.string().trim().min(7).max(30)
  .regex(/^[0-9+()\-\s]+$/, 'Phone may contain digits, +, -, parentheses and spaces');
const optionalPhoneSchema = z.union([phoneSchema, z.literal('')]).optional();
const registrationFields = {
  email: z.string().trim().email().toLowerCase().max(320),
  password: z.string().min(8).max(128),
  name: fullNameSchema.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  phone: optionalPhoneSchema,
};

export const registerLegalEntityBodySchema = z.object({
  ...registrationFields,
  customerType: z.literal('legal_entity'),
  company: z.string().trim().min(2).max(200).optional(),
  companyName: z.string().trim().min(2).max(200).optional(),
}).refine((input) => Boolean(input.company ?? input.companyName), {
  path: ['company'], message: 'Company is required',
});

export const registerIndividualBodySchema = z.object({
  ...registrationFields,
  customerType: z.literal('individual'),
}).refine((input) => Boolean(input.name || (input.firstName && input.lastName)), {
  path: ['name'], message: 'Full name is required',
});

export const registerBodySchema = z.union([
  registerLegalEntityBodySchema,
  registerIndividualBodySchema,
]);

export const updateProfileBodySchema = z.object({
  name: fullNameSchema.optional(),
  phone: optionalPhoneSchema,
  company: z.union([z.string().trim().min(2).max(200), z.literal('')]).optional(),
}).strict().refine((input) => Object.keys(input).length > 0, 'At least one profile field is required');
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

export const loginBodySchema = z.object({
  email: z.string().email().toLowerCase().max(320),
  password: z.string().min(1).max(128),
});

export const verifyRegistrationCodeBodySchema = z.object({
  challengeId: z.string().uuid(),
  email: z.string().email().toLowerCase().max(320),
  code: z.string().regex(/^\d{6}$/, 'Registration code must contain 6 digits'),
});

/**
 * Public-facing user shape (no password hash).
 */
export const publicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  customerType: z.enum(['individual', 'legal_entity']),
  name: z.string(),
  company: z.string(),
  companyName: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(['buyer', 'admin']),
  status: z.enum(['pending', 'active', 'suspended']),
  createdAt: z.string().datetime(),
});

/**
 * Success response for /auth/register and /auth/login.
 */
export const authSuccessResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string(),
});

export const registrationChallengeResponseSchema = z.object({
  challengeId: z.string().uuid(),
  email: z.string().email(),
  expiresAt: z.string().datetime(),
  resendAvailableAt: z.string().datetime(),
});

/**
 * Success response for /auth/refresh.
 */
export const refreshSuccessResponseSchema = z.object({
  accessToken: z.string(),
});

/**
 * Inferred TypeScript types.
 */
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type RegisterLegalEntityBody = z.infer<
  typeof registerLegalEntityBodySchema
>;
export type RegisterIndividualBody = z.infer<
  typeof registerIndividualBodySchema
>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type VerifyRegistrationCodeBody = z.infer<
  typeof verifyRegistrationCodeBodySchema
>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthSuccessResponse = z.infer<typeof authSuccessResponseSchema>;
export type RefreshSuccessResponse = z.infer<typeof refreshSuccessResponseSchema>;
export type RegistrationChallengeResponse = z.infer<
  typeof registrationChallengeResponseSchema
>;
