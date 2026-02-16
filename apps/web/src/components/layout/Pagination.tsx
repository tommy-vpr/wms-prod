/**
 * Pagination Component - Fixed
 *
 * Save to: apps/web/src/components/ui/Pagination.tsx
 */

import { ChevronLeft, ChevronRight } from "lucide-react";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  className = "",
}: PaginationProps) {
  const totalPages = Math.ceil(total / pageSize);

  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const rowsOnPage = end - start + 1;

  return (
    <div className={`flex items-center justify-between ${className}`}>
      <p className="text-sm text-gray-500">
        Showing {start} to {end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className="cursor-pointer p-2 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 py-1 text-sm">
          Page {page} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className="cursor-pointer p-2 border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {/* <span className="px-2 py-1 text-sm text-gray-500">
          {rowsOnPage} rows
        </span>
        <span className="px-2 py-1 text-sm bg-green-100 text-green-700 rounded">
          {total} records
        </span> */}
      </div>
    </div>
  );
}
