import { Loader2 } from "lucide-react";

interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Inline spinner
 */
export function Spinner({ size = "md", className = "" }: SpinnerProps) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };

  return (
    <Loader2
      className={`animate-spin text-blue-500 ${sizeClasses[size]} ${className}`}
    />
  );
}

interface LoadingProps {
  message?: string;
  size?: "sm" | "md" | "lg";
}

/**
 * Centered loading state (for containers)
 */
export function Loading({ message, size = "md" }: LoadingProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <Spinner size={size} />
      {message && <p className="mt-3 text-gray-500 text-sm">{message}</p>}
    </div>
  );
}

/**
 * Full page loading state
 */
export function PageLoading({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white/80 z-50">
      <div className="flex flex-col items-center">
        <Spinner size="lg" />
        <p className="mt-4 text-gray-600">{message}</p>
      </div>
    </div>
  );
}

/**
 * Skeleton loader for text
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

/**
 * Skeleton loader for cards
 */
export function CardSkeleton() {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

/**
 * Skeleton loader for table rows
 */
export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <tr className="border-border">
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className="h-6 w-full" />
        </td>
      ))}
    </tr>
  );
}
