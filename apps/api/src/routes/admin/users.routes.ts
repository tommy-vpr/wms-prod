import type { FastifyInstance } from "fastify";
import { prisma } from "@wms/db";
import { hashPassword } from "@wms/auth";
import { z } from "zod";

const CreateUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]),
});

const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]).optional(),
  active: z.boolean().optional(),
});

export async function adminUserRoutes(app: FastifyInstance) {
  // List all users
  app.get("/", async (request, reply) => {
    const user = (request as any).user;

    // Only SUPER_ADMIN and ADMIN can list users
    if (!["SUPER_ADMIN", "ADMIN"].includes(user.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return { users };
  });

  // Create user
  app.post("/", async (request, reply) => {
    const currentUser = (request as any).user;

    // Only SUPER_ADMIN and ADMIN can create users
    if (!["SUPER_ADMIN", "ADMIN"].includes(currentUser.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = CreateUserSchema.parse(request.body);

    // Prevent non-SUPER_ADMIN from creating ADMINs
    if (body.role === "ADMIN" && currentUser.role !== "SUPER_ADMIN") {
      return reply
        .status(403)
        .send({ error: "Only SUPER_ADMIN can create ADMIN users" });
    }

    const existing = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existing) {
      return reply.status(409).send({ error: "Email already exists" });
    }

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password: await hashPassword(body.password),
        role: body.role,
        active: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return reply.status(201).send({ user });
  });

  // Update user
  app.patch("/:id", async (request, reply) => {
    const currentUser = (request as any).user;
    const { id } = request.params as { id: string };

    if (!["SUPER_ADMIN", "ADMIN"].includes(currentUser.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const body = UpdateUserSchema.parse(request.body);

    // Prevent changing to ADMIN unless SUPER_ADMIN
    if (body.role === "ADMIN" && currentUser.role !== "SUPER_ADMIN") {
      return reply
        .status(403)
        .send({ error: "Only SUPER_ADMIN can assign ADMIN role" });
    }

    const updateData: any = { ...body };
    if (body.password) {
      updateData.password = await hashPassword(body.password);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });

    return { user };
  });

  // Deactivate user (soft delete)
  app.delete("/:id", async (request, reply) => {
    const currentUser = (request as any).user;
    const { id } = request.params as { id: string };

    if (!["SUPER_ADMIN", "ADMIN"].includes(currentUser.role)) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Prevent deleting yourself
    if (id === currentUser.id) {
      return reply.status(400).send({ error: "Cannot deactivate yourself" });
    }

    await prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return { success: true };
  });
}
