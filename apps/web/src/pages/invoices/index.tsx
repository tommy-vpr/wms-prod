/**
 * Invoices List Page
 *
 * Save to: apps/web/src/pages/invoices/index.tsx
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FileText,
  Plus,
  Search,
  RefreshCw,
  ChevronRight,
  Image,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  vendor: string;
  status: string;
  imageUrl: string | null;
  totalItems: number;
  totalQuantity: number;
  totalCost: number;
  tax: number;
  fees: number;
  grandTotal: number;
  notes: string | null;
  createdBy: { id: string; name: string | null };
  createdAt: string;
  updatedAt: string;
  itemCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function InvoicesPage() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showCreate, setShowCreate] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (search.trim()) params.append("search", search.trim());
      params.append("limit", "50");

      const res = await apiClient.get<{
        invoices: InvoiceListItem[];
        total: number;
      }>(`/invoices?${params}`);
      setInvoices(res.invoices);
      setTotal(res.total);
    } catch (err) {
      console.error("Failed to fetch invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Invoices</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {total} invoice{total !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="cursor-pointer flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            New Invoice
          </button>
        </div>

        {/* Search + Filter */}
        <div className="mt-3 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search invoices, vendors, SKUs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="cursor-pointer absolute right-3 top-1/2 -translate-y-1/2"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            )}
          </div>
          <button
            onClick={fetchInvoices}
            className="cursor-pointer p-2 border border-border rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Status tabs */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {["ALL", "DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "cursor-pointer px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors",
                statusFilter === s
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200",
              )}
            >
              {s === "ALL" ? "All" : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Invoice List */}
      <div className="p-4 space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white rounded-lg border border-border p-4 animate-pulse"
              >
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-3 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">No invoices found</p>
            <button
              onClick={() => setShowCreate(true)}
              className="cursor-pointer mt-3 text-blue-600 text-sm font-medium hover:bg-blue-600 hover:text-white transition
               px-6 py-2 border border-blue-600 rounded-md"
            >
              Create Invoice
            </button>
          </div>
        ) : (
          invoices.map((inv) => (
            <Link
              key={inv.id}
              to={`/invoices/${inv.id}`}
              className="block bg-white rounded-lg border border-border hover:border-blue-200 hover:shadow-sm transition-all"
            >
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    {inv.imageUrl ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden border border-border shrink-0">
                        <img
                          src={inv.imageUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <FileText className="w-5 h-5 text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">
                          {inv.invoiceNumber}
                        </span>
                        <StatusBadge status={inv.status} />
                      </div>
                      <p className="text-xs text-gray-500 truncate">
                        {inv.vendor}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                </div>

                <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                  <span>
                    {inv.itemCount} item{inv.itemCount !== 1 ? "s" : ""}
                  </span>
                  <span>Qty: {inv.totalQuantity}</span>
                  <span>${inv.grandTotal.toFixed(2)}</span>
                  <span className="ml-auto">
                    {new Date(inv.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Create Invoice Modal */}
      {showCreate && (
        <CreateInvoiceModal
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            navigate(`/invoices/${id}`);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create Invoice Modal
// ─────────────────────────────────────────────────────────────────────────────

function CreateInvoiceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [tax, setTax] = useState(0);
  const [fees, setFees] = useState(0);
  const [items, setItems] = useState<
    Array<{
      productName: string;
      sku: string;
      quantity: number;
      unitCost: number;
    }>
  >([{ productName: "", sku: "", quantity: 1, unitCost: 0 }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const generateSku = async (idx: number) => {
    const item = items[idx];
    if (!item.productName.trim()) return;
    try {
      const res = await apiClient.post<{ sku: string }>(
        "/invoices/generate-sku",
        {
          brand: vendor.trim() || "GEN",
          productName: item.productName.trim(),
        },
      );
      updateItem(idx, "sku", res.sku);
    } catch {
      // Fallback: simple client-side generation
      const clean = item.productName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      const yr = String(new Date().getFullYear()).slice(-2);
      updateItem(
        idx,
        "sku",
        `${(vendor || "GEN").toUpperCase().slice(0, 3)}-${clean}-${yr}`,
      );
    }
  };

  const addItemRow = () => {
    setItems([
      ...items,
      { productName: "", sku: "", quantity: 1, unitCost: 0 },
    ]);
  };

  const updateItem = (idx: number, field: string, value: any) => {
    const updated = [...items];
    (updated[idx] as any)[field] = value;
    setItems(updated);
  };

  const removeItem = (idx: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (!vendor.trim()) {
      setError("Vendor name is required");
      return;
    }

    const validItems = items.filter((i) => i.productName.trim());
    if (validItems.length === 0) {
      setError("At least one item with a product name is required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await apiClient.post<{ id: string }>("/invoices", {
        vendor: vendor.trim(),
        notes: notes.trim() || undefined,
        tax: tax || undefined,
        fees: fees || undefined,
        items: validItems.map((i) => ({
          productName: i.productName.trim(),
          sku: i.sku.trim() || undefined, // Let backend auto-generate if empty
          quantity: i.quantity || 1,
          unitCost: i.unitCost || 0,
        })),
      });
      onCreated(res.id);
    } catch (err: any) {
      setError(err.message || "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-lg sm:rounded-xl rounded-t-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold">New Invoice</h2>
          <button onClick={onClose} className="cursor-pointer p-1">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Vendor */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Vendor *
            </label>
            <input
              type="text"
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. Skwezed Distribution"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Optional notes..."
              className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
            />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Items</label>
              <button
                onClick={addItemRow}
                className="cursor-pointer text-xs text-blue-600 font-medium hover:underline"
              >
                + Add row
              </button>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={idx}
                  className="bg-gray-50 border border-border rounded-lg p-3 space-y-2"
                >
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={item.productName}
                      onChange={(e) =>
                        updateItem(idx, "productName", e.target.value)
                      }
                      placeholder="Product name *"
                      className="flex-1 px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {items.length > 1 && (
                      <button
                        onClick={() => removeItem(idx)}
                        className="cursor-pointer p-1 text-gray-400 hover:text-red-500"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={item.sku}
                        onChange={(e) => updateItem(idx, "sku", e.target.value)}
                        placeholder="SKU"
                        className="flex-1 min-w-0 px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                      />
                      <button
                        onClick={() => generateSku(idx)}
                        type="button"
                        title="Auto-generate SKU from vendor + product name"
                        className="cursor-pointer px-1.5 py-1.5 border border-blue-200 rounded text-blue-600 hover:bg-blue-50 shrink-0 text-[10px] font-bold"
                      >
                        GEN
                      </button>
                    </div>
                    <input
                      type="number"
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(
                          idx,
                          "quantity",
                          parseInt(e.target.value) || 0,
                        )
                      }
                      placeholder="Qty"
                      min={1}
                      className="px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                      type="number"
                      value={item.unitCost || ""}
                      onChange={(e) =>
                        updateItem(
                          idx,
                          "unitCost",
                          parseFloat(e.target.value) || 0,
                        )
                      }
                      placeholder="Unit $"
                      step="0.01"
                      min={0}
                      className="px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tax & Fees */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Tax
              </label>
              <input
                type="number"
                value={tax || ""}
                onChange={(e) => setTax(parseFloat(e.target.value) || 0)}
                step="0.01"
                min={0}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Fees
              </label>
              <input
                type="number"
                value={fees || ""}
                onChange={(e) => setFees(parseFloat(e.target.value) || 0)}
                step="0.01"
                min={0}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 border-t border-border px-4 py-3 flex gap-2">
          <button
            onClick={onClose}
            className="cursor-pointer flex-1 px-4 py-2 border border-border rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="cursor-pointer flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Invoice"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatusBadge
// ─────────────────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700",
    SUBMITTED: "bg-amber-100 text-amber-700",
    APPROVED: "bg-green-100 text-green-700",
    REJECTED: "bg-red-100 text-red-700",
    CANCELLED: "bg-gray-100 text-gray-500",
  };

  return (
    <span
      className={cn(
        "px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase",
        colors[status] || colors.DRAFT,
      )}
    >
      {status}
    </span>
  );
}

export default InvoicesPage;
