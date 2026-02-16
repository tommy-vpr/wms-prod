/**
 * Product Import Card
 * Upload CSV to import products - parses server-side, queues job, polls progress
 *
 * Save to: apps/web/src/components/products/ProductImportCard.tsx
 */

import { useState, useCallback, useEffect, useRef } from "react";
import {
  Upload,
  AlertCircle,
  CheckCircle,
  Loader2,
  Package,
  Download,
} from "lucide-react";
import { apiClient } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

interface CsvImportResponse {
  success: boolean;
  jobId: string;
  totalRows: number;
  productsQueued: number;
  parseErrors: string[];
  skipped: number;
  message: string;
  statusUrl: string;
}

interface JobStatus {
  jobId: string;
  name: string;
  state: string;
  progress: number;
  data: {
    productCount: number;
  };
  result?: {
    success: number;
    failed: number;
    errors: Array<{ sku: string; error: string }>;
  };
  failedReason?: string;
  createdAt: number;
  processedAt: number | null;
  finishedAt: number | null;
}

// ============================================================================
// CSV Parsing (client-side — minimal, just splits rows for the API)
// ============================================================================

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

  return lines.slice(1).map((line) => {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i]?.replace(/"/g, "") || "";
    });
    return row;
  });
}

// ============================================================================
// Component
// ============================================================================

export function ProductImportCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ==========================================================================
  // Upload Handler — parse CSV, send rows to API, get jobId back
  // ==========================================================================

  const handleUpload = useCallback(async (file: File) => {
    setLoading(true);
    setError("");
    setParseErrors([]);
    setJobStatus(null);
    setJobId(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);

        if (rows.length === 0) {
          throw new Error("CSV file is empty or has no data rows");
        }

        const headers = Object.keys(rows[0]).map((h) => h.toUpperCase());
        if (!headers.includes("SKU")) {
          throw new Error("CSV must have a SKU column");
        }

        // Send rows to server — server parses weight/dimensions and enqueues job
        const data = await apiClient.post<CsvImportResponse>(
          "/products/import/csv",
          {
            rows,
            mode: "grouped",
          },
        );

        // Store any parse warnings
        if (data.parseErrors?.length > 0) {
          setParseErrors(data.parseErrors);
        }

        // Start polling the job
        setJobId(data.jobId);
      } catch (err: any) {
        const message =
          err?.response?.data?.error || err.message || "Import failed";
        setError(message);

        // Show parse errors from server validation
        if (err?.response?.data?.parseErrors) {
          setParseErrors(err.response.data.parseErrors);
        }
        if (err?.response?.data?.details) {
          setParseErrors((prev) => [...prev, ...err.response.data.details]);
        }

        setLoading(false);
      }
    };
    reader.readAsText(file);
  }, []);

  // ==========================================================================
  // Job Status Polling
  // ==========================================================================

  useEffect(() => {
    if (!jobId) return;

    const pollStatus = async () => {
      try {
        const data = await apiClient.get<JobStatus>(
          `/products/import/job/${jobId}`,
        );
        setJobStatus(data);

        if (data.state === "completed" || data.state === "failed") {
          setLoading(false);
          setJobId(null);
        }
      } catch (err) {
        console.error("Failed to fetch job status:", err);
      }
    };

    // Poll immediately, then every 2s
    pollStatus();
    pollRef.current = setInterval(pollStatus, 2000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [jobId]);

  // ==========================================================================
  // Template Download
  // ==========================================================================

  const downloadTemplate = () => {
    const template = [
      "PRODUCT,UPC,SKU,NAME,CATEGORY,VOLUME,STRENGTH,MC WEIGHT,MC QTY,MC DIMENSION,SINGLE DIMENSION,SINGLE WEIGHT",
      'Banana-Skwezed ICE-100ml-00mg,658632910879,SKWBAI100-00,Banana,Skwezed ICE,100ml,00mg,35 lbs,100,"17 in x 17 in x 5 in","1.6 in x 4.7 in x 1.6 in",5.59oz',
    ].join("\n");

    const blob = new Blob([template], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "product-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ==========================================================================
  // Reset
  // ==========================================================================

  const reset = () => {
    setLoading(false);
    setError("");
    setParseErrors([]);
    setJobId(null);
    setJobStatus(null);
  };

  // ==========================================================================
  // Derived state
  // ==========================================================================

  const isComplete = jobStatus?.state === "completed";
  const isFailed = jobStatus?.state === "failed";
  const progress =
    typeof jobStatus?.progress === "number" ? jobStatus.progress : 0;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="bg-white border border-border rounded-lg p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Package className="w-5 h-5" />
            Product Import
          </h3>
          <p className="text-sm text-gray-500">
            Import products from CSV with weight &amp; dimensions
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

      {/* Parse Warnings */}
      {parseErrors.length > 0 && !isComplete && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm">
          <div className="text-yellow-700 font-medium mb-1">
            Parse Warnings ({parseErrors.length}):
          </div>
          <ul className="text-xs text-yellow-700 space-y-1 max-h-20 overflow-y-auto">
            {parseErrors.slice(0, 5).map((err, i) => (
              <li key={i}>{err}</li>
            ))}
            {parseErrors.length > 5 && (
              <li className="text-gray-500">
                +{parseErrors.length - 5} more...
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Job Failed */}
      {isFailed && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <span className="font-medium text-red-700">Import Failed</span>
          </div>
          <p className="text-sm text-red-600">
            {jobStatus?.failedReason || "Unknown error"}
          </p>
          <button
            onClick={reset}
            className="mt-3 text-sm text-red-600 hover:underline"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Completed Result */}
      {isComplete && jobStatus?.result && (
        <div
          className={`mb-4 p-4 rounded-lg border ${
            jobStatus.result.failed === 0
              ? "bg-green-50 border-green-200"
              : "bg-yellow-50 border-yellow-200"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle
              className={`w-5 h-5 ${
                jobStatus.result.failed === 0
                  ? "text-green-600"
                  : "text-yellow-600"
              }`}
            />
            <span className="font-medium">Import Complete</span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Products Created:</span>{" "}
              <span className="font-medium text-green-600">
                {jobStatus.result.success}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Failed:</span>{" "}
              <span className="font-medium text-red-600">
                {jobStatus.result.failed}
              </span>
            </div>
          </div>

          {/* Import errors */}
          {jobStatus.result.errors && jobStatus.result.errors.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-sm text-red-600 font-medium mb-1">
                Errors ({jobStatus.result.errors.length}):
              </div>
              <ul className="text-xs text-red-600 space-y-1 max-h-24 overflow-y-auto">
                {jobStatus.result.errors.slice(0, 10).map((err, i) => (
                  <li key={i}>
                    <strong>{err.sku}:</strong> {err.error}
                  </li>
                ))}
                {jobStatus.result.errors.length > 10 && (
                  <li className="text-gray-500">
                    +{jobStatus.result.errors.length - 10} more...
                  </li>
                )}
              </ul>
            </div>
          )}

          <button
            onClick={reset}
            className="mt-3 text-sm text-blue-600 hover:underline"
          >
            Import Another
          </button>
        </div>
      )}

      {/* Upload Area */}
      {!isComplete && !isFailed && (
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
              <span className="text-gray-600">
                {jobId ? `Importing... ${progress}%` : "Parsing CSV..."}
              </span>
              {jobId && (
                <div className="w-full max-w-xs mt-2">
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  {jobStatus?.data?.productCount && (
                    <p className="text-xs text-gray-400 mt-1">
                      {jobStatus.data.productCount} products
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 mb-2">
                Drop CSV file here or click to upload
              </p>
              <p className="text-xs text-gray-400 mb-3">
                Required: SKU, NAME &bull; Optional: UPC, CATEGORY, SINGLE
                WEIGHT, MC WEIGHT, MC QTY, dimensions
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
      )}
    </div>
  );
}
