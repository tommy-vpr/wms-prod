/**
 * Invoice Routes
 *
 * Save to: apps/api/src/routes/invoice.routes.ts
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import { InvoiceService, generateSkuFromParts } from "@wms/domain";
import { prisma } from "@wms/db";
import multipart from "@fastify/multipart";

// ─────────────────────────────────────────────────────────────────────────────
// GCS helpers (same pattern as packing-images)
// ─────────────────────────────────────────────────────────────────────────────

async function getStorage() {
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY,
    },
  });
  return {
    storage,
    bucket: storage.bucket(process.env.GCP_BUCKET_NAME!),
    bucketName: process.env.GCP_BUCKET_NAME!,
  };
}

async function getSharp() {
  const sharp = (await import("sharp")).default;
  return sharp;
}

function getUserId(request: FastifyRequest): string {
  return (request as any).user?.sub;
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

export const invoiceRoutes: FastifyPluginAsync = async (app) => {
  const service = new InvoiceService(prisma);

  // Register multipart for image uploads
  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /invoices — List invoices
  // ─────────────────────────────────────────────────────────────────────────

  app.get(
    "/",
    async (
      request: FastifyRequest<{
        Querystring: {
          status?: string;
          vendor?: string;
          search?: string;
          limit?: string;
          offset?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { status, vendor, search, limit, offset } = request.query;
      const userId = getUserId(request);

      try {
        const result = await service.list({
          status: status ? status.split(",") : undefined,
          vendor,
          search,
          limit: limit ? parseInt(limit, 10) : undefined,
          offset: offset ? parseInt(offset, 10) : undefined,
          userId,
        });
        return reply.send(result);
      } catch (err: any) {
        console.error("[Invoice] List error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/generate-sku — Generate SKU from brand + name + year
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/generate-sku",
    async (
      request: FastifyRequest<{
        Body: { brand: string; productName: string; year?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const { brand, productName, year } = request.body;

      if (!brand?.trim() || !productName?.trim()) {
        return reply
          .status(400)
          .send({ error: "brand and productName are required" });
      }

      const sku = generateSkuFromParts(brand.trim(), productName.trim(), year);
      return reply.send({ sku });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /invoices/:id — Get invoice detail
  // ─────────────────────────────────────────────────────────────────────────

  app.get(
    "/:id",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const invoice = await service.getById(request.params.id);
        if (!invoice) {
          return reply.status(404).send({ error: "Invoice not found" });
        }
        return reply.send(invoice);
      } catch (err: any) {
        console.error("[Invoice] Get error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices — Create invoice
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/",
    async (
      request: FastifyRequest<{
        Body: {
          vendor: string;
          notes?: string;
          tax?: number;
          fees?: number;
          items: Array<{
            sku?: string;
            productName: string;
            quantity: number;
            unitCost?: number;
            locationId?: string;
            productVariantId?: string;
            lotNumber?: string;
            expiryDate?: string;
          }>;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { vendor, notes, tax, fees, items } = request.body;

      if (!vendor?.trim()) {
        return reply.status(400).send({ error: "vendor is required" });
      }
      if (!items?.length) {
        return reply
          .status(400)
          .send({ error: "At least one item is required" });
      }

      try {
        const invoice = await service.create({
          vendor: vendor.trim(),
          notes,
          tax,
          fees,
          items,
          userId,
        });
        return reply.status(201).send(invoice);
      } catch (err: any) {
        console.error("[Invoice] Create error:", err);
        return reply.status(500).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /invoices/:id — Update invoice header
  // ─────────────────────────────────────────────────────────────────────────

  app.patch(
    "/:id",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: { vendor?: string; notes?: string; tax?: number; fees?: number };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const updated = await service.update(request.params.id, {
          ...request.body,
          userId,
        });
        return reply.send(updated);
      } catch (err: any) {
        console.error("[Invoice] Update error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/:id/upload — Upload vendor invoice image
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:id/upload",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
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

      try {
        // Read buffer
        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);

        // Optimize
        const sharp = await getSharp();
        const optimizedBuffer = await sharp(buffer)
          .rotate()
          .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        // Upload to GCS
        const sanitizedFilename = data.filename.replace(/[^a-zA-Z0-9.-]/g, "_");
        const destination = `invoices/${request.params.id}/${Date.now()}-${sanitizedFilename}.jpg`;

        const { bucket, bucketName } = await getStorage();
        await bucket.file(destination).save(optimizedBuffer, {
          metadata: {
            contentType: "image/jpeg",
            cacheControl: "public, max-age=31536000",
          },
        });

        const publicUrl = `https://storage.googleapis.com/${bucketName}/${destination}`;

        // Update invoice
        const updated = await service.uploadImage(
          request.params.id,
          publicUrl,
          destination,
          userId,
        );

        return reply.send({
          success: true,
          imageUrl: publicUrl,
          filename: destination,
        });
      } catch (err: any) {
        console.error("[Invoice] Upload error:", err);
        const status = err.message.includes("not found") ? 404 : 500;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/:id/items — Add item
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:id/items",
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          sku?: string;
          productName: string;
          quantity: number;
          unitCost?: number;
          locationId?: string;
          productVariantId?: string;
          lotNumber?: string;
          expiryDate?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { productName, quantity } = request.body;
      if (!productName?.trim()) {
        return reply.status(400).send({ error: "productName is required" });
      }
      if (!quantity || quantity < 1) {
        return reply.status(400).send({ error: "quantity must be >= 1" });
      }

      try {
        const item = await service.addItem(
          request.params.id,
          request.body,
          userId,
        );
        return reply.status(201).send(item);
      } catch (err: any) {
        console.error("[Invoice] Add item error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // PATCH /invoices/:id/items/:itemId — Update item
  // ─────────────────────────────────────────────────────────────────────────

  app.patch(
    "/:id/items/:itemId",
    async (
      request: FastifyRequest<{
        Params: { id: string; itemId: string };
        Body: {
          sku?: string;
          productName?: string;
          quantity?: number;
          unitCost?: number;
          locationId?: string | null;
          productVariantId?: string | null;
          lotNumber?: string | null;
          expiryDate?: string | null;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const item = await service.updateItem(
          request.params.id,
          request.params.itemId,
          request.body,
          userId,
        );
        return reply.send(item);
      } catch (err: any) {
        console.error("[Invoice] Update item error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /invoices/:id/items/:itemId — Remove item
  // ─────────────────────────────────────────────────────────────────────────

  app.delete(
    "/:id/items/:itemId",
    async (
      request: FastifyRequest<{
        Params: { id: string; itemId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.removeItem(
          request.params.id,
          request.params.itemId,
          userId,
        );
        return reply.send(result);
      } catch (err: any) {
        console.error("[Invoice] Remove item error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/:id/submit — Submit for approval
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:id/submit",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.submit(request.params.id, userId);
        return reply.send({ success: true, status: result.status });
      } catch (err: any) {
        console.error("[Invoice] Submit error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/:id/approve — Approve
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:id/approve",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.approve(request.params.id, userId);
        return reply.send({ success: true, status: result.status });
      } catch (err: any) {
        console.error("[Invoice] Approve error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /invoices/:id/reject — Reject
  // ─────────────────────────────────────────────────────────────────────────

  app.post(
    "/:id/reject",
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const userId = getUserId(request);
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await service.reject(request.params.id, userId);
        return reply.send({ success: true, status: result.status });
      } catch (err: any) {
        console.error("[Invoice] Reject error:", err);
        const status = err.message.includes("not found") ? 404 : 400;
        return reply.status(status).send({ error: err.message });
      }
    },
  );
};
