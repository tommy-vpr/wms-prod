import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { Prisma } from "@wms/db";
import { JsonWebTokenError, TokenExpiredError } from "@wms/auth";

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  request.log.error(error);

  // Rate limit errors - check by code
  if (error.code === "RATE_LIMIT_EXCEEDED" || error.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: "RATE_LIMIT_EXCEEDED",
        message: error.message || "Too many requests. Try after 1 minute",
      },
    });
  }

  // Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: error.flatten().fieldErrors,
      },
    });
  }

  // JWT errors
  if (error instanceof TokenExpiredError) {
    return reply.status(401).send({
      error: {
        code: "TOKEN_EXPIRED",
        message: "Token has expired",
      },
    });
  }

  if (error instanceof JsonWebTokenError) {
    return reply.status(401).send({
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid token",
      },
    });
  }

  // Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const prismaError = error as Prisma.PrismaClientKnownRequestError;

    switch (prismaError.code) {
      case "P2002":
        return reply.status(409).send({
          error: {
            code: "CONFLICT",
            message: "A record with this value already exists",
            details: { field: prismaError.meta?.target },
          },
        });
      case "P2025":
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Record not found",
          },
        });
      default:
        return reply.status(400).send({
          error: {
            code: "DATABASE_ERROR",
            message: "Database operation failed",
          },
        });
    }
  }

  // Default error handling
  const statusCode = error.statusCode || 500;
  const message = statusCode === 500 ? "Internal server error" : error.message;

  return reply.status(statusCode).send({
    error: {
      code: error.code || "INTERNAL_ERROR",
      message,
    },
  });
}
