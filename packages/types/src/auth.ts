import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;

export const JWTPayloadSchema = z.object({
  sub: z.string(),
  email: z.string().email(),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF", "READONLY"]),
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type JWTPayload = z.infer<typeof JWTPayloadSchema>;

export const UserRole = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  MANAGER: "MANAGER",
  STAFF: "STAFF",
  READONLY: "READONLY",
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
