/**
 * Invoice Service
 *
 * Save to: packages/domain/src/services/invoice.service.ts
 */

import { PrismaClient, Prisma } from "@wms/db";
import { randomUUID } from "crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateInvoiceInput {
  vendor: string;
  notes?: string;
  tax?: number;
  fees?: number;
  imageUrl?: string;
  imageFilename?: string;
  items: Array<{
    sku?: string; // If omitted, use generate-sku endpoint or auto-generate
    productName: string;
    quantity: number;
    unitCost?: number;
    locationId?: string;
    productVariantId?: string;
    lotNumber?: string;
    expiryDate?: string;
  }>;
  userId: string;
}

export interface UpdateInvoiceInput {
  vendor?: string;
  notes?: string;
  tax?: number;
  fees?: number;
  imageUrl?: string;
  imageFilename?: string;
  userId: string;
}

export interface AddItemInput {
  sku?: string;
  productName: string;
  quantity: number;
  unitCost?: number;
  locationId?: string;
  productVariantId?: string;
  lotNumber?: string;
  expiryDate?: string;
}

export interface UpdateItemInput {
  sku?: string;
  productName?: string;
  quantity?: number;
  unitCost?: number;
  locationId?: string | null;
  productVariantId?: string | null;
  lotNumber?: string | null;
  expiryDate?: string | null;
}

export interface InvoiceListOptions {
  status?: string[];
  vendor?: string;
  search?: string;
  limit?: number;
  offset?: number;
  userId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate sequential invoice number: INV-2026-001 */
async function generateInvoiceNumber(prisma: PrismaClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;

  const last = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });

  let seq = 1;
  if (last) {
    const parts = last.invoiceNumber.split("-");
    seq = parseInt(parts[2], 10) + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/** Auto-generate SKU from product name (fallback): "Blue Widget 30ml" → "BLUWID30-XXXX" */
function autoGenerateSku(productName: string): string {
  const clean = productName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `${clean}-${suffix}`;
}

/**
 * Generate SKU from brand + product name + year
 * e.g. ("Skwezed", "Watermelon Salt ICE 30ml", 2026) → "SKW-WTRMLNSI30-26"
 */
export function generateSkuFromParts(
  brand: string,
  productName: string,
  year?: number,
): string {
  const yr = year || new Date().getFullYear();
  const yrSuffix = String(yr).slice(-2);

  // Brand prefix: first 3 consonants or chars, uppercase
  const brandClean = brand.toUpperCase().replace(/[^A-Z]/g, "");
  const brandPrefix = brandClean.slice(0, 3) || "GEN";

  // Product: strip common words, compress, take first 10 chars
  const stopWords = ["THE", "AND", "FOR", "WITH", "SALT", "ICE"];
  const productClean = productName
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => !stopWords.includes(w) && w.length > 0)
    .join("")
    .slice(0, 10);

  return `${brandPrefix}-${productClean || "ITEM"}-${yrSuffix}`;
}

/** Generate Code128 barcode string from SKU */
function generateBarcode(sku: string): string {
  // Standard Code128 barcode value — the SKU itself is the barcode data
  // Frontend renders this with a barcode library (JsBarcode, react-barcode)
  return sku.toUpperCase().replace(/[^A-Z0-9\-]/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Response Types (explicit to avoid TS2742 Prisma inference issues)
// ─────────────────────────────────────────────────────────────────────────────

export interface InvoiceListResponse {
  invoices: InvoiceSummary[];
  total: number;
}

export interface InvoiceSummary {
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
  createdAt: Date;
  updatedAt: Date;
  itemCount: number;
}

export interface InvoiceDetail {
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
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items: InvoiceItemDetail[];
}

export interface InvoiceItemDetail {
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
  expiryDate: Date | null;
  createdAt: Date;
}

export interface InvoiceItemResponse {
  id: string;
  sequence: number;
  sku: string;
  productName: string;
  barcode: string | null;
  quantity: number;
  unitCost: number;
  totalCost: number;
  location: { id: string; name: string } | null;
}

export interface InvoiceStatusResponse {
  id: string;
  invoiceNumber: string;
  status: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class InvoiceService {
  constructor(private prisma: PrismaClient) {}

  // ─────────────────────────────────────────────────────────────────────────
  // List / Get
  // ─────────────────────────────────────────────────────────────────────────

  async list(opts: InvoiceListOptions): Promise<InvoiceListResponse> {
    const where: Prisma.InvoiceWhereInput = {};

    if (opts.status?.length) {
      where.status = { in: opts.status as any };
    }
    if (opts.vendor) {
      where.vendor = { contains: opts.vendor, mode: "insensitive" };
    }
    if (opts.search) {
      where.OR = [
        { invoiceNumber: { contains: opts.search, mode: "insensitive" } },
        { vendor: { contains: opts.search, mode: "insensitive" } },
        {
          items: {
            some: {
              OR: [
                { sku: { contains: opts.search, mode: "insensitive" } },
                { productName: { contains: opts.search, mode: "insensitive" } },
              ],
            },
          },
        },
      ];
    }

    const [invoices, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          creator: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        take: opts.limit || 50,
        skip: opts.offset || 0,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return {
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        vendor: inv.vendor,
        status: inv.status,
        imageUrl: inv.imageUrl,
        totalItems: inv.totalItems,
        totalQuantity: inv.totalQuantity,
        totalCost: Number(inv.totalCost),
        tax: Number(inv.tax),
        fees: Number(inv.fees),
        grandTotal: Number(inv.grandTotal),
        notes: inv.notes,
        createdBy: inv.creator,
        createdAt: inv.createdAt,
        updatedAt: inv.updatedAt,
        itemCount: inv._count.items,
      })),
      total,
    };
  }

  async getById(id: string): Promise<InvoiceDetail | null> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
        items: {
          include: {
            productVariant: {
              select: { id: true, sku: true, name: true, imageUrl: true },
            },
            location: {
              select: { id: true, name: true },
            },
          },
          orderBy: { sequence: "asc" },
        },
      },
    });

    if (!invoice) return null;

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendor: invoice.vendor,
      status: invoice.status,
      imageUrl: invoice.imageUrl,
      imageFilename: invoice.imageFilename,
      totalItems: invoice.totalItems,
      totalQuantity: invoice.totalQuantity,
      totalCost: Number(invoice.totalCost),
      tax: Number(invoice.tax),
      fees: Number(invoice.fees),
      grandTotal: Number(invoice.grandTotal),
      notes: invoice.notes,
      createdBy: invoice.creator,
      approvedBy: invoice.approver,
      submittedAt: invoice.submittedAt,
      approvedAt: invoice.approvedAt,
      createdAt: invoice.createdAt,
      updatedAt: invoice.updatedAt,
      items: invoice.items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        sku: item.sku,
        productName: item.productName,
        barcode: item.barcode,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        totalCost: Number(item.totalCost),
        locationId: item.locationId,
        location: item.location,
        productVariantId: item.productVariantId,
        productVariant: item.productVariant,
        lotNumber: item.lotNumber,
        expiryDate: item.expiryDate,
        createdAt: item.createdAt,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Create
  // ─────────────────────────────────────────────────────────────────────────

  async create(input: CreateInvoiceInput): Promise<{
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
    createdBy: { id: string; name: string | null };
    createdAt: Date;
    items: InvoiceItemResponse[];
  }> {
    const invoiceNumber = await generateInvoiceNumber(this.prisma);

    // Process items — auto-generate SKUs where needed
    const processedItems = input.items.map((item, idx) => {
      const sku = item.sku?.trim() || autoGenerateSku(item.productName);
      const barcode = generateBarcode(sku);
      const unitCost = item.unitCost || 0;
      const totalCost = unitCost * item.quantity;

      return {
        sequence: idx + 1,
        sku,
        productName: item.productName,
        barcode,
        quantity: item.quantity,
        unitCost,
        totalCost,
        locationId: item.locationId || undefined,
        productVariantId: item.productVariantId || undefined,
        lotNumber: item.lotNumber || undefined,
        expiryDate: item.expiryDate ? new Date(item.expiryDate) : undefined,
      };
    });

    const totalQuantity = processedItems.reduce((s, i) => s + i.quantity, 0);
    const totalCost = processedItems.reduce((s, i) => s + i.totalCost, 0);
    const tax = input.tax || 0;
    const fees = input.fees || 0;
    const grandTotal = totalCost + tax + fees;

    const invoice = await this.prisma.invoice.create({
      data: {
        invoiceNumber,
        vendor: input.vendor,
        notes: input.notes,
        imageUrl: input.imageUrl,
        imageFilename: input.imageFilename,
        totalItems: processedItems.length,
        totalQuantity,
        totalCost,
        tax,
        fees,
        grandTotal,
        createdBy: input.userId,
        items: {
          create: processedItems,
        },
      },
      include: {
        creator: { select: { id: true, name: true } },
        items: {
          include: {
            location: { select: { id: true, name: true } },
          },
          orderBy: { sequence: "asc" },
        },
      },
    });

    // Audit log
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        action: "INVOICE_CREATED",
        entityType: "Invoice",
        entityId: invoice.id,
        changes: {
          invoiceNumber,
          vendor: input.vendor,
          itemCount: processedItems.length,
          totalCost,
        },
      },
    });

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      vendor: invoice.vendor,
      status: invoice.status,
      imageUrl: invoice.imageUrl,
      totalItems: invoice.totalItems,
      totalQuantity: invoice.totalQuantity,
      totalCost: Number(invoice.totalCost),
      tax: Number(invoice.tax),
      fees: Number(invoice.fees),
      grandTotal: Number(invoice.grandTotal),
      createdBy: invoice.creator,
      createdAt: invoice.createdAt,
      items: invoice.items.map((item) => ({
        id: item.id,
        sequence: item.sequence,
        sku: item.sku,
        productName: item.productName,
        barcode: item.barcode,
        quantity: item.quantity,
        unitCost: Number(item.unitCost),
        totalCost: Number(item.totalCost),
        location: item.location,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Update invoice header
  // ─────────────────────────────────────────────────────────────────────────

  async update(
    id: string,
    input: UpdateInvoiceInput,
  ): Promise<InvoiceStatusResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(`Cannot edit invoice in ${invoice.status} status`);
    }

    const data: Prisma.InvoiceUpdateInput = {};
    if (input.vendor !== undefined) data.vendor = input.vendor;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
    if (input.imageFilename !== undefined)
      data.imageFilename = input.imageFilename;
    if (input.tax !== undefined) data.tax = input.tax;
    if (input.fees !== undefined) data.fees = input.fees;

    // Recalculate grandTotal if tax or fees changed
    if (input.tax !== undefined || input.fees !== undefined) {
      const current = await this.prisma.invoice.findUnique({
        where: { id },
        select: { totalCost: true, tax: true, fees: true },
      });
      const totalCost = Number(current?.totalCost || 0);
      const newTax = input.tax ?? Number(current?.tax || 0);
      const newFees = input.fees ?? Number(current?.fees || 0);
      data.grandTotal = totalCost + newTax + newFees;
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data,
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
    };
  }
  // ─────────────────────────────────────────────────────────────────────────

  async addItem(
    invoiceId: string,
    input: AddItemInput,
    userId: string,
  ): Promise<InvoiceItemResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(`Cannot add items to ${invoice.status} invoice`);
    }

    // Get next sequence
    const lastItem = await this.prisma.invoiceItem.findFirst({
      where: { invoiceId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    const sequence = (lastItem?.sequence || 0) + 1;

    const sku = input.sku?.trim() || autoGenerateSku(input.productName);
    const barcode = generateBarcode(sku);
    const unitCost = input.unitCost || 0;
    const totalCost = unitCost * input.quantity;

    const item = await this.prisma.invoiceItem.create({
      data: {
        invoiceId,
        sequence,
        sku,
        productName: input.productName,
        barcode,
        quantity: input.quantity,
        unitCost,
        totalCost,
        locationId: input.locationId || undefined,
        productVariantId: input.productVariantId || undefined,
        lotNumber: input.lotNumber || undefined,
        expiryDate: input.expiryDate ? new Date(input.expiryDate) : undefined,
      },
      include: {
        location: { select: { id: true, name: true } },
      },
    });

    // Recompute invoice totals
    await this.recomputeTotals(invoiceId);

    return {
      id: item.id,
      sequence: item.sequence,
      sku: item.sku,
      productName: item.productName,
      barcode: item.barcode,
      quantity: item.quantity,
      unitCost: Number(item.unitCost),
      totalCost: Number(item.totalCost),
      location: item.location,
    };
  }

  async updateItem(
    invoiceId: string,
    itemId: string,
    input: UpdateItemInput,
    userId: string,
  ): Promise<InvoiceItemResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(`Cannot edit items on ${invoice.status} invoice`);
    }

    const existing = await this.prisma.invoiceItem.findUnique({
      where: { id: itemId },
    });
    if (!existing || existing.invoiceId !== invoiceId) {
      throw new Error(`Item ${itemId} not found on invoice ${invoiceId}`);
    }

    const data: any = {};
    if (input.sku !== undefined) {
      data.sku = input.sku;
      data.barcode = generateBarcode(input.sku);
    }
    if (input.productName !== undefined) data.productName = input.productName;
    if (input.quantity !== undefined) data.quantity = input.quantity;
    if (input.unitCost !== undefined) data.unitCost = input.unitCost;
    if (input.locationId !== undefined) data.locationId = input.locationId;
    if (input.productVariantId !== undefined)
      data.productVariantId = input.productVariantId;
    if (input.lotNumber !== undefined) data.lotNumber = input.lotNumber;
    if (input.expiryDate !== undefined)
      data.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;

    // Recompute item total
    const qty = data.quantity ?? existing.quantity;
    const uc = data.unitCost ?? Number(existing.unitCost);
    data.totalCost = qty * uc;

    const updated = await this.prisma.invoiceItem.update({
      where: { id: itemId },
      data,
      include: {
        location: { select: { id: true, name: true } },
      },
    });

    await this.recomputeTotals(invoiceId);

    return {
      id: updated.id,
      sequence: updated.sequence,
      sku: updated.sku,
      productName: updated.productName,
      barcode: updated.barcode,
      quantity: updated.quantity,
      unitCost: Number(updated.unitCost),
      totalCost: Number(updated.totalCost),
      location: updated.location,
    };
  }

  async removeItem(
    invoiceId: string,
    itemId: string,
    userId: string,
  ): Promise<{ success: boolean }> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(`Cannot remove items from ${invoice.status} invoice`);
    }

    await this.prisma.invoiceItem.delete({ where: { id: itemId } });
    await this.recomputeTotals(invoiceId);

    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Status transitions
  // ─────────────────────────────────────────────────────────────────────────

  async submit(id: string, userId: string): Promise<InvoiceStatusResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true, totalItems: true },
    });

    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.status !== "DRAFT") {
      throw new Error(`Cannot submit: invoice is ${invoice.status}`);
    }
    if (invoice.totalItems === 0) {
      throw new Error("Cannot submit invoice with no items");
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "INVOICE_SUBMITTED",
        entityType: "Invoice",
        entityId: id,
        changes: { invoiceNumber: updated.invoiceNumber },
      },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
    };
  }

  async approve(id: string, userId: string): Promise<InvoiceStatusResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.status !== "SUBMITTED") {
      throw new Error(`Cannot approve: invoice is ${invoice.status}`);
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "INVOICE_APPROVED",
        entityType: "Invoice",
        entityId: id,
        changes: { invoiceNumber: updated.invoiceNumber },
      },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
    };
  }

  async reject(id: string, userId: string): Promise<InvoiceStatusResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${id} not found`);
    if (invoice.status !== "SUBMITTED") {
      throw new Error(`Cannot reject: invoice is ${invoice.status}`);
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: "REJECTED" },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "INVOICE_REJECTED",
        entityType: "Invoice",
        entityId: id,
        changes: { invoiceNumber: updated.invoiceNumber },
      },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Upload image
  // ─────────────────────────────────────────────────────────────────────────

  async uploadImage(
    id: string,
    imageUrl: string,
    filename: string,
    userId: string,
  ): Promise<InvoiceStatusResponse> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!invoice) throw new Error(`Invoice ${id} not found`);

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { imageUrl, imageFilename: filename },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        action: "INVOICE_IMAGE_UPLOADED",
        entityType: "Invoice",
        entityId: id,
        changes: { imageUrl, filename },
      },
    });

    return {
      id: updated.id,
      invoiceNumber: updated.invoiceNumber,
      status: updated.status,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────────────────────

  private async recomputeTotals(invoiceId: string): Promise<void> {
    const [agg, invoice] = await Promise.all([
      this.prisma.invoiceItem.aggregate({
        where: { invoiceId },
        _count: true,
        _sum: { quantity: true, totalCost: true },
      }),
      this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { tax: true, fees: true },
      }),
    ]);

    const totalCost = Number(agg._sum.totalCost || 0);
    const tax = Number(invoice?.tax || 0);
    const fees = Number(invoice?.fees || 0);

    await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        totalItems: agg._count,
        totalQuantity: agg._sum.quantity || 0,
        totalCost: agg._sum.totalCost || 0,
        grandTotal: totalCost + tax + fees,
      },
    });
  }
}
