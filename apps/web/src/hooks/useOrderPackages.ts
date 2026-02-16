/**
 * useOrderPackages Hook
 * Loads and manages OrderPackage state for packing & shipping screens
 *
 * Save to: apps/web/src/hooks/useOrderPackages.ts
 */

import { useState, useEffect, useCallback } from "react";
import { apiClient } from "@/lib/api";

// =============================================================================
// Types
// =============================================================================

export interface OrderPackageItem {
  id: string;
  orderPackageId: string;
  productVariantId: string;
  sku: string;
  quantity: number;
  unitWeight: number | null;
  unitWeightUnit: string | null;
}

export interface OrderPackage {
  id: string;
  orderId: string;
  sequence: number;
  boxId: string | null;
  boxLabel: string | null;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string | null;
  estimatedWeight: number | null;
  actualWeight: number | null;
  weightUnit: string | null;
  status: string;
  items: OrderPackageItem[];
  createdAt: string;
  updatedAt: string;
}

export interface UseOrderPackagesResult {
  packages: OrderPackage[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  recommend: () => Promise<void>;
  updatePackage: (
    packageId: string,
    data: Partial<OrderPackage>,
  ) => Promise<void>;
  addPackage: () => Promise<void>;
  removePackage: (packageId: string) => Promise<void>;
  markPacked: (
    packData: Array<{
      packageId: string;
      actualWeight: number;
      weightUnit?: string;
      length?: number;
      width?: number;
      height?: number;
    }>,
  ) => Promise<void>;
  markShipped: () => Promise<void>;
  hasPackages: boolean;
  allPacked: boolean;
  totalEstimatedWeight: number;
}

// =============================================================================
// Hook
// =============================================================================

export function useOrderPackages(orderId: string): UseOrderPackagesResult {
  const [packages, setPackages] = useState<OrderPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Load packages ─────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ packages: OrderPackage[] }>(
        `/fulfillment/${orderId}/packages`,
      );
      setPackages(data.packages);
    } catch (err: any) {
      setError(err?.message || "Failed to load packages");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // ── Run recommendation ────────────────────────────────────────────────

  const recommend = useCallback(async () => {
    setError(null);
    try {
      const data = await apiClient.post<{ packages: OrderPackage[] }>(
        `/fulfillment/${orderId}/packages/recommend`,
      );
      setPackages(data.packages);
    } catch (err: any) {
      setError(err?.message || "Recommendation failed");
    }
  }, [orderId]);

  // ── Update single package ─────────────────────────────────────────────

  const updatePackage = useCallback(
    async (packageId: string, data: Partial<OrderPackage>) => {
      setError(null);
      try {
        const result = await apiClient.patch<{ package: OrderPackage }>(
          `/fulfillment/packages/${packageId}`,
          data,
        );
        setPackages((prev) =>
          prev.map((p) => (p.id === packageId ? result.package : p)),
        );
      } catch (err: any) {
        setError(err?.message || "Update failed");
      }
    },
    [],
  );

  // ── Add empty package ─────────────────────────────────────────────────

  const addPackage = useCallback(async () => {
    setError(null);
    try {
      const result = await apiClient.post<{ package: OrderPackage }>(
        `/fulfillment/${orderId}/packages/add`,
      );
      setPackages((prev) => [...prev, result.package]);
    } catch (err: any) {
      setError(err?.message || "Add package failed");
    }
  }, [orderId]);

  // ── Remove package ────────────────────────────────────────────────────

  const removePackage = useCallback(async (packageId: string) => {
    setError(null);
    try {
      await apiClient.delete(`/fulfillment/packages/${packageId}`);
      setPackages((prev) => prev.filter((p) => p.id !== packageId));
    } catch (err: any) {
      setError(err?.message || "Remove package failed");
    }
  }, []);

  // ── Mark all PACKED ───────────────────────────────────────────────────

  const markPacked = useCallback(
    async (
      packData: Array<{
        packageId: string;
        actualWeight: number;
        weightUnit?: string;
        length?: number;
        width?: number;
        height?: number;
      }>,
    ) => {
      setError(null);
      try {
        await apiClient.post(`/fulfillment/${orderId}/packages/pack`, {
          packages: packData,
        });
        await refresh();
      } catch (err: any) {
        setError(err?.message || "Mark packed failed");
        throw err;
      }
    },
    [orderId, refresh],
  );

  // ── Mark SHIPPED ──────────────────────────────────────────────────────

  const markShipped = useCallback(async () => {
    setError(null);
    try {
      await apiClient.post(`/fulfillment/${orderId}/packages/shipped`);
      await refresh();
    } catch (err: any) {
      setError(err?.message || "Mark shipped failed");
    }
  }, [orderId, refresh]);

  // ── Derived state ─────────────────────────────────────────────────────

  const hasPackages = packages.length > 0;
  const allPacked = hasPackages && packages.every((p) => p.status === "PACKED");
  const totalEstimatedWeight = packages.reduce(
    (sum, p) => sum + (p.actualWeight ?? p.estimatedWeight ?? 0),
    0,
  );

  return {
    packages,
    loading,
    error,
    refresh,
    recommend,
    updatePackage,
    addPackage,
    removePackage,
    markPacked,
    markShipped,
    hasPackages,
    allPacked,
    totalEstimatedWeight,
  };
}
