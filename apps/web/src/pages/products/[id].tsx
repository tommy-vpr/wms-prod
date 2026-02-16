/**
 * Product Detail Page
 * View and edit a single product
 */

import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Package,
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  AlertCircle,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { Loading } from "../../components/ui/loading";
import { apiClient } from "@/lib/api"; // Add this import

interface ProductVariant {
  id: string;
  sku: string;
  upc: string | null;
  barcode: string | null;
  name: string;
  shopifyVariantId: string | null;
  weight: number | null;
  costPrice: number | null;
  sellingPrice: number | null;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  active: boolean;
  shopifyProductId: string | null;
  variants: ProductVariant[];
  createdAt: string;
  updatedAt: string;
}

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    brand: "",
    category: "",
    active: true,
  });

  // ============================================================================
  // Data Fetching
  // ============================================================================

  useEffect(() => {
    if (!id) return;

    const fetchProduct = async () => {
      setLoading(true);
      setError("");

      try {
        const data = await apiClient.get<Product>(`/products/${id}`);
        setProduct(data);
        setFormData({
          name: data.name || "",
          description: data.description || "",
          brand: data.brand || "",
          category: data.category || "",
          active: data.active ?? true,
        });
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [id]);

  // ============================================================================
  // Handlers
  // ============================================================================

  const handleSave = async () => {
    if (!product) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const updated = await apiClient.patch<Product>(
        `/products/${product.id}`,
        formData,
      );
      setProduct(updated);
      setSuccess("Product saved successfully");

      setTimeout(() => setSuccess(""), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!product) return;

    if (
      !confirm(
        `Are you sure you want to delete "${product.name}"? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      await apiClient.delete(`/products/${product.id}`);
      navigate("/products");
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (loading) {
    return <Loading />;
  }

  if (error && !product) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
        <Link
          to="/products"
          className="inline-flex items-center gap-2 mt-4 text-blue-500 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Products
        </Link>
      </div>
    );
  }

  if (!product) return null;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link
            to="/products"
            className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500" />
            <div>
              <h1 className="text-2xl font-bold">{product.name}</h1>
              <p className="text-sm text-gray-500">SKU: {product.sku}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5" />
          {success}
        </div>
      )}

      {/* Product Info */}
      <div className="bg-white border border-border rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Product Information</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Brand
            </label>
            <input
              type="text"
              value={formData.brand}
              onChange={(e) =>
                setFormData({ ...formData, brand: e.target.value })
              }
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Category
            </label>
            <input
              type="text"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })
              }
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              value={formData.active ? "active" : "inactive"}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  active: e.target.value === "active",
                })
              }
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={3}
              className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Read-only fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border">
          <div>
            <div className="text-sm text-gray-500">SKU</div>
            <div className="font-mono">{product.sku}</div>
          </div>
          {product.shopifyProductId && (
            <div>
              <div className="text-sm text-gray-500">Shopify ID</div>
              <div className="font-mono text-sm">
                {product.shopifyProductId}
              </div>
            </div>
          )}
          <div>
            <div className="text-sm text-gray-500">Created</div>
            <div className="text-sm">
              {new Date(product.createdAt).toLocaleDateString()}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Updated</div>
            <div className="text-sm">
              {new Date(product.updatedAt).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Variants */}
      <div className="bg-white border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            Variants ({product.variants.length})
          </h2>
          <button className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg">
            <Plus className="w-4 h-4" />
            Add Variant
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">
                  Name
                </th>
                <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">
                  SKU
                </th>
                <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">
                  UPC
                </th>
                <th className="text-right px-4 py-2 text-sm font-medium text-gray-600">
                  Weight
                </th>
                <th className="text-right px-4 py-2 text-sm font-medium text-gray-600">
                  Cost
                </th>
                <th className="text-right px-4 py-2 text-sm font-medium text-gray-600">
                  Price
                </th>
                <th className="text-center px-4 py-2 text-sm font-medium text-gray-600">
                  Shopify
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {product.variants.map((variant) => (
                <tr key={variant.id} className="hover:bg-gray-50 border-border">
                  <td className="px-4 py-3 font-medium">{variant.name}</td>
                  <td className="px-4 py-3">
                    <code className="text-sm bg-gray-100 px-2 py-0.5 rounded whitespace-nowrap">
                      {variant.sku}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {variant.upc || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    {variant.weight ? `${variant.weight}g` : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    {variant.costPrice
                      ? `$${Number(variant.costPrice).toFixed(2)}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-600">
                    {variant.sellingPrice
                      ? `$${Number(variant.sellingPrice).toFixed(2)}`
                      : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {variant.shopifyVariantId ? (
                      <span className="inline-flex items-center px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                        ✓
                      </span>
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {product.variants.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            No variants yet. Add one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
