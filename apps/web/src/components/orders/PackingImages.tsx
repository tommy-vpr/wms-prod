import { useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export type PackingImage = {
  id: string;
  url: string;
  filename: string;
  notes?: string;
  uploadedAt: string;
  uploadedBy: {
    name: string;
  };
};

type Props = {
  images: PackingImage[];
};

export function PackingImages({ images }: Props) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  if (!images || images.length === 0) {
    return (
      <div className="rounded border border-dashed p-4 text-sm text-gray-500">
        No packing images uploaded
      </div>
    );
  }

  const selectedImage = selectedIndex !== null ? images[selectedIndex] : null;

  const goNext = () => {
    if (selectedIndex !== null && selectedIndex < images.length - 1) {
      setSelectedIndex(selectedIndex + 1);
    }
  };

  const goPrev = () => {
    if (selectedIndex !== null && selectedIndex > 0) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setSelectedIndex(null);
    if (e.key === "ArrowRight") goNext();
    if (e.key === "ArrowLeft") goPrev();
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">
        Packing Images ({images.length})
      </h3>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {images.map((img, index) => (
          <button
            key={img.id}
            onClick={() => setSelectedIndex(index)}
            className="group relative overflow-hidden rounded border bg-white text-left cursor-pointer"
          >
            <img
              src={img.url}
              alt={img.filename}
              className="h-40 w-full object-cover transition"
              loading="lazy"
            />

            <div className="absolute bottom-0 w-full bg-black/60 p-2 text-xs text-white opacity-0 transition group-hover:opacity-100">
              <div className="font-medium truncate capitalize">
                {img.uploadedBy.name}
              </div>
              <div className="text-gray-400">
                {new Date(img.uploadedAt).toLocaleString()}
              </div>
              {img.notes && <div className="italic truncate">{img.notes}</div>}
            </div>
          </button>
        ))}
      </div>

      {/* Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setSelectedIndex(null)}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="dialog"
          aria-modal="true"
        >
          {/* Close button */}
          <button
            onClick={() => setSelectedIndex(null)}
            className="cursor-pointer absolute top-4 right-4 p-2 text-white hover:text-white/30 transition"
            aria-label="Close"
          >
            <X className="w-6 h-6" />
          </button>

          {/* Previous button */}
          {selectedIndex !== null && selectedIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute left-4 p-2 text-white/80 hover:text-white transition"
              aria-label="Previous image"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
          )}

          {/* Next button */}
          {selectedIndex !== null && selectedIndex < images.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute right-4 p-2 text-white/80 hover:text-white transition"
              aria-label="Next image"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          )}

          {/* Image container */}
          <div
            className="relative max-w-5xl max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={selectedImage.url}
              alt={selectedImage.filename}
              className="max-h-[80vh] w-auto object-contain rounded-lg"
            />

            {/* Image info */}
            <div className="mt-3 text-center text-white">
              <div className="text-sm font-medium">
                <span className="text-blue-500 capitalize">Taken by:</span>{" "}
                <span className="capitalize">
                  {selectedImage.uploadedBy.name}
                </span>
              </div>
              <div className="text-xs text-white/70">
                {new Date(selectedImage.uploadedAt).toLocaleString()}
              </div>
              {selectedImage.notes && (
                <div className="text-sm text-white/80 mt-1 italic">
                  {selectedImage.notes}
                </div>
              )}
              <div className="text-xs text-white/50 mt-2">
                {selectedIndex! + 1} / {images.length}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
