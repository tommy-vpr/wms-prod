/**
 * Product Import Page
 * Upload CSV, review products, queue import job
 */

import { useState, useCallback, useEffect } from "react";
import {
  Upload,
  AlertCircle,
  CheckCircle,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import { Loading } from "../../../components/ui/loading";

interface ParsedVariant {
  sku: string;
  upc: string;
  name: string;
  barcode?: string;
  weight?: number;
  shopifyVariantId?: string;
}

interface ParsedProduct {
  sku: string;
  name: string;
  brand?: string;
  category?: string;
  variants: ParsedVariant[];
}

interface JobStatus {
  jobId: string;
  state: string;
  progress: number;
  result?: {
    success: number;
    failed: number;
    errors: Array<{ sku: string; error: string }>;
  };
}

// Update this to match your API base URL
const API_BASE = "/api";

export default function ProductImportPage() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [products, setProducts] = useState<ParsedProduct[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  // ============================================================================
  // CSV Parsing
  // ============================================================================

  const parseCSV = (text: string): Record<string, string>[] => {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));

    return lines.slice(1).map((line) => {
      // Handle quoted values with commas
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
      headers.forEach((h, i) => (row[h] = values[i]?.replace(/"/g, "") || ""));
      return row;
    });
  };

  const handleUpload = useCallback((file: File) => {
    setLoading(true);
    setError("");

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const rows = parseCSV(text);

        // Required columns
        const required = ["SKU", "NAME"];
        const hasRequired = required.every((col) =>
          Object.keys(rows[0] || {}).some(
            (k) => k.toUpperCase() === col.toUpperCase(),
          ),
        );

        if (!hasRequired) {
          throw new Error(`CSV must have columns: ${required.join(", ")}`);
        }

        // Normalize column names to uppercase
        const normalizedRows = rows.map((row) => {
          const normalized: Record<string, string> = {};
          Object.entries(row).forEach(([key, value]) => {
            normalized[key.toUpperCase()] = value;
          });
          return normalized;
        });

        // Group rows by product (BRAND + CATEGORY or first two words of NAME)
        const grouped: Record<string, ParsedProduct> = {};

        normalizedRows.forEach((row) => {
          if (!row.SKU) return; // Skip empty rows

          const productKey = row.BRAND
            ? `${row.BRAND}-${row.CATEGORY || "General"}`
            : row.NAME?.split(" ").slice(0, 2).join(" ") || row.SKU;

          if (!grouped[productKey]) {
            grouped[productKey] = {
              sku: productKey.toUpperCase().replace(/[^A-Z0-9]/g, "-"),
              name: productKey,
              brand: row.BRAND,
              category: row.CATEGORY,
              variants: [],
            };
          }

          grouped[productKey].variants.push({
            sku: row.SKU,
            upc: row.UPC || "",
            name: row.NAME || row.PRODUCT || row.SKU,
            barcode: row.UPC || row.BARCODE,
            weight: row.WEIGHT ? parseFloat(row.WEIGHT) : undefined,
            shopifyVariantId: row.SHOPIFY_VARIANT_ID,
          });
        });

        const productList = Object.values(grouped);
        setProducts(productList);

        // Select all by default
        const sel: Record<string, boolean> = {};
        productList.forEach((p) => (sel[p.sku] = true));
        setSelected(sel);

        setSuccess(
          `Parsed ${normalizedRows.length} rows into ${productList.length} products`,
        );
        setStep(2);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file);
  }, []);

  // ============================================================================
  // Import Job
  // ============================================================================

  const handleImport = async () => {
    const selectedProducts = products.filter((p) => selected[p.sku]);
    if (selectedProducts.length === 0) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE}/products/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: selectedProducts.map((p) => ({
            product: {
              sku: p.sku,
              name: p.name,
              brand: p.brand,
              category: p.category,
            },
            variants: p.variants,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Import failed");
      }

      const data = await response.json();
      setJobId(data.jobId);
      setStep(3);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Job Status Polling
  // ============================================================================

  useEffect(() => {
    if (!jobId || step !== 3) return;

    const pollStatus = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/products/import/job/${jobId}`,
        );
        if (response.ok) {
          const data = await response.json();
          setJobStatus(data);

          if (data.state === "completed" || data.state === "failed") {
            // Stop polling
            return;
          }
        }
      } catch (err) {
        console.error("Failed to fetch job status:", err);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);

    return () => clearInterval(interval);
  }, [jobId, step]);

  // ============================================================================
  // Helpers
  // ============================================================================

  const toggleSelect = (sku: string) => {
    setSelected((prev) => ({ ...prev, [sku]: !prev[sku] }));
  };

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const variantCount = products
    .filter((p) => selected[p.sku])
    .reduce((sum, p) => sum + p.variants.length, 0);

  const resetForm = () => {
    setStep(1);
    setProducts([]);
    setSelected({});
    setJobId(null);
    setJobStatus(null);
    setSuccess("");
    setError("");
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Package className="w-8 h-8 text-blue-500" />
        <h1 className="text-2xl font-bold">Product Import</h1>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center mb-8">
        {[
          { num: 1, label: "Upload CSV" },
          { num: 2, label: "Review" },
          { num: 3, label: "Import" },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= s.num
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200 text-gray-600"
                }`}
              >
                {s.num}
              </div>
              <span className="text-xs mt-1 text-gray-600">{s.label}</span>
            </div>
            {i < 2 && (
              <div
                className={`w-20 h-1 mx-2 ${
                  step > s.num ? "bg-blue-500" : "bg-gray-200"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && step < 3 && (
        <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Step 1: Upload */}
      {step === 1 && (
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors"
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0]) handleUpload(e.dataTransfer.files[0]);
          }}
          onDragOver={(e) => e.preventDefault()}
        >
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">Upload Product CSV</h3>
          <p className="text-gray-600 mb-2">
            Required columns:{" "}
            <code className="bg-gray-100 px-1 rounded">SKU</code>,{" "}
            <code className="bg-gray-100 px-1 rounded">NAME</code>
          </p>
          <p className="text-gray-500 text-sm mb-4">
            Optional: UPC, BARCODE, WEIGHT, BRAND, CATEGORY, SHOPIFY_VARIANT_ID
          </p>
          <label className="bg-blue-500 text-white px-6 py-2 rounded-lg cursor-pointer hover:bg-blue-600 inline-block">
            Choose CSV File
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && handleUpload(e.target.files[0])
              }
            />
          </label>
          {loading && <Loading />}
        </div>
      )}

      {/* Step 2: Review */}
      {step === 2 && (
        <div>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-gray-600">
              Selected: <strong>{selectedCount}</strong> products,{" "}
              <strong>{variantCount}</strong> variants
            </span>
            <div className="space-x-2">
              <button
                onClick={() => {
                  const all: Record<string, boolean> = {};
                  products.forEach((p) => (all[p.sku] = true));
                  setSelected(all);
                }}
                className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
              >
                Select All
              </button>
              <button
                onClick={() => setSelected({})}
                className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto border rounded-lg mb-4">
            {products.map((p) => (
              <label
                key={p.sku}
                className={`flex items-center p-3 border-b cursor-pointer hover:bg-gray-50 ${
                  selected[p.sku] ? "bg-blue-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  checked={selected[p.sku] || false}
                  onChange={() => toggleSelect(p.sku)}
                  className="mr-3 w-4 h-4"
                />
                <div className="flex-1">
                  <div className="font-medium">{p.name}</div>
                  <div className="text-sm text-gray-500">
                    {p.variants.length} variants • {p.brand || "No brand"} •{" "}
                    {p.category || "Uncategorized"}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    SKUs:{" "}
                    {p.variants
                      .slice(0, 3)
                      .map((v) => v.sku)
                      .join(", ")}
                    {p.variants.length > 3 && ` +${p.variants.length - 3} more`}
                  </div>
                </div>
              </label>
            ))}
          </div>

          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              disabled={loading}
              className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              Back
            </button>
            <button
              onClick={handleImport}
              disabled={selectedCount === 0 || loading}
              className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                `Import ${selectedCount} Products`
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Import Progress */}
      {step === 3 && (
        <div className="text-center py-8">
          {!jobStatus ||
          jobStatus.state === "active" ||
          jobStatus.state === "waiting" ? (
            <>
              <Loader2 className="w-16 h-16 text-blue-500 mx-auto mb-4 animate-spin" />
              <h2 className="text-xl font-medium mb-2">
                Importing Products...
              </h2>
              <p className="text-gray-600 mb-4">Job ID: {jobId}</p>
              {jobStatus?.progress !== undefined && (
                <div className="max-w-xs mx-auto">
                  <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${jobStatus.progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-gray-500">{jobStatus.progress}%</p>
                </div>
              )}
            </>
          ) : jobStatus.state === "completed" ? (
            <>
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-medium mb-2">Import Complete!</h2>
              <p className="text-gray-600 mb-4">
                Successfully imported{" "}
                <strong>{jobStatus.result?.success || 0}</strong> products
                {jobStatus.result?.failed ? (
                  <>
                    ,{" "}
                    <strong className="text-red-600">
                      {jobStatus.result.failed}
                    </strong>{" "}
                    failed
                  </>
                ) : null}
              </p>
              {jobStatus.result?.errors &&
                jobStatus.result.errors.length > 0 && (
                  <div className="max-w-md mx-auto text-left bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <h3 className="font-medium text-red-800 mb-2">Errors:</h3>
                    <ul className="text-sm text-red-700 space-y-1">
                      {jobStatus.result.errors.slice(0, 5).map((e, i) => (
                        <li key={i}>
                          <strong>{e.sku}:</strong> {e.error}
                        </li>
                      ))}
                      {jobStatus.result.errors.length > 5 && (
                        <li className="text-gray-500">
                          +{jobStatus.result.errors.length - 5} more errors
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              <button
                onClick={resetForm}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Import Another File
              </button>
            </>
          ) : (
            <>
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-medium mb-2">Import Failed</h2>
              <p className="text-gray-600 mb-4">Job ID: {jobId}</p>
              <button
                onClick={resetForm}
                className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                Try Again
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
