/**
 * Barcode Scanner Hook
 * Detects barcode scanner input (rapid keystrokes + Enter) vs normal typing.
 * Works with Zebra TC22 and any keyboard-wedge barcode scanner.
 *
 * Save to: apps/web/src/hooks/useBarcodeScanner.ts
 *
 * Usage:
 *   useBarcodeScanner({
 *     onScan: (barcode) => handleBarcode(barcode),
 *     enabled: isPickingStep,
 *   });
 *
 * The hook ignores scans when focus is on INPUT/TEXTAREA/SELECT elements,
 * so manual text inputs won't interfere with scanner detection.
 */

import { useEffect, useRef, useCallback } from "react";

interface UseBarcodeScannerOptions {
  /** Called when a valid barcode scan is detected */
  onScan: (barcode: string) => void;
  /** Enable/disable the scanner listener */
  enabled?: boolean;
  /** Minimum barcode length to accept (default: 3) */
  minLength?: number;
  /** Max ms between keystrokes to consider it a scan (default: 60) */
  maxDelay?: number;
}

export function useBarcodeScanner({
  onScan,
  enabled = true,
  minLength = 3,
  maxDelay = 60,
}: UseBarcodeScannerOptions) {
  const bufferRef = useRef("");
  const lastKeyRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when user is typing in form fields
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const now = Date.now();
      const elapsed = now - lastKeyRef.current;
      lastKeyRef.current = now;

      // If too long since last keystroke, reset buffer (human typing speed)
      if (elapsed > maxDelay && bufferRef.current.length > 0) {
        bufferRef.current = "";
      }

      // Enter = end of scan
      if (e.key === "Enter") {
        if (bufferRef.current.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          onScan(bufferRef.current.trim());
        }
        bufferRef.current = "";
        return;
      }

      // Only buffer printable single characters
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }

      // Safety timeout: clear buffer after 500ms of no keystrokes
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        bufferRef.current = "";
      }, 500);
    },
    [onScan, minLength, maxDelay],
  );

  useEffect(() => {
    if (!enabled) return;
    // Use capture phase to intercept before other handlers
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled, handleKeyDown]);
}
