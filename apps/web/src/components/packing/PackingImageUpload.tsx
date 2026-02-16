/**
 * Packing Image Upload Component
 *
 * Save to: apps/web/src/components/packing/PackingImageUpload.tsx
 */

import { useState, useRef } from "react";
import {
  Upload,
  X,
  Loader2,
  Camera,
  Image as ImageIcon,
  Trash2,
  CheckCircle,
  Check,
} from "lucide-react";
import { cn } from "../../lib/utils";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export interface PackingImage {
  id: string;
  url: string;
  filename: string;
  size: number;
  createdAt: string;
  uploadedBy?: {
    id: string;
    name: string | null;
    email: string;
  };
}

interface PackingImageUploadProps {
  orderId: string;
  taskId?: string;
  pickBinId?: string;
  orderNumber: string;
  images: PackingImage[];
  onUploadSuccess: (image: PackingImage) => void;
  onDeleteSuccess: (imageId: string) => void;
  required?: boolean;
  maxImages?: number;
  disabled?: boolean;
  readOnly?: boolean;
}

export function PackingImageUpload({
  orderId,
  taskId,
  pickBinId,
  orderNumber,
  images,
  onUploadSuccess,
  onDeleteSuccess,
  required = false,
  maxImages = 5,
  disabled = false,
  readOnly = false,
}: PackingImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReadOnly = readOnly || disabled;
  const canUpload = !isReadOnly && images.length < maxImages;

  const getAccessToken = (): string | null => {
    try {
      const stored = localStorage.getItem("wms_tokens");
      if (stored) {
        return JSON.parse(stored).accessToken;
      }
    } catch {}
    return null;
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please upload an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }

    setUploading(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("orderId", orderId);
    if (taskId) formData.append("taskId", taskId);
    formData.append("reference", orderNumber);

    try {
      const token = getAccessToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/packing-images/upload`, {
        method: "POST",
        headers,
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Upload failed");
      }

      onUploadSuccess(data.image);

      // Haptic feedback
      if (navigator.vibrate) navigator.vibrate(100);
    } catch (err: any) {
      console.error("Upload error:", err);
      setError(err.message || "Upload failed");
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (imageId: string) => {
    if (!confirm("Delete this image?")) return;

    setDeletingId(imageId);

    try {
      const token = getAccessToken();
      const headers: HeadersInit = {};
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const res = await fetch(`${API_BASE}/packing-images/${imageId}`, {
        method: "DELETE",
        headers,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }

      onDeleteSuccess(imageId);
    } catch (err: any) {
      console.error("Delete error:", err);
      setError(err.message || "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (disabled) return;
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-purple-500" />
          <span className="text-sm font-semibold text-gray-700">
            Packing Photos
            {required && <span className="text-red-500 ml-1">*</span>}
          </span>
        </div>
        <span className="text-xs text-gray-400">
          {images.length}/{maxImages}
        </span>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-2 flex items-center justify-between">
          <p className="text-xs text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="p-0.5">
            <X className="w-3 h-3 text-red-600" />
          </button>
        </div>
      )}

      {/* Existing Images */}
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group"
            >
              <img
                src={image.url}
                alt={image.filename}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() => setPreviewImage(image.url)}
              />
              {!isReadOnly && (
                <button
                  onClick={() => handleDelete(image.id)}
                  disabled={deletingId === image.id}
                  className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded-full 
                    opacity-0 group-hover:opacity-100 transition-opacity
                    hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingId === image.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3 h-3" />
                  )}
                </button>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/50 to-transparent p-1">
                <Check className="w-4 h-4 text-green-400" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Area */}
      {canUpload && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={cn(
            "relative border-2 border-dashed rounded-lg p-4 text-center transition-colors",
            dragActive
              ? "border-purple-500 bg-purple-50"
              : "border-gray-300 hover:border-purple-400 hover:bg-gray-50",
            uploading && "opacity-50 pointer-events-none",
            disabled && "opacity-50 cursor-not-allowed",
            !disabled && "cursor-pointer",
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            disabled={uploading || disabled}
            className="hidden"
          />

          {uploading ? (
            <div className="flex flex-col items-center gap-1">
              <Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
              <p className="text-xs text-gray-500">Uploading...</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                <Upload className="w-5 h-5 text-purple-600" />
              </div>
              <p className="text-xs font-medium text-gray-600">
                Take photo or upload
              </p>
              <p className="text-[10px] text-gray-400">JPG, PNG up to 10MB</p>
            </div>
          )}
        </div>
      )}

      {/* Required warning */}
      {required && images.length === 0 && !isReadOnly && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <ImageIcon className="w-3 h-3" />
          At least one photo required
        </p>
      )}

      {/* Image Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <button
            className="cursor-pointer absolute top-4 right-4 text-white hover:bg-text-white/30"
            onClick={() => setPreviewImage(null)}
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={previewImage}
            alt="Preview"
            className="max-w-full max-h-full object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
