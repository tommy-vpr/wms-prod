/**
 * Admin Products Page
 * List, search, and manage products
 */

import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Package,
  Search,
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  RefreshCw,
  Eye,
  MoreHorizontal,
  Filter,
} from "lucide-react";
import { TableRowSkeleton } from "../../components/ui/loading";

interface ProductVariant {
  id: string;
  sku: string;
  upc: string | null;
  name: string;
  barcode: string | null;
  shopifyVariantId: string | null;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  active: boolean;
  variants: ProductVariant[];
  createdAt: string;
}

interface ProductStats {
  totalProducts: number;
  totalVariants: number;
  byBrand: Record<string, number>;
  byCategory: Record<string, number>;
}

const API_BASE = "/api";
const PAGE_SIZE = 20;

export default function AdminProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [stats, setStats] = useState<ProductStats | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Filters
  const [brandFilter, setBrandFilter] = useState(
    searchParams.get("brand") || "",
  );
  const [categoryFilter, setCategoryFilter] = useState(
    searchParams.get("category") || "",
  );

  const page = parseInt(searchParams.get("page") || "1", 10);

  // ============================================================================
  // Data Fetching
  // ============================================================================

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String((page - 1) * PAGE_SIZE));
      params.set("take", String(PAGE_SIZE));
      if (brandFilter) params.set("brand", brandFilter);
      if (categoryFilter) params.set("category", categoryFilter);

      const response = await fetch(`${API_BASE}/products?${params}`);
      if (!response.ok) throw new Error("Failed to fetch products");

      const data = await response.json();
      setProducts(data.products);
      setTotal(data.total);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, brandFilter, categoryFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/products/import/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error("Failed to fetch stats:", err);
    }
  }, []);

  const handleSearch = async () => {
    if (!searchQuery || searchQuery.length < 2) {
      fetchProducts();
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `${API_BASE}/products/search?q=${encodeURIComponent(searchQuery)}&limit=50`,
      );
      if (!response.ok) throw new Error("Search failed");

      const data = await response.json();
      setProducts(data.products);
      setTotal(data.count);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!searchQuery) {
      fetchProducts();
    }
    fetchStats();
  }, [fetchProducts, fetchStats, searchQuery]);

  // ============================================================================
  // Pagination
  // ============================================================================

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const goToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(newPage));
    setSearchParams(params);
  };

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Package className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-2xl font-bold">Products</h1>
            {stats && (
              <p className="text-sm text-gray-500">
                {stats.totalProducts} products, {stats.totalVariants} variants
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              fetchProducts();
              fetchStats();
            }}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <Link
            to="/products/import"
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            <Upload className="w-4 h-4" />
            Import
          </Link>
          <Link
            to="/products/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </Link>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border rounded-lg p-4">
            <div className="text-2xl font-bold text-blue-600">
              {stats.totalProducts}
            </div>
            <div className="text-sm text-gray-500">Total Products</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-2xl font-bold text-green-600">
              {stats.totalVariants}
            </div>
            <div className="text-sm text-gray-500">Total Variants</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-2xl font-bold text-purple-600">
              {Object.keys(stats.byBrand).length}
            </div>
            <div className="text-sm text-gray-500">Brands</div>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <div className="text-2xl font-bold text-orange-600">
              {Object.keys(stats.byCategory).length}
            </div>
            <div className="text-sm text-gray-500">Categories</div>
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search by SKU, name, or UPC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {stats && (
          <>
            <select
              value={brandFilter}
              onChange={(e) => {
                setBrandFilter(e.target.value);
                const params = new URLSearchParams(searchParams);
                if (e.target.value) {
                  params.set("brand", e.target.value);
                } else {
                  params.delete("brand");
                }
                params.set("page", "1");
                setSearchParams(params);
              }}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Brands</option>
              {Object.keys(stats.byBrand).map((brand) => (
                <option key={brand} value={brand}>
                  {brand} ({stats.byBrand[brand]})
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                const params = new URLSearchParams(searchParams);
                if (e.target.value) {
                  params.set("category", e.target.value);
                } else {
                  params.delete("category");
                }
                params.set("page", "1");
                setSearchParams(params);
              }}
              className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {Object.keys(stats.byCategory).map((cat) => (
                <option key={cat} value={cat}>
                  {cat} ({stats.byCategory[cat]})
                </option>
              ))}
            </select>
          </>
        )}

        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Search
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-4">
          {error}
        </div>
      )}

      {/* Products Table */}
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                Product
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                SKU
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                Brand
              </th>
              <th className="text-left px-4 py-3 text-sm font-medium text-gray-600">
                Category
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">
                Variants
              </th>
              <th className="text-center px-4 py-3 text-sm font-medium text-gray-600">
                Status
              </th>
              <th className="text-right px-4 py-3 text-sm font-medium text-gray-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRowSkeleton key={i} cols={7} />
              ))
            ) : products.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500">
                  No products found
                </td>
              </tr>
            ) : (
              products.map((product) => (
                <tr key={product.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{product.name}</div>
                    {product.description && (
                      <div className="text-sm text-gray-500 truncate max-w-xs">
                        {product.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <code className="text-sm bg-gray-100 px-2 py-1 rounded">
                      {product.sku}
                    </code>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {product.brand || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {product.category || "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center text-sm">
                      {product.variants.length}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        product.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {product.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setSelectedProduct(product)}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <Link
                        to={`/products/${product.id}`}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded"
                        title="Edit"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-gray-500">
            Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
            {Math.min(page * PAGE_SIZE, total)} of {total} products
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => goToPage(page - 1)}
              disabled={page === 1}
              className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="px-4 py-2 text-sm">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => goToPage(page + 1)}
              disabled={page === totalPages}
              className="p-2 border rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Product Detail Modal */}
      {selectedProduct && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => setSelectedProduct(null)}
        >
          <div
            className="bg-white rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-lg font-bold">{selectedProduct.name}</h2>
              <button
                onClick={() => setSelectedProduct(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="text-sm text-gray-500">SKU</div>
                  <div className="font-mono">{selectedProduct.sku}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Brand</div>
                  <div>{selectedProduct.brand || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Category</div>
                  <div>{selectedProduct.category || "-"}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Status</div>
                  <div>{selectedProduct.active ? "Active" : "Inactive"}</div>
                </div>
              </div>

              {selectedProduct.description && (
                <div className="mb-4">
                  <div className="text-sm text-gray-500">Description</div>
                  <div>{selectedProduct.description}</div>
                </div>
              )}

              <div>
                <div className="text-sm text-gray-500 mb-2">
                  Variants ({selectedProduct.variants.length})
                </div>
                <div className="border rounded divide-y">
                  {selectedProduct.variants.map((variant) => (
                    <div key={variant.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{variant.name}</div>
                          <div className="text-sm text-gray-500">
                            SKU: {variant.sku}
                            {variant.upc && ` • UPC: ${variant.upc}`}
                          </div>
                        </div>
                        {variant.shopifyVariantId && (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                            Shopify
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                onClick={() => setSelectedProduct(null)}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
              >
                Close
              </button>
              <Link
                to={`/products/${selectedProduct.id}`}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Edit Product
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
