import jwt from "jsonwebtoken";

// Get error classes from default import
export const JsonWebTokenError = jwt.JsonWebTokenError;
export const TokenExpiredError = jwt.TokenExpiredError;

export interface TokenUser {
  id: string;
  email: string;
  role: string;
}

export interface JWTPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

function getSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return secret;
}

export function signAccessToken(user: TokenUser): string {
  const payload: JWTPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, getSecret(), {
    expiresIn: 900,
  });
}

export function signRefreshToken(user: TokenUser): string {
  return jwt.sign({ sub: user.id }, getSecret(), {
    expiresIn: 604800,
  });
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, getSecret()) as JWTPayload;
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, getSecret()) as { sub: string };
}
