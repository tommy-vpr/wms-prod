/**
 * Packing Image Service
 *
 * Save to: packages/domain/src/services/packing-image.service.ts
 */

import { PrismaClient } from "@wms/db";
import { getStorageService, type UploadResult } from "./storage.service.js";
import sharp from "sharp";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PackingImage {
  id: string;
  orderId: string;
  taskId: string | null;
  url: string;
  filename: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface UploadPackingImageInput {
  orderId: string;
  taskId?: string;
  buffer: Buffer;
  originalFilename: string;
  userId: string;
  reference?: string;
  notes?: string;
}

export interface PackingImageWithUploader extends PackingImage {
  uploader: {
    id: string;
    name: string | null;
    email: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────────────────────

export const PACKING_IMAGE_EVENTS = {
  IMAGE_UPLOADED: "packing.image.uploaded",
  IMAGE_DELETED: "packing.image.deleted",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class PackingImageService {
  constructor(
    private prisma: PrismaClient,
    private emitEvent?: (event: string, payload: any) => Promise<void>,
  ) {}

  /**
   * Upload and optimize image for packing
   */
  async uploadImage(input: UploadPackingImageInput): Promise<PackingImage> {
    const {
      orderId,
      taskId,
      buffer,
      originalFilename,
      userId,
      reference,
      notes,
    } = input;

    // Verify order exists
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true },
    });

    if (!order) {
      throw new Error(`Order not found: ${orderId}`);
    }

    // Verify task if provided
    if (taskId) {
      const task = await this.prisma.workTask.findUnique({
        where: { id: taskId },
        select: { id: true, type: true },
      });

      if (!task) {
        throw new Error(`Task not found: ${taskId}`);
      }

      if (task.type !== "PACKING") {
        throw new Error(`Task is not a packing task: ${taskId}`);
      }
    }

    // Optimize image
    const optimizedBuffer = await this.optimizeImage(buffer);

    // Generate destination path
    const sanitizedFilename = originalFilename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const destination = `packing/${orderId}/${Date.now()}-${sanitizedFilename}.jpg`;

    // Upload to GCS
    const storage = getStorageService();
    const uploadResult = await storage.uploadBuffer(
      optimizedBuffer,
      destination,
      "image/jpeg",
    );

    // Create database record
    const packingImage = await this.prisma.packingImage.create({
      data: {
        orderId,
        taskId,
        url: uploadResult.url,
        filename: uploadResult.filename,
        size: uploadResult.size,
        contentType: uploadResult.contentType,
        uploadedBy: userId,
        reference: reference || order.orderNumber,
        notes,
      },
    });

    // Emit event
    await this.emitEvent?.(PACKING_IMAGE_EVENTS.IMAGE_UPLOADED, {
      imageId: packingImage.id,
      orderId,
      taskId,
      url: uploadResult.url,
      uploadedBy: userId,
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "PACKING_IMAGE_UPLOADED",
        entityType: "PackingImage",
        entityId: packingImage.id,
        changes: {
          orderId,
          taskId,
          filename: uploadResult.filename,
          size: uploadResult.size,
        },
      },
    });

    return packingImage;
  }

  /**
   * Delete packing image
   */
  async deleteImage(imageId: string, userId: string): Promise<void> {
    const image = await this.prisma.packingImage.findUnique({
      where: { id: imageId },
    });

    if (!image) {
      throw new Error(`Image not found: ${imageId}`);
    }

    // Delete from GCS
    const storage = getStorageService();
    const filename = storage.extractFilename(image.url);
    if (filename) {
      await storage.deleteFile(filename);
    }

    // Delete from database
    await this.prisma.packingImage.delete({
      where: { id: imageId },
    });

    // Emit event
    await this.emitEvent?.(PACKING_IMAGE_EVENTS.IMAGE_DELETED, {
      imageId,
      orderId: image.orderId,
      taskId: image.taskId,
      deletedBy: userId,
    });

    // Audit log
    await this.prisma.auditLog.create({
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
  }

  /**
   * Get images for an order
   */
  async getByOrder(orderId: string): Promise<PackingImageWithUploader[]> {
    return this.prisma.packingImage.findMany({
      where: { orderId },
      include: {
        uploader: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get images for a task
   */
  async getByTask(taskId: string): Promise<PackingImageWithUploader[]> {
    return this.prisma.packingImage.findMany({
      where: { taskId },
      include: {
        uploader: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Optimize image with sharp
   */
  private async optimizeImage(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .rotate() // Auto-rotate based on EXIF
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  }
}
