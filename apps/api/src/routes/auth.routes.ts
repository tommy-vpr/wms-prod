import type { FastifyInstance } from "fastify";
import { prisma } from "@wms/db";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyPassword,
  hashPassword,
} from "@wms/auth";
import { LoginSchema, RefreshTokenSchema } from "@wms/types";
import crypto from "crypto";
import { z } from "zod";
import { sendPasswordResetEmail } from "../services/email.service.js";

export async function authRoutes(app: FastifyInstance) {
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  // Login
  // ─────────────────────────────────────────────────────────────────────
  app.post("/login", authRateLimit, async (request, reply) => {
    const body = LoginSchema.parse(request.body);

    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user || !user.password) {
      return reply.status(401).send({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    const validPassword = await verifyPassword(body.password, user.password);
    if (!validPassword) {
      return reply.status(401).send({
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        },
      });
    }

    if (!user.active) {
      return reply.status(403).send({
        error: { code: "ACCOUNT_DISABLED", message: "Account is disabled" },
      });
    }

    const accessToken = signAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = signRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await prisma.refreshToken.create({
      data: {
        token: crypto.createHash("sha256").update(refreshToken).digest("hex"),
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Forgot Password
  // ─────────────────────────────────────────────────────────────────────
  app.post("/forgot-password", authRateLimit, async (request, reply) => {
    const body = z.object({ email: z.string().email() }).parse(request.body);

    // Always return success to prevent email enumeration
    const successResponse = {
      message:
        "If an account exists with this email, you will receive a password reset link.",
    };

    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user || !user.active) {
      return successResponse;
    }

    // Invalidate any existing reset tokens
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null,
      },
      data: {
        usedAt: new Date(),
      },
    });

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Store token (expires in 1 hour)
    await prisma.passwordResetToken.create({
      data: {
        token: hashedToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    });

    // Send email (don't await to prevent timing attacks)
    sendPasswordResetEmail(user.email, token, user.name).catch((err) => {
      console.error("Failed to send reset email:", err);
    });

    return successResponse;
  });

  // ─────────────────────────────────────────────────────────────────────
  // Reset Password
  // ─────────────────────────────────────────────────────────────────────
  app.post("/reset-password", authRateLimit, async (request, reply) => {
    const body = z
      .object({
        token: z.string().min(1),
        password: z.string().min(8),
      })
      .parse(request.body);

    const hashedToken = crypto
      .createHash("sha256")
      .update(body.token)
      .digest("hex");

    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashedToken },
      include: { user: true },
    });

    if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      return reply.status(400).send({
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid or expired reset token",
        },
      });
    }

    // Update password
    await prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        password: await hashPassword(body.password),
      },
    });

    // Mark token as used
    await prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    });

    // Revoke all refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: { userId: resetToken.userId },
      data: { revokedAt: new Date() },
    });

    return { message: "Password reset successfully" };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Refresh Token
  // ─────────────────────────────────────────────────────────────────────
  app.post("/refresh", async (request, reply) => {
    const body = RefreshTokenSchema.parse(request.body);

    try {
      const payload = verifyRefreshToken(body.refreshToken);
      const tokenHash = crypto
        .createHash("sha256")
        .update(body.refreshToken)
        .digest("hex");

      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: tokenHash },
        include: { user: true },
      });

      if (
        !storedToken ||
        storedToken.revokedAt ||
        storedToken.expiresAt < new Date()
      ) {
        return reply.status(401).send({
          error: {
            code: "INVALID_TOKEN",
            message: "Invalid or expired refresh token",
          },
        });
      }

      const user = storedToken.user;

      await prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });

      const accessToken = signAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      const newRefreshToken = signRefreshToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      await prisma.refreshToken.create({
        data: {
          token: crypto
            .createHash("sha256")
            .update(newRefreshToken)
            .digest("hex"),
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      return { accessToken, refreshToken: newRefreshToken };
    } catch {
      return reply.status(401).send({
        error: { code: "INVALID_TOKEN", message: "Invalid refresh token" },
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────
  // Logout
  // ─────────────────────────────────────────────────────────────────────
  app.post("/logout", async (request, reply) => {
    const body = RefreshTokenSchema.parse(request.body);
    const tokenHash = crypto
      .createHash("sha256")
      .update(body.refreshToken)
      .digest("hex");

    await prisma.refreshToken.updateMany({
      where: { token: tokenHash },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  });
}
