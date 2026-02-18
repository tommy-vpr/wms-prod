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

export interface StorageConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  bucketName: string;
}

export class StorageService {
  private storage: Storage;
  private bucket: Bucket;
  private bucketName: string;

  constructor(config: StorageConfig) {
    this.storage = new Storage({
      projectId: config.projectId,
      credentials: {
        client_email: config.clientEmail,
        private_key: config.privateKey,
      },
    });

    this.bucketName = config.bucketName;
    this.bucket = this.storage.bucket(config.bucketName);
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
    const projectId = process.env.GCP_PROJECT_ID;
    const clientEmail = process.env.GCP_CLIENT_EMAIL;
    const privateKey = process.env.GCP_PRIVATE_KEY;
    const bucketName = process.env.GCP_BUCKET_NAME;

    if (!projectId || !clientEmail || !privateKey || !bucketName) {
      throw new Error("GCP storage credentials not configured");
    }

    storageInstance = new StorageService({
      projectId,
      clientEmail,
      privateKey,
      bucketName,
    });
  }

  return storageInstance;
}
