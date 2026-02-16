/**
 * Location Import Card
 * Upload CSV to import locations and assign products
 *
 * Save to: apps/web/src/components/inventory/LocationImportCard.tsx
 */

import { useState, useCallback } from "react";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  Loader2,
  MapPin,
  Download,
} from "lucide-react";
import { apiClient } from "@/lib/api";

interface ImportResult {
  success: boolean;
  locationsCreated: number;
  locationsExisted: number;
  inventoryCreated: number;
  inventoryExisted: number;
  skipped: number;
  errors: string[];
  totalRows: number;
}

export function LocationImportCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");

  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    setResult(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csv = e.target?.result as string;

        const data = await apiClient.post<ImportResult>("/locations/import", {
          csv,
        });

        setResult(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }, []);

  const downloadTemplate = () => {
    window.open("/api/locations/import/template", "_blank");
  };

  return (
    <div className="bg-white border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            Location Import
          </h3>
          <p className="text-sm text-gray-500">
            Import SKU → Location mappings from CSV
          </p>
        </div>
        <button
          onClick={downloadTemplate}
          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
        >
          <Download className="w-4 h-4" />
          Template
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className={`mb-4 p-4 rounded-lg border border-border ${
            result.success
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle
              className={`w-5 h-5 ${
                result.success ? "text-green-600" : "text-yellow-600"
              }`}
            />
            <span className="font-medium">Import Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Locations Created:</span>{" "}
              <span className="font-medium text-green-600">
                {result.locationsCreated}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Locations Existed:</span>{" "}
              <span className="font-medium">{result.locationsExisted}</span>
            </div>
            <div>
              <span className="text-gray-500">Inventory Created:</span>{" "}
              <span className="font-medium text-green-600">
                {result.inventoryCreated}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Inventory Existed:</span>{" "}
              <span className="font-medium">{result.inventoryExisted}</span>
            </div>
            <div>
              <span className="text-gray-500">Skipped (no SKU):</span>{" "}
              <span className="font-medium text-yellow-600">
                {result.skipped}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Total Rows:</span>{" "}
              <span className="font-medium">{result.totalRows}</span>
            </div>
          </div>
          {result.errors.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-sm text-red-600 font-medium mb-1">
                Errors ({result.errors.length}):
              </div>
              <ul className="text-xs text-red-600 space-y-1 max-h-24 overflow-y-auto">
                {result.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
                {result.errors.length > 10 && (
                  <li className="text-gray-500">
                    +{result.errors.length - 10} more...
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          loading
            ? "border-gray-200 bg-gray-50"
            : "border-gray-300 hover:border-blue-400"
        }`}
        onDrop={(e) => {
          e.preventDefault();
          if (!loading && e.dataTransfer.files[0]) {
            handleUpload(e.dataTransfer.files[0]);
          }
        }}
        onDragOver={(e) => e.preventDefault()}
      >
        {loading ? (
          <div className="flex flex-col items-center">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
            <span className="text-gray-600">Importing...</span>
          </div>
        ) : (
          <>
            <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 mb-2">
              Drop CSV file here or click to upload
            </p>
            <p className="text-xs text-gray-400 mb-3">
              Required: SKU, LOCATION • Optional: AISLE, BAY, TIER, BIN
            </p>
            <label className="inline-block px-4 py-2 bg-blue-600 text-white text-sm rounded-lg cursor-pointer hover:bg-blue-700">
              Choose File
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) =>
                  e.target.files?.[0] && handleUpload(e.target.files[0])
                }
              />
            </label>
          </>
        )}
      </div>

      {/* Info */}
      <div className="mt-4 text-xs text-gray-500">
        <p>
          <strong>Workflow:</strong> Import locations first, then run IP Sync to
          update quantities.
        </p>
      </div>
    </div>
  );
}
