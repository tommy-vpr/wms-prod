/**
 * Receiving Service - Production Version
 *
 * Battle-tested receiving workflow with:
 * - Session locking (prevent concurrent edits)
 * - Per-scan audit trail
 * - Debounce-friendly batch updates
 * - Conflict detection (version tracking)
 * - Exception handling (damage, wrong items)
 *
 * Save to: packages/domain/src/services/receiving.service.ts
 */

import { PrismaClient, Prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface StartSessionInput {
  poId: string;
  poReference: string;
  vendor?: string;
  expectedItems: Array<{
    sku: string;
    productName: string;
    quantity: number;
    lotNumber?: string;
    expiryDate?: string;
  }>;
  userId: string;
  receivingLocationId?: string;
}

export interface ScanResult {
  success: boolean;
  scanId?: string; // Audit trail ID
  error?:
    | "UNKNOWN_BARCODE"
    | "NOT_ON_PO"
    | "SESSION_LOCKED"
    | "ALREADY_COMPLETE";
  lineId?: string;
  sku?: string;
  productName?: string;
  quantityExpected?: number;
  quantityCounted?: number;
  remaining?: number;
  imageUrl?: string | null;
  message?: string;
}

export interface BatchUpdateInput {
  lineId: string;
  quantity: number; // Can be negative for corrections
  scanIds?: string[]; // Link to scan audit records
}

export interface BatchUpdateResult {
  success: boolean;
  results: Array<{
    lineId: string;
    sku: string;
    quantityCounted: number;
    quantityExpected: number;
    remaining: number;
    variance: number;
  }>;
  version: number; // For conflict detection
}

export interface ExceptionInput {
  lineId: string;
  type: "DAMAGED" | "WRONG_ITEM" | "MISSING" | "OVERAGE";
  quantity: number;
  notes?: string;
  imageUrl?: string; // Photo evidence
}

export interface SessionResponse {
  session: {
    id: string;
    poId: string;
    poReference: string;
    vendor: string | null;
    status: string;
    version: number;
    lockedBy: { id: string; name: string | null } | null;
    lockedAt: Date | null;
    countedBy: { id: string; name: string | null } | null;
    receivingLocation: {
      id: string;
      name: string;
      barcode: string | null;
    } | null;
    putawayTask: { id: string; taskNumber: string; status: string } | null;
    createdAt: Date;
    submittedAt: Date | null;
    approvedAt: Date | null;
  };
  lineItems: Array<{
    id: string;
    sku: string;
    productName: string;
    productVariantId: string | null;
    quantityExpected: number;
    quantityCounted: number;
    quantityDamaged: number;
    remaining: number;
    variance: number | null;
    isComplete: boolean;
    isOverage: boolean;
    lotNumber: string | null;
    expiryDate: Date | null;
    generatedBarcode: string | null;
    imageUrl: string | null;
    barcodes: string[];
  }>;
  summary: {
    totalItems: number;
    itemsCounted: number;
    itemsRemaining: number;
    totalExpected: number;
    totalCounted: number;
    totalDamaged: number;
    totalRemaining: number;
    variance: number;
    progress: number;
    hasVariances: boolean;
    hasExceptions: boolean;
  };
  barcodeLookup: Record<string, { lineId: string; sku: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class ReceivingService {
  private readonly LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private prisma: PrismaClient) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────────────

  async startSession(data: StartSessionInput): Promise<SessionResponse> {
    // Check for existing active session
    const existing = await this.prisma.receivingSession.findFirst({
      where: {
        poId: data.poId,
        status: { in: ["IN_PROGRESS", "SUBMITTED"] },
      },
    });

    if (existing) {
      // Try to acquire lock or return existing
      return this.acquireLockAndReturn(existing.id, data.userId);
    }

    // Find receiving location
    const receivingLocation = data.receivingLocationId
      ? await this.prisma.location.findUnique({
          where: { id: data.receivingLocationId },
        })
      : ((await this.prisma.location.findFirst({
          where: { type: "RECEIVING" },
        })) ??
        (await this.prisma.location.findFirst({ where: { type: "STORAGE" } })));

    if (!receivingLocation) {
      throw new Error("No receiving location configured");
    }

    // Match SKUs to variants and generate barcodes if needed
    const skus = data.expectedItems.map((i) => i.sku.trim());
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: skus } },
      select: {
        id: true,
        sku: true,
        upc: true,
        barcode: true,
        name: true,
        imageUrl: true,
      },
    });
    const variantMap = new Map(variants.map((v) => [v.sku, v]));

    // Generate barcodes for variants without one
    const barcodesToGenerate: Array<{
      id: string;
      sku: string;
      barcode: string;
    }> = [];
    for (const variant of variants) {
      if (!variant.upc && !variant.barcode) {
        barcodesToGenerate.push({
          id: variant.id,
          sku: variant.sku,
          barcode: this.generateBarcode(variant.sku),
        });
      }
    }

    // Create session in transaction
    const session = await this.prisma.$transaction(async (tx) => {
      // Update barcodes
      for (const item of barcodesToGenerate) {
        await tx.productVariant.update({
          where: { id: item.id },
          data: { barcode: item.barcode },
        });
      }

      // Create session with lock
      const newSession = await tx.receivingSession.create({
        data: {
          poId: data.poId,
          poReference: data.poReference,
          vendor: data.vendor,
          status: "IN_PROGRESS",
          version: 1,
          countedBy: data.userId,
          lockedBy: data.userId,
          lockedAt: new Date(),
          receivingLocationId: receivingLocation.id,
          lineItems: {
            create: data.expectedItems.map((item) => {
              const variant = variantMap.get(item.sku.trim());
              const generated = barcodesToGenerate.find(
                (b) => b.sku === item.sku.trim(),
              );

              return {
                sku: item.sku.trim(),
                productName: item.productName || variant?.name || item.sku,
                productVariantId: variant?.id,
                quantityExpected: item.quantity,
                quantityCounted: 0,
                quantityDamaged: 0,
                lotNumber: item.lotNumber,
                expiryDate: item.expiryDate ? new Date(item.expiryDate) : null,
                generatedBarcode: generated?.barcode,
              };
            }),
          },
        },
        include: this.sessionInclude(),
      });

      // Log audit event
      await this.logAudit(tx, {
        sessionId: newSession.id,
        action: "SESSION_STARTED",
        userId: data.userId,
        data: {
          poId: data.poId,
          poReference: data.poReference,
          totalItems: data.expectedItems.length,
          totalExpected: data.expectedItems.reduce(
            (sum, i) => sum + i.quantity,
            0,
          ),
          barcodesGenerated: barcodesToGenerate.length,
        },
      });

      return newSession;
    });

    await this.emitEvent("receiving:started", {
      sessionId: session.id,
      poId: data.poId,
      poReference: data.poReference,
      userId: data.userId,
    });

    return this.buildResponse(session);
  }

  async getSession(
    sessionId: string,
    userId?: string,
  ): Promise<SessionResponse> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
      include: this.sessionInclude(),
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Refresh lock if user is accessing
    if (userId && session.status === "IN_PROGRESS") {
      await this.refreshLock(sessionId, userId);
    }

    return this.buildResponse(session);
  }

  async listSessions(opts?: {
    status?: string[];
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ sessions: any[]; total: number }> {
    const where: Prisma.ReceivingSessionWhereInput = {};

    if (opts?.status?.length) {
      where.status = { in: opts.status as any };
    }
    if (opts?.userId) {
      where.countedBy = opts.userId;
    }

    const [sessions, total] = await Promise.all([
      this.prisma.receivingSession.findMany({
        where,
        include: {
          lineItems: true,
          countedByUser: { select: { id: true, name: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: opts?.limit ?? 50,
        skip: opts?.offset ?? 0,
      }),
      this.prisma.receivingSession.count({ where }),
    ]);

    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        poId: s.poId,
        poReference: s.poReference,
        vendor: s.vendor,
        status: s.status,
        version: s.version,
        countedBy: s.countedByUser,
        createdAt: s.createdAt,
        submittedAt: s.submittedAt,
        approvedAt: s.approvedAt,
        totalItems: s.lineItems.length,
        totalExpected: s.lineItems.reduce(
          (sum, l) => sum + l.quantityExpected,
          0,
        ),
        totalCounted: s.lineItems.reduce(
          (sum, l) => sum + l.quantityCounted,
          0,
        ),
      })),
      total,
    };
  }

  async getPendingSessions(): Promise<any[]> {
    const sessions = await this.prisma.receivingSession.findMany({
      where: { status: "SUBMITTED" },
      include: {
        lineItems: true,
        countedByUser: { select: { id: true, name: true } },
        assignedToUser: { select: { id: true, name: true } },
      },
      orderBy: { submittedAt: "desc" },
    });

    return sessions.map((s) => ({
      id: s.id,
      poId: s.poId,
      poReference: s.poReference,
      vendor: s.vendor,
      status: s.status,
      submittedAt: s.submittedAt,
      totalItems: s.lineItems.length,
      totalExpected: s.lineItems.reduce(
        (sum, l) => sum + l.quantityExpected,
        0,
      ),
      totalCounted: s.lineItems.reduce((sum, l) => sum + l.quantityCounted, 0),
      totalDamaged: s.lineItems.reduce((sum, l) => sum + l.quantityDamaged, 0),
      countedByUser: s.countedByUser,
      assignedToUser: s.assignedToUser,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Scanning & Counting
  // ─────────────────────────────────────────────────────────────────────────

  async scanBarcode(
    sessionId: string,
    barcode: string,
    userId: string,
  ): Promise<ScanResult> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
      include: {
        lineItems: {
          include: { productVariant: true },
        },
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Check lock
    const lockCheck = this.checkLock(session, userId);
    if (!lockCheck.ok) {
      return {
        success: false,
        error: "SESSION_LOCKED",
        message: lockCheck.message,
      };
    }

    if (session.status !== "IN_PROGRESS") {
      return {
        success: false,
        error: "SESSION_LOCKED",
        message: `Session is ${session.status}`,
      };
    }

    // Find matching line
    const matchedLine = session.lineItems.find((line) => {
      const v = line.productVariant;
      return (
        line.sku === barcode ||
        line.generatedBarcode === barcode ||
        v?.upc === barcode ||
        v?.barcode === barcode ||
        v?.sku === barcode
      );
    });

    // Generate scan ID for audit
    const scanId = randomUUID();

    if (!matchedLine) {
      // Check if barcode exists but not on this PO
      const variant = await this.prisma.productVariant.findFirst({
        where: {
          OR: [{ upc: barcode }, { barcode }, { sku: barcode }],
        },
      });

      // Log failed scan
      await this.logAudit(this.prisma, {
        sessionId,
        action: "SCAN_FAILED",
        userId,
        scanId,
        data: {
          barcode,
          reason: variant ? "NOT_ON_PO" : "UNKNOWN_BARCODE",
          matchedSku: variant?.sku,
        },
      });

      if (variant) {
        return {
          success: false,
          scanId,
          error: "NOT_ON_PO",
          sku: variant.sku,
          productName: variant.name,
          message: `${variant.sku} is not on this PO`,
        };
      }

      return {
        success: false,
        scanId,
        error: "UNKNOWN_BARCODE",
        message: `Unknown barcode: ${barcode}`,
      };
    }

    // Log successful scan
    await this.prisma.$transaction(async (tx) => {
      await tx.receivingLine.update({
        where: { id: matchedLine.id },
        data: {
          lastScannedAt: new Date(),
          scanCount: { increment: 1 },
        },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "SCAN_SUCCESS",
        userId,
        scanId,
        data: {
          barcode,
          lineId: matchedLine.id,
          sku: matchedLine.sku,
        },
      });
    });

    return {
      success: true,
      scanId,
      lineId: matchedLine.id,
      sku: matchedLine.sku,
      productName: matchedLine.productName,
      quantityExpected: matchedLine.quantityExpected,
      quantityCounted: matchedLine.quantityCounted,
      remaining: Math.max(
        0,
        matchedLine.quantityExpected - matchedLine.quantityCounted,
      ),
      imageUrl: matchedLine.productVariant?.imageUrl,
    };
  }

  /**
   * Batch update quantities - designed for debounced frontend calls
   * Accepts multiple line updates in one call
   */
  async batchUpdateQuantities(
    sessionId: string,
    updates: BatchUpdateInput[],
    userId: string,
    expectedVersion?: number,
  ): Promise<BatchUpdateResult> {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.receivingSession.findUnique({
        where: { id: sessionId },
        include: { lineItems: true },
      });

      if (!session) {
        throw new Error("Session not found");
      }

      // Check lock
      const lockCheck = this.checkLock(session, userId);
      if (!lockCheck.ok) {
        throw new Error(lockCheck.message);
      }

      if (session.status !== "IN_PROGRESS") {
        throw new Error(`Cannot update: session is ${session.status}`);
      }

      // Optimistic locking - check version
      if (
        expectedVersion !== undefined &&
        session.version !== expectedVersion
      ) {
        throw new Error(
          `Version conflict: expected ${expectedVersion}, found ${session.version}`,
        );
      }

      const results: BatchUpdateResult["results"] = [];

      for (const update of updates) {
        const line = session.lineItems.find((l) => l.id === update.lineId);
        if (!line) {
          throw new Error(`Line ${update.lineId} not found`);
        }

        const newCount = Math.max(0, line.quantityCounted + update.quantity);
        const variance = newCount - line.quantityExpected;

        await tx.receivingLine.update({
          where: { id: update.lineId },
          data: {
            quantityCounted: newCount,
            variance,
          },
        });

        results.push({
          lineId: line.id,
          sku: line.sku,
          quantityCounted: newCount,
          quantityExpected: line.quantityExpected,
          remaining: Math.max(0, line.quantityExpected - newCount),
          variance,
        });

        // Audit each update
        await this.logAudit(tx, {
          sessionId,
          action: "QUANTITY_UPDATED",
          userId,
          data: {
            lineId: update.lineId,
            sku: line.sku,
            previousCount: line.quantityCounted,
            newCount,
            delta: update.quantity,
            scanIds: update.scanIds,
          },
        });
      }

      // Increment version
      const updatedSession = await tx.receivingSession.update({
        where: { id: sessionId },
        data: {
          version: { increment: 1 },
          lockedAt: new Date(), // Refresh lock
        },
      });

      return {
        success: true,
        results,
        version: updatedSession.version,
      };
    });
  }

  /**
   * Single quantity update - convenience wrapper for batchUpdate
   */
  async addQuantity(
    sessionId: string,
    lineId: string,
    quantity: number,
    userId: string,
  ): Promise<
    BatchUpdateResult["results"][0] & { success: boolean; version: number }
  > {
    const result = await this.batchUpdateQuantities(
      sessionId,
      [{ lineId, quantity }],
      userId,
    );

    return {
      success: true,
      version: result.version,
      ...result.results[0],
    };
  }

  /**
   * Set exact quantity (for manual correction)
   */
  async setQuantity(
    sessionId: string,
    lineId: string,
    quantity: number,
    userId: string,
  ): Promise<{
    sku: string;
    quantityCounted: number;
    quantityExpected: number;
    variance: number;
  }> {
    const line = await this.prisma.receivingLine.findUnique({
      where: { id: lineId },
      include: { session: true },
    });

    if (!line) throw new Error("Line not found");

    const lockCheck = this.checkLock(line.session, userId);
    if (!lockCheck.ok) {
      throw new Error(lockCheck.message);
    }

    if (line.session.status !== "IN_PROGRESS") {
      throw new Error(`Cannot update: session is ${line.session.status}`);
    }

    const variance = quantity - line.quantityExpected;

    await this.prisma.$transaction(async (tx) => {
      await tx.receivingLine.update({
        where: { id: lineId },
        data: { quantityCounted: Math.max(0, quantity), variance },
      });

      await tx.receivingSession.update({
        where: { id: sessionId },
        data: { version: { increment: 1 } },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "QUANTITY_SET",
        userId,
        data: {
          lineId,
          sku: line.sku,
          previousCount: line.quantityCounted,
          newCount: quantity,
        },
      });
    });

    return {
      sku: line.sku,
      quantityCounted: Math.max(0, quantity),
      quantityExpected: line.quantityExpected,
      variance,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Exceptions (Damage, Wrong Items, etc.)
  // ─────────────────────────────────────────────────────────────────────────

  async recordException(
    sessionId: string,
    input: ExceptionInput,
    userId: string,
  ): Promise<void> {
    const line = await this.prisma.receivingLine.findUnique({
      where: { id: input.lineId },
      include: { session: true },
    });

    if (!line) throw new Error("Line not found");

    const lockCheck = this.checkLock(line.session, userId);
    if (!lockCheck.ok) {
      throw new Error(lockCheck.message);
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.type === "DAMAGED") {
        await tx.receivingLine.update({
          where: { id: input.lineId },
          data: { quantityDamaged: { increment: input.quantity } },
        });
      }

      await tx.receivingException.create({
        data: {
          sessionId,
          lineId: input.lineId,
          type: input.type,
          quantity: input.quantity,
          notes: input.notes,
          imageUrl: input.imageUrl,
          reportedBy: userId,
        },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "EXCEPTION_RECORDED",
        userId,
        data: { ...input },
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Workflow: Submit, Approve, Reject
  // ─────────────────────────────────────────────────────────────────────────

  async submitForApproval(
    sessionId: string,
    userId: string,
    assignedTo?: string,
  ): Promise<{ id: string; status: string; submittedAt: Date | null }> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
      include: { lineItems: true },
    });

    if (!session) throw new Error("Session not found");

    const lockCheck = this.checkLock(session, userId);
    if (!lockCheck.ok) {
      throw new Error(lockCheck.message);
    }

    if (session.status !== "IN_PROGRESS") {
      throw new Error(`Cannot submit: session is ${session.status}`);
    }

    const totalCounted = session.lineItems.reduce(
      (sum, l) => sum + l.quantityCounted,
      0,
    );
    if (totalCounted === 0) {
      throw new Error("Cannot submit: no items counted");
    }

    // Validate assignee if provided
    if (assignedTo) {
      const approver = await this.prisma.user.findUnique({
        where: { id: assignedTo },
        select: { role: true },
      });
      if (!approver || !["ADMIN", "MANAGER"].includes(approver.role)) {
        throw new Error("Assigned approver must be Admin or Manager");
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.receivingSession.update({
        where: { id: sessionId },
        data: {
          status: "SUBMITTED",
          submittedAt: new Date(),
          assignedTo,
          lockedBy: null, // Release lock
          lockedAt: null,
        },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "SESSION_SUBMITTED",
        userId,
        data: {
          totalItems: session.lineItems.length,
          totalCounted,
          assignedTo,
        },
      });

      return result;
    });

    await this.emitEvent("receiving:submitted", {
      sessionId,
      poReference: session.poReference,
      userId,
      assignedTo,
    });

    return {
      id: updated.id,
      status: updated.status,
      submittedAt: updated.submittedAt,
    };
  }

  async approve(
    sessionId: string,
    approverId: string,
  ): Promise<{
    session: { id: string; status: string; approvedAt: Date | null };
    inventoryCreated: Array<{
      sku: string;
      quantity: number;
      inventoryUnitId: string;
    }>;
    putawayTask: { id: string; taskNumber: string };
  }> {
    return this.prisma.$transaction(
      async (tx) => {
        const session = await tx.receivingSession.findUnique({
          where: { id: sessionId },
          include: {
            lineItems: { include: { productVariant: true } },
            receivingLocation: true,
          },
        });

        if (!session) throw new Error("Session not found");
        if (session.status !== "SUBMITTED") {
          throw new Error(`Cannot approve: session is ${session.status}`);
        }
        if (!session.receivingLocation) {
          throw new Error("No receiving location configured");
        }

        const inventoryCreated: Array<{
          sku: string;
          quantity: number;
          inventoryUnitId: string;
        }> = [];

        // Create/update inventory for each line
        for (const line of session.lineItems) {
          if (line.quantityCounted <= 0 || !line.productVariantId) continue;

          // Only add good quantity (total - damaged)
          const goodQuantity = line.quantityCounted - line.quantityDamaged;
          if (goodQuantity <= 0) continue;

          const existingUnit = await tx.inventoryUnit.findFirst({
            where: {
              productVariantId: line.productVariantId,
              locationId: session.receivingLocation.id,
              lotNumber: line.lotNumber,
            },
          });

          let unit;
          if (existingUnit) {
            unit = await tx.inventoryUnit.update({
              where: { id: existingUnit.id },
              data: {
                quantity: { increment: goodQuantity },
                status: "AVAILABLE",
              },
            });
          } else {
            unit = await tx.inventoryUnit.create({
              data: {
                productVariantId: line.productVariantId,
                locationId: session.receivingLocation.id,
                quantity: goodQuantity,
                status: "AVAILABLE",
                lotNumber: line.lotNumber,
                expiryDate: line.expiryDate,
                receivedFrom: `PO:${session.poReference}`,
              },
            });
          }

          inventoryCreated.push({
            sku: line.sku,
            quantity: goodQuantity,
            inventoryUnitId: unit.id,
          });

          // Log inventory event
          await tx.fulfillmentEvent.create({
            data: {
              type: "inventory:received",
              payload: {
                productVariantId: line.productVariantId,
                sku: line.sku,
                locationId: session.receivingLocation.id,
                quantity: goodQuantity,
                referenceType: "PURCHASE_ORDER",
                referenceId: session.poId,
                poReference: session.poReference,
                inventoryUnitId: unit.id,
                userId: approverId,
              },
            },
          });
        }

        // Create put-away task
        const taskNumber = `PUTAWAY-${session.poReference}-${Date.now().toString(36).toUpperCase()}`;

        const putawayTask = await tx.workTask.create({
          data: {
            taskNumber,
            type: "PUTAWAY",
            status: "PENDING",
            priority: 50,
            totalItems: inventoryCreated.length,
            completedItems: 0,
            totalOrders: 0,
            completedOrders: 0,
            orderIds: [],
            notes: `Put-away for PO ${session.poReference}`,
          },
        });

        // Create task items
        for (let idx = 0; idx < inventoryCreated.length; idx++) {
          const item = inventoryCreated[idx];
          const line = session.lineItems.find((l) => l.sku === item.sku);

          await tx.taskItem.create({
            data: {
              taskId: putawayTask.id,
              productVariantId: line!.productVariantId!,
              locationId: session.receivingLocation.id,
              quantityRequired: item.quantity,
              quantityCompleted: 0,
              sequence: idx + 1,
              status: "PENDING",
            },
          });
        }

        // Update session
        const updatedSession = await tx.receivingSession.update({
          where: { id: sessionId },
          data: {
            status: "APPROVED",
            approvedBy: approverId,
            approvedAt: new Date(),
            putawayTaskId: putawayTask.id,
          },
        });

        await this.logAudit(tx, {
          sessionId,
          action: "SESSION_APPROVED",
          userId: approverId,
          data: {
            itemsReceived: inventoryCreated.length,
            unitsReceived: inventoryCreated.reduce(
              (sum, i) => sum + i.quantity,
              0,
            ),
            putawayTaskId: putawayTask.id,
            putawayTaskNumber: putawayTask.taskNumber,
          },
        });

        return {
          session: {
            id: updatedSession.id,
            status: updatedSession.status,
            approvedAt: updatedSession.approvedAt,
          },
          inventoryCreated,
          putawayTask: {
            id: putawayTask.id,
            taskNumber: putawayTask.taskNumber,
          },
        };
      },
      { timeout: 60000 },
    );
  }

  async reject(
    sessionId: string,
    approverId: string,
    reason: string,
  ): Promise<{ id: string; status: string; rejectionReason: string | null }> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new Error("Session not found");
    if (session.status !== "SUBMITTED") {
      throw new Error(`Cannot reject: session is ${session.status}`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.receivingSession.update({
        where: { id: sessionId },
        data: {
          status: "REJECTED",
          approvedBy: approverId,
          approvedAt: new Date(),
          rejectionReason: reason,
        },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "SESSION_REJECTED",
        userId: approverId,
        data: { reason },
      });

      return result;
    });

    await this.emitEvent("receiving:rejected", {
      sessionId,
      poReference: session.poReference,
      reason,
    });

    return {
      id: updated.id,
      status: updated.status,
      rejectionReason: updated.rejectionReason,
    };
  }

  /**
   * Reopen a rejected session for re-counting
   */
  async reopenSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionResponse> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) throw new Error("Session not found");
    if (session.status !== "REJECTED") {
      throw new Error(`Cannot reopen: session is ${session.status}`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.receivingSession.update({
        where: { id: sessionId },
        data: {
          status: "IN_PROGRESS",
          lockedBy: userId,
          lockedAt: new Date(),
          rejectionReason: null,
          approvedBy: null,
          approvedAt: null,
          submittedAt: null,
        },
      });

      await this.logAudit(tx, {
        sessionId,
        action: "SESSION_REOPENED",
        userId,
      });
    });

    return this.getSession(sessionId, userId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Locking
  // ─────────────────────────────────────────────────────────────────────────

  private checkLock(
    session: any,
    userId: string,
  ): { ok: boolean; message?: string } {
    if (!session.lockedBy) {
      return { ok: true };
    }

    if (session.lockedBy === userId) {
      return { ok: true };
    }

    // Check if lock expired
    if (session.lockedAt) {
      const lockAge = Date.now() - new Date(session.lockedAt).getTime();
      if (lockAge > this.LOCK_TIMEOUT_MS) {
        return { ok: true }; // Lock expired, can take over
      }
    }

    return {
      ok: false,
      message: `Session is locked by another user`,
    };
  }

  private async refreshLock(sessionId: string, userId: string): Promise<void> {
    await this.prisma.receivingSession.update({
      where: { id: sessionId },
      data: {
        lockedBy: userId,
        lockedAt: new Date(),
      },
    });
  }

  private async acquireLockAndReturn(
    sessionId: string,
    userId: string,
  ): Promise<SessionResponse> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
      include: this.sessionInclude(),
    });

    if (!session) throw new Error("Session not found");

    const lockCheck = this.checkLock(session, userId);
    if (!lockCheck.ok) {
      // Return session anyway but with lock info
      return this.buildResponse(session);
    }

    // Acquire lock
    await this.refreshLock(sessionId, userId);
    session.lockedBy = userId;
    session.lockedAt = new Date();

    return this.buildResponse(session);
  }

  async releaseLock(sessionId: string, userId: string): Promise<void> {
    const session = await this.prisma.receivingSession.findUnique({
      where: { id: sessionId },
    });

    if (session?.lockedBy === userId) {
      await this.prisma.receivingSession.update({
        where: { id: sessionId },
        data: { lockedBy: null, lockedAt: null },
      });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private sessionInclude() {
    return {
      lineItems: {
        include: {
          productVariant: {
            select: {
              id: true,
              sku: true,
              upc: true,
              barcode: true,
              name: true,
              imageUrl: true,
            },
          },
        },
        orderBy: { sku: "asc" as const },
      },
      receivingLocation: { select: { id: true, name: true, barcode: true } },
      countedByUser: { select: { id: true, name: true } },
      lockedByUser: { select: { id: true, name: true } },
      assignedToUser: { select: { id: true, name: true } },
      approvedByUser: { select: { id: true, name: true } },
      putawayTask: { select: { id: true, taskNumber: true, status: true } },
    };
  }

  private buildResponse(session: any): SessionResponse {
    const barcodeLookup: Record<string, { lineId: string; sku: string }> = {};

    for (const line of session.lineItems) {
      const barcodes = [line.sku];
      if (line.generatedBarcode) barcodes.push(line.generatedBarcode);
      if (line.productVariant?.upc) barcodes.push(line.productVariant.upc);
      if (line.productVariant?.barcode)
        barcodes.push(line.productVariant.barcode);

      for (const bc of barcodes) {
        barcodeLookup[bc] = { lineId: line.id, sku: line.sku };
      }
    }

    const totalExpected = session.lineItems.reduce(
      (sum: number, l: any) => sum + l.quantityExpected,
      0,
    );
    const totalCounted = session.lineItems.reduce(
      (sum: number, l: any) => sum + l.quantityCounted,
      0,
    );
    const totalDamaged = session.lineItems.reduce(
      (sum: number, l: any) => sum + (l.quantityDamaged || 0),
      0,
    );
    const itemsCounted = session.lineItems.filter(
      (l: any) => l.quantityCounted > 0,
    ).length;

    return {
      session: {
        id: session.id,
        poId: session.poId,
        poReference: session.poReference,
        vendor: session.vendor,
        status: session.status,
        version: session.version,
        lockedBy: session.lockedByUser,
        lockedAt: session.lockedAt,
        countedBy: session.countedByUser,
        receivingLocation: session.receivingLocation,
        putawayTask: session.putawayTask,
        createdAt: session.createdAt,
        submittedAt: session.submittedAt,
        approvedAt: session.approvedAt,
      },
      lineItems: session.lineItems.map((line: any) => ({
        id: line.id,
        sku: line.sku,
        productName: line.productName,
        productVariantId: line.productVariantId,
        quantityExpected: line.quantityExpected,
        quantityCounted: line.quantityCounted,
        quantityDamaged: line.quantityDamaged || 0,
        remaining: Math.max(0, line.quantityExpected - line.quantityCounted),
        variance: line.variance,
        isComplete: line.quantityCounted >= line.quantityExpected,
        isOverage: line.quantityCounted > line.quantityExpected,
        lotNumber: line.lotNumber,
        expiryDate: line.expiryDate,
        generatedBarcode: line.generatedBarcode,
        imageUrl: line.productVariant?.imageUrl || null,
        barcodes: [
          line.sku,
          line.generatedBarcode,
          line.productVariant?.upc,
          line.productVariant?.barcode,
        ].filter(Boolean),
      })),
      summary: {
        totalItems: session.lineItems.length,
        itemsCounted,
        itemsRemaining: session.lineItems.length - itemsCounted,
        totalExpected,
        totalCounted,
        totalDamaged,
        totalRemaining: Math.max(0, totalExpected - totalCounted),
        variance: totalCounted - totalExpected,
        progress:
          totalExpected > 0
            ? Math.round((totalCounted / totalExpected) * 100)
            : 0,
        hasVariances: session.lineItems.some(
          (l: any) => l.variance !== 0 && l.variance !== null,
        ),
        hasExceptions: totalDamaged > 0,
      },
      barcodeLookup,
    };
  }

  private generateBarcode(sku: string): string {
    const hash = Buffer.from(sku)
      .toString("base64")
      .slice(0, 6)
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "X");
    const random = randomUUID().slice(0, 4).toUpperCase();
    return `WMS-${hash}-${random}`;
  }

  private async logAudit(
    tx: Prisma.TransactionClient | PrismaClient,
    data: {
      sessionId: string;
      action: string;
      userId?: string;
      scanId?: string;
      data?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        entityType: "ReceivingSession",
        entityId: data.sessionId,
        action: data.action,
        userId: data.userId,
        changes: {
          ...data.data,
          scanId: data.scanId,
          timestamp: new Date().toISOString(),
        },
      },
    });
  }

  private async emitEvent(
    type: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event = {
      id: randomUUID(),
      type: type as any,
      payload,
      timestamp: new Date().toISOString(),
    };

    await this.prisma.fulfillmentEvent.create({
      data: {
        id: event.id,
        type: event.type,
        payload: event.payload as any,
      },
    });

    try {
      await publish(event);
    } catch (err) {
      console.error("[ReceivingService] Pub/sub failed:", err);
    }
  }
}
