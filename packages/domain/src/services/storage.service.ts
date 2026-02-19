/**
 * GCS Storage Service
 *
 * Save to: packages/domain/src/services/storage.service.ts
 */

import { Storage, Bucket } from "@google-cloud/storage";

export interface UploadResult {
  url: string;
  filename: string;
  size: number;
  contentType: string;
}

export class StorageService {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  constructor(bucketName: string, credentials: any) {
    this.storage = new Storage({
      credentials,
    });

    this.bucketName = bucketName;
    this.bucket = this.storage.bucket(bucketName);
  }

  /**
   * Upload a buffer to GCS
   */
  async uploadBuffer(
    buffer: Buffer,
    destination: string,
    contentType: string = "image/jpeg",
  ): Promise<UploadResult> {
    const blob = this.bucket.file(destination);

    await blob.save(buffer, {
      metadata: {
        contentType,
        cacheControl: "public, max-age=31536000",
      },
    });

    const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${destination}`;

    return {
      url: publicUrl,
      filename: destination,
      size: buffer.length,
      contentType,
    };
  }

  /**
   * Delete a file from GCS
   */
  async deleteFile(filename: string): Promise<boolean> {
    try {
      await this.bucket.file(filename).delete();
      return true;
    } catch (err) {
      console.error("[Storage] Delete failed:", err);
      return false;
    }
  }

  /**
   * Extract filename from public URL
   */
  extractFilename(url: string): string | null {
    const match = url.match(new RegExp(`${this.bucketName}/(.+)$`));
    return match ? match[1] : null;
  }
}

// Singleton instance
let storageInstance: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageInstance) {
    const base64 = process.env.GCS_SERVICE_ACCOUNT_BASE64;
    const bucketName = process.env.GCP_BUCKET_NAME;

    if (!base64 || !bucketName) {
      throw new Error("GCS storage not configured");
    }

    const credentials = JSON.parse(
      Buffer.from(base64, "base64").toString("utf-8"),
    );

    storageInstance = new StorageService(bucketName, credentials);
  }

  return storageInstance;
}
