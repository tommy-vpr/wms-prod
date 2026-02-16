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

export async function authRoutes(app: FastifyInstance) {
  // Stricter rate limit for auth endpoints
  const authRateLimit = {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "1 minute",
      },
    },
  };

  app.post("/signup", authRateLimit, async (request, reply) => {
    const body = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        password: z.string().min(8),
      })
      .parse(request.body);

    // Check if user exists
    const existing = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existing) {
      return reply.status(409).send({
        error: { code: "USER_EXISTS", message: "Email already registered" },
      });
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: await hashPassword(body.password),
      },
    });

    return reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  });

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
