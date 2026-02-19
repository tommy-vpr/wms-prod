/**
 * Packing Image Routes
 *
 * Save to: apps/api/src/routes/packing-image.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import multipart from "@fastify/multipart";
import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// GCS Storage Helper
// ─────────────────────────────────────────────────────────────────────────────

async function getStorage() {
  const { Storage } = await import("@google-cloud/storage");

  const base64 = process.env.GCS_SERVICE_ACCOUNT_BASE64;
  if (!base64) {
    throw new Error("GCS_SERVICE_ACCOUNT_BASE64 not configured");
  }

  const credentials = JSON.parse(
    Buffer.from(base64, "base64").toString("utf-8"),
  );

  const bucketName = process.env.GCP_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("GCP_BUCKET_NAME not configured");
  }

  const storage = new Storage({ credentials });

  return {
    storage,
    bucket: storage.bucket(bucketName),
    bucketName,
  };
}

async function getSharp() {
  const sharp = (await import("sharp")).default;
  return sharp;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getUserId(request: FastifyRequest): string {
  return (request as any).user?.sub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

const packingImageRoutes: FastifyPluginAsync = async (app) => {
  // Register multipart support
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  });

  /**
   * POST /packing-images/upload
   * Upload packing image (synchronous - no queue)
   */
  app.post("/upload", async (request, reply) => {
    const userId = getUserId(request);

    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const data = await request.file();

    if (!data) {
      return reply.status(400).send({ error: "No file uploaded" });
    }

    if (!data.mimetype.startsWith("image/")) {
      return reply.status(400).send({ error: "File must be an image" });
    }

    // Get buffer from stream
    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Get form fields
    const fields = data.fields as Record<string, any>;
    const orderId = fields.orderId?.value as string;
    const taskId = fields.taskId?.value as string | undefined;
    const reference = fields.reference?.value as string | undefined;
    const notes = fields.notes?.value as string | undefined;

    if (!orderId) {
      return reply.status(400).send({ error: "orderId is required" });
    }

    try {
      // Verify order exists
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        select: { id: true, orderNumber: true },
      });

      if (!order) {
        return reply.status(404).send({ error: "Order not found" });
      }

      // Verify task if provided
      if (taskId) {
        const task = await prisma.workTask.findUnique({
          where: { id: taskId },
          select: { id: true, type: true },
        });

        if (!task) {
          return reply.status(404).send({ error: "Task not found" });
        }

        if (task.type !== "PACKING") {
          return reply
            .status(400)
            .send({ error: "Task is not a packing task" });
        }
      }

      // Optimize image
      const sharp = await getSharp();
      const optimizedBuffer = await sharp(buffer)
        .rotate()
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      // Generate destination path
      const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, "_");
      const destination = `packing/${orderId}/${Date.now()}-${sanitizedFilename}.jpg`;

      // Upload to GCS
      const { bucket, bucketName } = await getStorage();

      await bucket.file(destination).save(optimizedBuffer, {
        metadata: {
          contentType: "image/jpeg",
          cacheControl: "public, max-age=31536000",
        },
      });

      const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`;

      // Create database record
      const packingImage = await prisma.packingImage.create({
        data: {
          orderId,
          taskId,
          url: publicUrl,
          filename: destination,
          size: optimizedBuffer.length,
          contentType: "image/jpeg",
          uploadedBy: userId,
          reference: reference || order.orderNumber,
          notes,
        },
      });

      // Emit event
      await publish({
        id: randomUUID(),
        type: EVENT_TYPES.PACKING_IMAGE_UPLOADED,
        orderId,
        payload: {
          imageId: packingImage.id,
          taskId,
          url: publicUrl,
          filename: destination,
          uploadedBy: userId,
        },
        userId,
        timestamp: new Date().toISOString(),
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId,
          action: "PACKING_IMAGE_UPLOADED",
          entityType: "PackingImage",
          entityId: packingImage.id,
          changes: {
            orderId,
            taskId,
            filename: destination,
            size: optimizedBuffer.length,
          },
        },
      });

      // Fulfillment event for timeline
      await prisma.fulfillmentEvent.create({
        data: {
          orderId,
          type: EVENT_TYPES.PACKING_IMAGE_UPLOADED,
          payload: {
            imageId: packingImage.id,
            taskId,
            url: publicUrl,
            filename: destination,
          },
          userId,
        },
      });

      return reply.status(201).send({
        success: true,
        image: {
          id: packingImage.id,
          url: packingImage.url,
          filename: packingImage.filename,
          size: packingImage.size,
          createdAt: packingImage.createdAt,
        },
      });
    } catch (err) {
      console.error("[PackingImage] Upload error:", err);
      return reply.status(500).send({
        error: (err as Error).message || "Upload failed",
      });
    }
  });

  /**
   * GET /packing-images/order/:orderId
   * Get images for an order
   */
  app.get(
    "/order/:orderId",
    async (request: FastifyRequest<{ Params: { orderId: string } }>, reply) => {
      const { orderId } = request.params;

      const images = await prisma.packingImage.findMany({
        where: { orderId },
        include: {
          uploader: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ images });
    },
  );

  /**
   * GET /packing-images/task/:taskId
   * Get images for a task
   */
  app.get(
    "/task/:taskId",
    async (request: FastifyRequest<{ Params: { taskId: string } }>, reply) => {
      const { taskId } = request.params;

      const images = await prisma.packingImage.findMany({
        where: { taskId },
        include: {
          uploader: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      return reply.send({ images });
    },
  );

  /**
   * DELETE /packing-images/:imageId
   * Delete a packing image
   */
  app.delete(
    "/:imageId",
    async (request: FastifyRequest<{ Params: { imageId: string } }>, reply) => {
      const userId = getUserId(request);
      const { imageId } = request.params;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const image = await prisma.packingImage.findUnique({
          where: { id: imageId },
        });

        if (!image) {
          return reply.status(404).send({ error: "Image not found" });
        }

        // Delete from GCS
        try {
          const { bucket } = await getStorage();
          await bucket.file(image.filename).delete();
        } catch (gcsErr) {
          console.error("[PackingImage] GCS delete error:", gcsErr);
          // Continue - still delete DB record
        }

        // Delete from database
        await prisma.packingImage.delete({
          where: { id: imageId },
        });

        // Emit event
        await publish({
          id: randomUUID(),
          type: EVENT_TYPES.PACKING_IMAGE_DELETED,
          orderId: image.orderId,
          payload: {
            imageId,
            taskId: image.taskId,
            deletedBy: userId,
          },
          userId,
          timestamp: new Date().toISOString(),
        });

        // Audit log
        await prisma.auditLog.create({
          data: {
            userId,
            action: "PACKING_IMAGE_DELETED",
            entityType: "PackingImage",
            entityId: imageId,
            changes: {
              orderId: image.orderId,
              filename: image.filename,
            },
          },
        });

        // Fulfillment event for timeline
        await prisma.fulfillmentEvent.create({
          data: {
            orderId: image.orderId,
            type: EVENT_TYPES.PACKING_IMAGE_DELETED,
            payload: {
              imageId,
              taskId: image.taskId,
            },
            userId,
          },
        });

        return reply.send({ success: true });
      } catch (err) {
        console.error("[PackingImage] Delete error:", err);
        return reply.status(500).send({
          error: (err as Error).message || "Delete failed",
        });
      }
    },
  );
};

export default packingImageRoutes;
