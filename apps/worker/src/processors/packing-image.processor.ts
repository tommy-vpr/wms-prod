/**
 * Packing Images Processor
 * Handles async image processing jobs
 *
 * Save to: apps/worker/src/processors/packing-image.processor.ts
 */

import { Job } from "bullmq";
import { prisma } from "@wms/db";
import {
  PACKING_IMAGE_JOBS,
  type ProcessPackingImageJobData,
  type DeletePackingImageJobData,
  type GenerateThumbnailJobData,
  type CleanupOrphanedImagesJobData,
} from "@wms/queue";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// GCS Storage Helper
// ─────────────────────────────────────────────────────────────────────────────

async function getStorage() {
  const { Storage } = await import("@google-cloud/storage");

  const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: {
      client_email: process.env.GCP_CLIENT_EMAIL,
      private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
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

// ─────────────────────────────────────────────────────────────────────────────
// Main Processor
// ─────────────────────────────────────────────────────────────────────────────

export async function processPackingImageJob(job: Job): Promise<any> {
  const { name, data } = job;

  console.log(`[PackingImage] Processing ${name}`, { jobId: job.id });

  switch (name) {
    case PACKING_IMAGE_JOBS.PROCESS_IMAGE:
      return processImage(job, data as ProcessPackingImageJobData);

    case PACKING_IMAGE_JOBS.DELETE_IMAGE:
      return deleteImage(job, data as DeletePackingImageJobData);

    case PACKING_IMAGE_JOBS.GENERATE_THUMBNAIL:
      return generateThumbnail(job, data as GenerateThumbnailJobData);

    case PACKING_IMAGE_JOBS.CLEANUP_ORPHANED:
      return cleanupOrphanedImages(job, data as CleanupOrphanedImagesJobData);

    default:
      throw new Error(`Unknown job type: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Process Image
// ─────────────────────────────────────────────────────────────────────────────

async function processImage(
  job: Job,
  data: ProcessPackingImageJobData,
): Promise<{ imageId: string; url: string }> {
  const {
    orderId,
    taskId,
    buffer: base64Buffer,
    filename,
    userId,
    reference,
    notes,
  } = data;

  console.log(`[PackingImage] Processing image for order ${orderId}`);

  // Verify order exists
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, orderNumber: true },
  });

  if (!order) {
    throw new Error(`Order not found: ${orderId}`);
  }

  // Verify task if provided
  if (taskId) {
    const task = await prisma.workTask.findUnique({
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

  await job.updateProgress(10);

  // Decode base64 buffer
  const imageBuffer = Buffer.from(base64Buffer, "base64");

  // Optimize image
  const sharp = await getSharp();
  const optimizedBuffer = await sharp(imageBuffer)
    .rotate() // Auto-rotate based on EXIF
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  await job.updateProgress(40);

  // Generate destination path
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
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

  await job.updateProgress(70);

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

  await job.updateProgress(85);

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

  // Store event for replay
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

  await job.updateProgress(100);

  console.log(`[PackingImage] Image processed: ${packingImage.id}`);

  return {
    imageId: packingImage.id,
    url: publicUrl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Image
// ─────────────────────────────────────────────────────────────────────────────

async function deleteImage(
  job: Job,
  data: DeletePackingImageJobData,
): Promise<{ success: boolean }> {
  const { imageId, userId } = data;

  console.log(`[PackingImage] Deleting image ${imageId}`);

  const image = await prisma.packingImage.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    console.log(`[PackingImage] Image not found: ${imageId}`);
    return { success: false };
  }

  await job.updateProgress(20);

  // Delete from GCS
  try {
    const { bucket } = await getStorage();
    await bucket.file(image.filename).delete();
    console.log(`[PackingImage] Deleted from GCS: ${image.filename}`);
  } catch (err) {
    console.error(`[PackingImage] Failed to delete from GCS:`, err);
    // Continue anyway - DB record should still be deleted
  }

  await job.updateProgress(50);

  // Delete from database
  await prisma.packingImage.delete({
    where: { id: imageId },
  });

  await job.updateProgress(70);

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

  // Store event for replay
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

  await job.updateProgress(100);

  console.log(`[PackingImage] Image deleted: ${imageId}`);

  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generate Thumbnail
// ─────────────────────────────────────────────────────────────────────────────

async function generateThumbnail(
  job: Job,
  data: GenerateThumbnailJobData,
): Promise<{ thumbnails: string[] }> {
  const { imageId, sizes } = data;

  console.log(`[PackingImage] Generating thumbnails for ${imageId}`);

  const image = await prisma.packingImage.findUnique({
    where: { id: imageId },
  });

  if (!image) {
    throw new Error(`Image not found: ${imageId}`);
  }

  const { bucket, bucketName } = await getStorage();
  const sharp = await getSharp();

  // Download original
  const [originalBuffer] = await bucket.file(image.filename).download();

  await job.updateProgress(20);

  const thumbnails: string[] = [];
  const progressPerSize = 60 / sizes.length;

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];

    // Generate thumbnail
    const thumbnailBuffer = await sharp(originalBuffer)
      .resize(size.width, size.height, { fit: "cover" })
      .jpeg({ quality: 70 })
      .toBuffer();

    // Upload thumbnail
    const basePath = image.filename.replace(/\.jpg$/, "");
    const thumbnailPath = `${basePath}_${size.suffix}.jpg`;

    await bucket.file(thumbnailPath).save(thumbnailBuffer, {
      metadata: {
        contentType: "image/jpeg",
        cacheControl: "public, max-age=31536000",
      },
    });

    thumbnails.push(
      `https://storage.googleapis.com/${bucketName}/${thumbnailPath}`,
    );

    await job.updateProgress(20 + (i + 1) * progressPerSize);
  }

  await job.updateProgress(100);

  console.log(`[PackingImage] Generated ${thumbnails.length} thumbnails`);

  return { thumbnails };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup Orphaned Images (GCS files without DB records)
// ─────────────────────────────────────────────────────────────────────────────

async function cleanupOrphanedImages(
  job: Job,
  data: CleanupOrphanedImagesJobData,
): Promise<{ deleted: number }> {
  const { olderThanDays = 30 } = data;

  console.log(
    `[PackingImage] Cleaning up orphaned GCS files older than ${olderThanDays} days`,
  );

  const { bucket } = await getStorage();

  // List all files in packing/ prefix
  const [files] = await bucket.getFiles({ prefix: "packing/" });

  await job.updateProgress(10);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  let deletedCount = 0;
  const filesToCheck = files.filter((file) => {
    const created = file.metadata.timeCreated
      ? new Date(file.metadata.timeCreated)
      : new Date();
    return created < cutoffDate;
  });

  if (filesToCheck.length === 0) {
    console.log(`[PackingImage] No old GCS files found`);
    return { deleted: 0 };
  }

  const progressPerFile = 80 / filesToCheck.length;

  for (let i = 0; i < filesToCheck.length; i++) {
    const file = filesToCheck[i];

    try {
      // Check if DB record exists for this file
      const dbRecord = await prisma.packingImage.findFirst({
        where: { filename: file.name },
        select: { id: true },
      });

      // If no DB record, delete the GCS file (orphaned)
      if (!dbRecord) {
        await file.delete();
        deletedCount++;
        console.log(`[PackingImage] Deleted orphaned GCS file: ${file.name}`);
      }
    } catch (err) {
      console.error(
        `[PackingImage] Failed to check/delete file ${file.name}:`,
        err,
      );
    }

    await job.updateProgress(10 + (i + 1) * progressPerFile);
  }

  await job.updateProgress(100);

  console.log(`[PackingImage] Cleaned up ${deletedCount} orphaned GCS files`);

  return { deleted: deletedCount };
}
