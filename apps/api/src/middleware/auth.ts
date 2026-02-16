import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken, type JWTPayload } from "@wms/auth";

declare module "fastify" {
  interface FastifyRequest {
    user: JWTPayload;
  }
}

// middleware/auth.ts

// export async function authenticate(
//   request: FastifyRequest,
//   reply: FastifyReply,
// ) {
//   const authHeader = request.headers.authorization;

//   if (!authHeader?.startsWith("Bearer ")) {
//     return reply.status(401).send({
//       error: { code: "UNAUTHORIZED", message: "Missing authorization header" },
//     });
//   }

//   const token = authHeader.substring(7);

//   try {
//     const payload = verifyAccessToken(token);
//     request.user = payload;
//   } catch {
//     return reply.status(401).send({
//       error: { code: "UNAUTHORIZED", message: "Invalid or expired token" },
//     });
//   }
// }

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return reply.status(401).send({
      error: { code: "UNAUTHORIZED", message: "Missing authorization header" },
    });
  }

  const token = authHeader.substring(7);

  try {
    const payload = verifyAccessToken(token);
    request.user = payload;
  } catch (err) {
    // Return 401 so frontend knows to refresh
    return reply.status(401).send({
      error: { code: "TOKEN_EXPIRED", message: "Invalid or expired token" },
    });
  }
}

export function requireRole(allowedRoles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({
        error: { code: "UNAUTHORIZED", message: "Not authenticated" },
      });
    }

    if (!allowedRoles.includes(request.user.role)) {
      return reply.status(403).send({
        error: { code: "FORBIDDEN", message: "Insufficient permissions" },
      });
    }
  };
}
