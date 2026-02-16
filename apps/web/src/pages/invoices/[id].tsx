/**
 * Invoice Detail Page
 *
 * Save to: apps/web/src/pages/invoices/[id].tsx
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ArrowLeft,
  FileText,
  Upload,
  Camera,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  MapPin,
  Barcode,
  Package,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle,
  AlertTriangle,
  Send,
  ThumbsUp,
  ThumbsDown,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { apiClient } from "../../lib/api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface InvoiceItem {
  id: string;
  sequence: number;
  sku: string;
  productName: string;
  barcode: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  locationId: string | null;
  location: { id: string; name: string } | null;
  productVariantId: string | null;
  productVariant: {
    id: string;
    sku: string;
    name: string;
    imageUrl: string | null;
  } | null;
  lotNumber: string | null;
  expiryDate: string | null;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  vendor: string;
  status: string;
  imageUrl: string | null;
  imageFilename: string | null;
  totalItems: number;
  totalQuantity: number;
  totalCost: number;
  tax: number;
  fees: number;
  grandTotal: number;
  notes: string | null;
  createdBy: { id: string; name: string | null };
  approvedBy: { id: string; name: string | null } | null;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showImage, setShowImage] = useState(false);
  const [copiedSku, setCopiedSku] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchInvoice = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiClient.get<Invoice>(`/invoices/${id}`);
      setInvoice(res);
    } catch (err: any) {
      setError(err.message || "Failed to load invoice");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  // ─── Image Upload ──────────────────────────────────────────────────────────

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(
        `${import.meta.env.VITE_API_URL || "/api"}/invoices/${id}/upload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${JSON.parse(localStorage.getItem("wms_tokens") || "{}").accessToken}`,
          },
          body: formData,
        },
      );

      if (!res.ok) throw new Error("Upload failed");
      await fetchInvoice();
    } catch (err: any) {
      setError(err.message || "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Status Actions ────────────────────────────────────────────────────────

  const handleAction = async (action: string) => {
    if (!id) return;
    setActionLoading(true);
    try {
      await apiClient.post<{ success: boolean }>(`/invoices/${id}/${action}`);
      await fetchInvoice();
    } catch (err: any) {
      setError(err.message || `Failed to ${action}`);
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Delete item ───────────────────────────────────────────────────────────

  const handleDeleteItem = async (itemId: string) => {
    if (!id || !confirm("Remove this item?")) return;
    try {
      await apiClient.delete<{ success: boolean }>(
        `/invoices/${id}/items/${itemId}`,
      );
      await fetchInvoice();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ─── Copy barcode/SKU ─────────────────────────────────────────────────────

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSku(text);
    setTimeout(() => setCopiedSku(null), 2000);
  };

  // ─── Loading / Error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{error || "Invoice not found"}</p>
          <Link
            to="/invoices"
            className="text-blue-600 text-sm mt-2 inline-block hover:underline"
          >
            Back to Invoices
          </Link>
        </div>
      </div>
    );
  }

  const isDraft = invoice.status === "DRAFT";

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/invoices")} className="p-1">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg">{invoice.invoiceNumber}</h1>
              <StatusBadge status={invoice.status} />
            </div>
            <p className="text-xs text-gray-500">{invoice.vendor}</p>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="mx-4 mt-3 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError("")}>
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* ─── Invoice Image ─────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-sm">Vendor Invoice</h2>
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                {uploading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Camera className="w-3.5 h-3.5" />
                )}
                {uploading
                  ? "Uploading..."
                  : invoice.imageUrl
                    ? "Replace"
                    : "Upload"}
              </button>
            </div>
          </div>

          {invoice.imageUrl ? (
            <div>
              <button
                onClick={() => setShowImage(!showImage)}
                className="w-full"
              >
                <img
                  src={invoice.imageUrl}
                  alt="Vendor Invoice"
                  className={cn(
                    "w-full object-contain transition-all",
                    showImage ? "max-h-[600px]" : "max-h-48",
                  )}
                />
              </button>
              <div className="px-4 py-2 bg-gray-50 text-xs text-gray-500 flex items-center justify-between">
                <span>Tap image to {showImage ? "collapse" : "expand"}</span>
                <a
                  href={invoice.imageUrl}
                  target="_blank"
                  rel="noopener"
                  className="text-blue-600 flex items-center gap-1 hover:underline"
                >
                  Full size <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center">
              <Upload className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No invoice image uploaded</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-2 text-blue-600 text-sm font-medium hover:underline"
              >
                Upload vendor invoice
              </button>
            </div>
          )}
        </div>

        {/* ─── Summary ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold">{invoice.totalItems}</p>
            <p className="text-[10px] text-gray-500 uppercase">Items</p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold">{invoice.totalQuantity}</p>
            <p className="text-[10px] text-gray-500 uppercase">Total Qty</p>
          </div>
          <div className="bg-white border border-border rounded-lg p-3 text-center">
            <p className="text-lg font-bold">${invoice.totalCost.toFixed(2)}</p>
            <p className="text-[10px] text-gray-500 uppercase">Subtotal</p>
          </div>
        </div>

        {/* ─── Tax / Fees / Grand Total ──────────────────────────────────── */}
        <div className="bg-white border border-border rounded-lg">
          <div className="divide-y divide-border">
            <div className="px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs text-gray-500">Subtotal</span>
              <span className="text-sm font-medium">
                ${invoice.totalCost.toFixed(2)}
              </span>
            </div>
            <TaxFeeRow
              label="Tax"
              value={invoice.tax}
              invoiceId={invoice.id}
              field="tax"
              isDraft={isDraft}
              onUpdated={fetchInvoice}
            />
            <TaxFeeRow
              label="Fees"
              value={invoice.fees}
              invoiceId={invoice.id}
              field="fees"
              isDraft={isDraft}
              onUpdated={fetchInvoice}
            />
            <div className="px-4 py-2.5 flex items-center justify-between bg-gray-50">
              <span className="text-sm font-semibold">Grand Total</span>
              <span className="text-sm font-bold">
                ${invoice.grandTotal.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* ─── Details Card ──────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-lg">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="font-semibold text-sm">Details</h2>
          </div>
          <div className="divide-y divide-border">
            <DetailRow label="Vendor" value={invoice.vendor} />
            <DetailRow
              label="Created By"
              value={invoice.createdBy?.name || "—"}
            />
            <DetailRow
              label="Created"
              value={new Date(invoice.createdAt).toLocaleString()}
            />
            {invoice.submittedAt && (
              <DetailRow
                label="Submitted"
                value={new Date(invoice.submittedAt).toLocaleString()}
              />
            )}
            {invoice.approvedBy && (
              <DetailRow
                label="Approved By"
                value={invoice.approvedBy.name || "—"}
              />
            )}
            {invoice.approvedAt && (
              <DetailRow
                label="Approved"
                value={new Date(invoice.approvedAt).toLocaleString()}
              />
            )}
            {invoice.notes && <DetailRow label="Notes" value={invoice.notes} />}
          </div>
        </div>

        {/* ─── Line Items ────────────────────────────────────────────────── */}
        <div className="bg-white border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-sm">
              Line Items ({invoice.items.length})
            </h2>
            {isDraft && (
              <button
                onClick={() => setShowAddItem(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            )}
          </div>

          {invoice.items.length === 0 ? (
            <div className="p-8 text-center">
              <Package className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No items yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {invoice.items.map((item) => (
                <InvoiceItemCard
                  key={item.id}
                  item={item}
                  invoiceId={invoice.id}
                  vendor={invoice.vendor}
                  isDraft={isDraft}
                  isEditing={editingItemId === item.id}
                  onEdit={() =>
                    setEditingItemId(editingItemId === item.id ? null : item.id)
                  }
                  onDelete={() => handleDeleteItem(item.id)}
                  onUpdated={() => {
                    setEditingItemId(null);
                    fetchInvoice();
                  }}
                  copiedSku={copiedSku}
                  onCopy={copyToClipboard}
                />
              ))}
            </div>
          )}
        </div>
        {/* ─── Bottom Action Bar ─────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <div className="ml-auto flex gap-2">
            {invoice.status === "DRAFT" && (
              <>
                <button
                  onClick={() => handleAction("submit")}
                  disabled={actionLoading || invoice.totalItems === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  Submit for Approval
                </button>
              </>
            )}
            {invoice.status === "SUBMITTED" && (
              <>
                <button
                  onClick={() => handleAction("approve")}
                  disabled={actionLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  <ThumbsUp className="w-4 h-4" />
                  Approve
                </button>
                <button
                  onClick={() => handleAction("reject")}
                  disabled={actionLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  <ThumbsDown className="w-4 h-4" />
                  Reject
                </button>
              </>
            )}
            {invoice.status === "REJECTED" && (
              <div className="flex-1 text-center text-sm text-gray-500 py-2">
                This invoice was rejected. Create a new one to resubmit.
              </div>
            )}
            {invoice.status === "APPROVED" && (
              <div className="flex-1 flex items-center justify-center gap-1.5 text-sm text-green-700 py-2">
                <CheckCircle className="w-4 h-4" />
                Invoice Approved
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Add Item Modal ──────────────────────────────────────────────── */}
      {showAddItem && (
        <AddItemModal
          invoiceId={invoice.id}
          vendor={invoice.vendor}
          onClose={() => setShowAddItem(false)}
          onAdded={() => {
            setShowAddItem(false);
            fetchInvoice();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice Item Card
// ─────────────────────────────────────────────────────────────────────────────

function InvoiceItemCard({
  item,
  invoiceId,
  vendor,
  isDraft,
  isEditing,
  onEdit,
  onDelete,
  onUpdated,
  copiedSku,
  onCopy,
}: {
  item: InvoiceItem;
  invoiceId: string;
  vendor: string;
  isDraft: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onUpdated: () => void;
  copiedSku: string | null;
  onCopy: (text: string) => void;
}) {
  const [editData, setEditData] = useState({
    sku: item.sku,
    productName: item.productName,
    quantity: item.quantity,
    unitCost: item.unitCost,
  });
  const [saving, setSaving] = useState(false);

  const generateSku = async () => {
    if (!editData.productName.trim()) return;
    try {
      const res = await apiClient.post<{ sku: string }>(
        "/invoices/generate-sku",
        {
          brand: vendor || "GEN",
          productName: editData.productName.trim(),
        },
      );
      setEditData({ ...editData, sku: res.sku });
    } catch {
      const clean = editData.productName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      const yr = String(new Date().getFullYear()).slice(-2);
      setEditData({
        ...editData,
        sku: `${(vendor || "GEN").toUpperCase().slice(0, 3)}-${clean}-${yr}`,
      });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch<{ id: string }>(
        `/invoices/${invoiceId}/items/${item.id}`,
        editData,
      );
      onUpdated();
    } catch (err: any) {
      console.error("Update failed:", err);
    } finally {
      setSaving(false);
    }
  };

  if (isEditing) {
    return (
      <div className="px-4 py-3 bg-blue-50/50">
        <div className="space-y-2">
          <input
            type="text"
            value={editData.productName}
            onChange={(e) =>
              setEditData({ ...editData, productName: e.target.value })
            }
            placeholder="Product name"
            className="w-full px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
          />
          <div className="grid grid-cols-3 gap-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={editData.sku}
                onChange={(e) =>
                  setEditData({ ...editData, sku: e.target.value })
                }
                placeholder="SKU"
                className="flex-1 min-w-0 px-2 py-1.5 border border-border rounded text-sm font-mono outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={generateSku}
                type="button"
                title="Auto-generate SKU"
                className="cursor-pointer px-1.5 py-1.5 border border-blue-200 rounded text-blue-600 hover:bg-blue-50 shrink-0 text-[10px] font-bold"
              >
                GEN
              </button>
            </div>
            <input
              type="number"
              value={editData.quantity}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  quantity: parseInt(e.target.value) || 0,
                })
              }
              placeholder="Qty"
              min={1}
              className="px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              type="number"
              value={editData.unitCost || ""}
              onChange={(e) =>
                setEditData({
                  ...editData,
                  unitCost: parseFloat(e.target.value) || 0,
                })
              }
              placeholder="Unit $"
              step="0.01"
              className="px-2 py-1.5 border border-border rounded text-sm outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={onEdit}
              className="cursor-pointer px-3 py-1.5 text-xs font-medium text-gray-600 border border-border rounded hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="cursor-pointer px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 font-mono shrink-0">
              #{item.sequence}
            </span>
            <span className="font-medium text-sm truncate">
              {item.productName}
            </span>
          </div>

          {/* SKU + Barcode row */}
          <div className="mt-1 flex items-center gap-2">
            <button
              onClick={() => onCopy(item.sku)}
              className="cursor-pointer flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-600 hover:bg-gray-200 transition-colors"
              title="Copy SKU"
            >
              <Barcode className="w-3 h-3" />
              {item.sku}
              {copiedSku === item.sku ? (
                <Check className="w-3 h-3 text-green-600" />
              ) : (
                <Copy className="w-3 h-3 text-gray-400" />
              )}
            </button>
            {item.barcode && item.barcode !== item.sku && (
              <button
                onClick={() => onCopy(item.barcode!)}
                className="cursor-pointer flex items-center gap-1 px-1.5 py-0.5 bg-amber-50 rounded text-xs font-mono text-amber-700 hover:bg-amber-100 transition-colors"
                title="Copy barcode"
              >
                {item.barcode}
                {copiedSku === item.barcode ? (
                  <Check className="w-3 h-3 text-green-600" />
                ) : (
                  <Copy className="w-3 h-3 text-gray-400" />
                )}
              </button>
            )}
          </div>

          {/* Qty / Cost / Location */}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
            <span>
              Qty: <strong className="text-gray-700">{item.quantity}</strong>
            </span>
            {item.unitCost > 0 && (
              <span>
                @ ${item.unitCost.toFixed(2)} = ${item.totalCost.toFixed(2)}
              </span>
            )}
            {item.location && (
              <span className="flex items-center gap-0.5 text-blue-600">
                <MapPin className="w-3 h-3" />
                {item.location.name}
              </span>
            )}
            {item.productVariant && (
              <span className="flex items-center gap-0.5 text-purple-600">
                <Package className="w-3 h-3" />
                Linked
              </span>
            )}
            {item.lotNumber && <span>Lot: {item.lotNumber}</span>}
          </div>
        </div>

        {/* Actions */}
        {isDraft && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={onEdit}
              className="cursor-pointer p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="cursor-pointer p-1.5 text-gray-400 hover:text-red-600 rounded hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Item Modal
// ─────────────────────────────────────────────────────────────────────────────

function AddItemModal({
  invoiceId,
  vendor,
  onClose,
  onAdded,
}: {
  invoiceId: string;
  vendor: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [productName, setProductName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [unitCost, setUnitCost] = useState(0);
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const generateSku = async () => {
    if (!productName.trim()) return;
    try {
      const res = await apiClient.post<{ sku: string }>(
        "/invoices/generate-sku",
        {
          brand: vendor || "GEN",
          productName: productName.trim(),
        },
      );
      setSku(res.sku);
    } catch {
      const clean = productName
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
      const yr = String(new Date().getFullYear()).slice(-2);
      setSku(`${(vendor || "GEN").toUpperCase().slice(0, 3)}-${clean}-${yr}`);
    }
  };

  const handleSubmit = async () => {
    if (!productName.trim()) {
      setError("Product name is required");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await apiClient.post<{ id: string }>(`/invoices/${invoiceId}/items`, {
        productName: productName.trim(),
        sku: sku.trim() || undefined,
        quantity: quantity || 1,
        unitCost: unitCost || 0,
        locationId: locationId.trim() || undefined,
      });
      onAdded();
    } catch (err: any) {
      setError(err.message || "Failed to add item");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-md sm:rounded-xl rounded-t-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold">Add Item</h3>
          <button onClick={onClose} className="cursor-pointer p-1">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Product Name *
            </label>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="e.g. Watermelon Salt ICE 30ml"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              SKU (leave empty to auto-generate)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Auto-generated if empty"
                className="flex-1 px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                onClick={generateSku}
                type="button"
                title="Generate SKU from vendor + product name + year"
                className="cursor-pointer px-3 py-2 border border-blue-200 rounded-lg text-blue-600 hover:bg-blue-50 text-xs font-bold whitespace-nowrap"
              >
                GEN
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Quantity
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                min={1}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Unit Cost ($)
              </label>
              <input
                type="number"
                value={unitCost || ""}
                onChange={(e) => setUnitCost(parseFloat(e.target.value) || 0)}
                step="0.01"
                min={0}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Location ID (optional)
            </label>
            <input
              type="text"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              placeholder="e.g. 1-A-1-A-1-X"
              className="w-full px-3 py-2 border border-border rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-border flex gap-2">
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
            {submitting ? "Adding..." : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Small Components
// ─────────────────────────────────────────────────────────────────────────────

function TaxFeeRow({
  label,
  value,
  invoiceId,
  field,
  isDraft,
  onUpdated,
}: {
  label: string;
  value: number;
  invoiceId: string;
  field: "tax" | "fees";
  isDraft: boolean;
  onUpdated: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(value || ""));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.patch<{ id: string }>(`/invoices/${invoiceId}`, {
        [field]: parseFloat(inputVal) || 0,
      });
      setEditing(false);
      onUpdated();
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  if (editing && isDraft) {
    return (
      <div className="px-4 py-2 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">{label}</span>
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-400">$</span>
          <input
            type="number"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            step="0.01"
            min={0}
            autoFocus
            className="w-24 px-2 py-1 border border-border rounded text-sm text-right outline-none focus:ring-1 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <button
            onClick={handleSave}
            disabled={saving}
            className="cursor-pointer p-1 text-green-600 hover:bg-green-50 rounded"
          >
            <Check className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="cursor-pointer p-1 text-gray-400 hover:bg-gray-100 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-2.5 flex items-center justify-between">
      <span className="text-xs text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm">${value.toFixed(2)}</span>
        {isDraft && (
          <button
            onClick={() => {
              setInputVal(String(value || ""));
              setEditing(true);
            }}
            className="cursor-pointer p-0.5 text-gray-400 hover:text-blue-600 rounded"
          >
            <Pencil className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-2.5 flex items-start justify-between gap-4">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  );
}

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
        "px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase",
        colors[status] || colors.DRAFT,
      )}
    >
      {status}
    </span>
  );
}

export default InvoiceDetailPage;
