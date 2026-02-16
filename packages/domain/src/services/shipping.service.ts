/**
 * ShippingService
 * Handles ShipEngine API calls and shipping business logic
 *
 * Save to: packages/domain/src/services/shipping.service.ts
 */

import { PrismaClient, Prisma } from "@wms/db";
import { publish, EVENT_TYPES } from "@wms/pubsub";
import { randomUUID } from "crypto";

// =============================================================================
// Types
// =============================================================================

export interface ShipEngineCarrier {
  carrier_id: string;
  carrier_code: string;
  friendly_name: string;
  services: Array<{ service_code: string; name: string }>;
  packages: Array<{ package_code: string; name: string }>;
}

export interface ShippingPreset {
  id: string;
  label: string;
  carrier: "ups" | "usps";
  serviceCode: string;
  serviceName: string;
  packageType: string;
  confirmation: string;
  dimensions?: { length: number; width: number; height: number };
  isFlatRate?: boolean;
  usedBy: string[];
  purpose?: string;
}

export interface BoxDefinition {
  id: string;
  label: string;
  dimensions: { length: number; width: number; height: number };
  usedBy: string[];
  purpose?: string;
  isFlatRate?: boolean;
}

export interface PackageInput {
  packageCode: string;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
  items?: Array<{
    sku: string;
    quantity: number;
    productName?: string;
    unitPrice?: number;
  }>;
}

export interface ShippingAddress {
  name: string;
  company?: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  phone?: string;
}

export interface CreateLabelInput {
  orderId: string;
  carrierCode: string;
  serviceCode: string;
  packages: PackageInput[];
  shippingAddress?: ShippingAddress;
  notes?: string;
  items?: Array<{
    sku: string;
    quantity: number;
    productName?: string;
    unitPrice?: number;
  }>;
}

export interface LabelResult {
  packageId: string;
  trackingNumber: string;
  trackingUrl: string;
  labelUrl: string;
  cost: number;
  carrier: string;
  service: string;
}

export interface CreateLabelsResult {
  success: boolean;
  labels: LabelResult[];
  totalCost: number;
  orderId: string;
  orderNumber: string;
  shippingPackageIds: string[];
  packingImages: {
    id: string;
    url: string;
    filename: string;
    uploadedAt: Date;
    uploadedBy: string;
  }[];
}

// =============================================================================
// Shipping Presets Configuration
// =============================================================================

const SHIPPING_PRESETS: ShippingPreset[] = [
  // USPS Presets
  {
    id: "usps-priority-flat-small",
    label: "USPS Priority Flat Rate - Small Box",
    carrier: "usps",
    serviceCode: "usps_priority_mail",
    serviceName: "Priority Mail",
    packageType: "small_flat_rate_box",
    confirmation: "delivery",
    isFlatRate: true,
    dimensions: { length: 8.625, width: 5.375, height: 1.625 },
    usedBy: ["all"],
    purpose: "Small items, documents",
  },
  {
    id: "usps-priority-flat-medium",
    label: "USPS Priority Flat Rate - Medium Box",
    carrier: "usps",
    serviceCode: "usps_priority_mail",
    serviceName: "Priority Mail",
    packageType: "medium_flat_rate_box",
    confirmation: "delivery",
    isFlatRate: true,
    dimensions: { length: 11.25, width: 8.75, height: 6 },
    usedBy: ["all"],
    purpose: "Medium shipments",
  },
  {
    id: "usps-priority-flat-large",
    label: "USPS Priority Flat Rate - Large Box",
    carrier: "usps",
    serviceCode: "usps_priority_mail",
    serviceName: "Priority Mail",
    packageType: "large_flat_rate_box",
    confirmation: "delivery",
    isFlatRate: true,
    dimensions: { length: 12.25, width: 12.25, height: 6 },
    usedBy: ["all"],
    purpose: "Large shipments",
  },
  {
    id: "usps-ground-advantage",
    label: "USPS Ground Advantage",
    carrier: "usps",
    serviceCode: "usps_ground_advantage",
    serviceName: "Ground Advantage",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "Economy shipping, 2-5 days",
  },
  {
    id: "usps-priority-express",
    label: "USPS Priority Mail Express",
    carrier: "usps",
    serviceCode: "usps_priority_mail_express",
    serviceName: "Priority Mail Express",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "Overnight/2-day guaranteed",
  },
  // UPS Presets
  {
    id: "ups-ground",
    label: "UPS Ground",
    carrier: "ups",
    serviceCode: "ups_ground",
    serviceName: "UPS Ground",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "Economy, 1-5 business days",
  },
  {
    id: "ups-3day-select",
    label: "UPS 3 Day Select",
    carrier: "ups",
    serviceCode: "ups_3_day_select",
    serviceName: "3 Day Select",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "3 business days guaranteed",
  },
  {
    id: "ups-2day",
    label: "UPS 2nd Day Air",
    carrier: "ups",
    serviceCode: "ups_2nd_day_air",
    serviceName: "2nd Day Air",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "2 business days",
  },
  {
    id: "ups-next-day-saver",
    label: "UPS Next Day Air Saver",
    carrier: "ups",
    serviceCode: "ups_next_day_air_saver",
    serviceName: "Next Day Air Saver",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "Next business day by end of day",
  },
  {
    id: "ups-next-day",
    label: "UPS Next Day Air",
    carrier: "ups",
    serviceCode: "ups_next_day_air",
    serviceName: "Next Day Air",
    packageType: "package",
    confirmation: "delivery",
    usedBy: ["all"],
    purpose: "Next business day by 10:30am",
  },
];

const BOX_DEFINITIONS: BoxDefinition[] = [
  {
    id: "small-box",
    label: "Small Box (8x6x4)",
    dimensions: { length: 8, width: 6, height: 4 },
    usedBy: ["all"],
    purpose: "Small items",
  },
  {
    id: "medium-box",
    label: "Medium Box (12x10x6)",
    dimensions: { length: 12, width: 10, height: 6 },
    usedBy: ["all"],
    purpose: "Standard shipments",
  },
  {
    id: "large-box",
    label: "Large Box (18x14x10)",
    dimensions: { length: 18, width: 14, height: 10 },
    usedBy: ["all"],
    purpose: "Large shipments",
  },
  {
    id: "usps-flat-small",
    label: "USPS Small Flat Rate Box",
    dimensions: { length: 8.625, width: 5.375, height: 1.625 },
    usedBy: ["usps"],
    isFlatRate: true,
  },
  {
    id: "usps-flat-medium",
    label: "USPS Medium Flat Rate Box",
    dimensions: { length: 11.25, width: 8.75, height: 6 },
    usedBy: ["usps"],
    isFlatRate: true,
  },
  {
    id: "usps-flat-large",
    label: "USPS Large Flat Rate Box",
    dimensions: { length: 12.25, width: 12.25, height: 6 },
    usedBy: ["usps"],
    isFlatRate: true,
  },
];

// =============================================================================
// Helper Functions
// =============================================================================

function truncateReference(text: string, carrierCode: string): string {
  let maxLength = 35;
  switch (carrierCode.toLowerCase()) {
    case "ups":
      maxLength = 35;
      break;
    case "fedex":
      maxLength = 30;
      break;
    case "stamps_com":
    case "usps":
      maxLength = 50;
      break;
    default:
      maxLength = 30;
  }
  if (!text) return "";
  return text.length <= maxLength
    ? text
    : text.substring(0, maxLength - 3) + "...";
}

function validateCarrierService(
  carrier: string,
  service: string,
): string | null {
  if (carrier === "stamps_com" && service?.startsWith("ups_")) {
    return "Service code mismatch: UPS service selected with USPS carrier";
  }
  if (carrier === "ups" && service?.startsWith("usps_")) {
    return "Service code mismatch: USPS service selected with UPS carrier";
  }
  if (
    carrier === "fedex" &&
    (service?.startsWith("usps_") || service?.startsWith("ups_"))
  ) {
    return "Service code mismatch: Non-FedEx service selected with FedEx carrier";
  }
  return null;
}

function getTrackingUrl(carrierCode: string, trackingNumber: string): string {
  switch (carrierCode.toLowerCase()) {
    case "stamps_com":
    case "usps":
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    default:
      return "";
  }
}

export function getShopifyCarrierName(carrierCode: string): string {
  switch (carrierCode.toLowerCase()) {
    case "stamps_com":
    case "usps":
      return "USPS";
    case "ups":
      return "UPS";
    case "fedex":
      return "FedEx";
    default:
      return carrierCode.toUpperCase();
  }
}

function joinDedup(existing: string | null | undefined, next: string): string {
  const parts = [existing, next]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(p);
    }
  }
  return deduped.join(", ");
}

// =============================================================================
// Shipping Service
// =============================================================================

export class ShippingService {
  private apiKey: string;
  private baseUrl = "https://api.shipengine.com/v1";

  constructor(
    private prisma: PrismaClient,
    apiKey?: string,
  ) {
    this.apiKey = apiKey || process.env.SHIPENGINE_API_KEY || "";
    if (!this.apiKey) {
      console.warn("[ShippingService] No ShipEngine API key configured");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Carriers & Presets
  // ─────────────────────────────────────────────────────────────────────────────

  async getCarriersAndPresets(): Promise<{
    carriers: ShipEngineCarrier[];
    presets: ShippingPreset[];
    boxes: BoxDefinition[];
    quickAccess: ShippingPreset[];
  }> {
    if (!this.apiKey) {
      throw new Error("ShipEngine API key not configured");
    }

    try {
      const response = await fetch(`${this.baseUrl}/carriers`, {
        headers: {
          "API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`ShipEngine API error: ${response.status}`);
      }

      const data = await response.json();
      const carriers: ShipEngineCarrier[] = [];

      for (const carrier of data.carriers || []) {
        if (!["stamps_com", "ups", "fedex"].includes(carrier.carrier_code)) {
          continue;
        }

        // Get services
        const servicesResponse = await fetch(
          `${this.baseUrl}/carriers/${carrier.carrier_id}/services`,
          {
            headers: {
              "API-Key": this.apiKey,
              "Content-Type": "application/json",
            },
          },
        );

        let services: Array<{ service_code: string; name: string }> = [];
        if (servicesResponse.ok) {
          const servicesData = await servicesResponse.json();
          services = (servicesData.services || []).map((s: any) => ({
            service_code: s.service_code,
            name: s.name,
          }));
        }

        // Get packages
        const packagesResponse = await fetch(
          `${this.baseUrl}/carriers/${carrier.carrier_id}/packages`,
          {
            headers: {
              "API-Key": this.apiKey,
              "Content-Type": "application/json",
            },
          },
        );

        let packages: Array<{ package_code: string; name: string }> = [];
        if (packagesResponse.ok) {
          const packagesData = await packagesResponse.json();
          packages = (packagesData.packages || []).map((p: any) => ({
            package_code: p.package_code,
            name: p.name,
          }));
        }

        carriers.push({
          carrier_id: carrier.carrier_id,
          carrier_code: carrier.carrier_code,
          friendly_name: carrier.friendly_name,
          services,
          packages,
        });
      }

      const quickAccess = SHIPPING_PRESETS.filter((p) =>
        [
          "usps-priority-flat-medium",
          "usps-ground-advantage",
          "ups-ground",
          "ups-2day",
        ].includes(p.id),
      );

      return {
        carriers,
        presets: SHIPPING_PRESETS,
        boxes: BOX_DEFINITIONS,
        quickAccess,
      };
    } catch (error) {
      console.error("[ShippingService] Failed to load carriers:", error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Create Shipping Labels
  // ─────────────────────────────────────────────────────────────────────────────

  async createLabels(
    input: CreateLabelInput,
    userId?: string,
  ): Promise<CreateLabelsResult> {
    const correlationId = randomUUID();
    const {
      orderId,
      carrierCode,
      serviceCode,
      packages,
      shippingAddress,
      items,
      notes,
    } = input;

    console.log(
      `[ShippingService] Creating labels for order ${orderId}, correlationId=${correlationId}`,
    );

    // Validate carrier/service
    const validationError = validateCarrierService(carrierCode, serviceCode);
    if (validationError) {
      throw new Error(validationError);
    }

    // Load order
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            productVariant: true,
          },
        },
        packingImages: true,
      },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (!["PACKED", "SHIPPED", "PARTIALLY_SHIPPED"].includes(order.status)) {
      throw new Error("Order must be packed before shipping");
    }

    // ✅ HARD GATE: packing images required
    if (order.packingImages.length === 0) {
      throw new Error(
        `Order ${order.orderNumber} cannot be shipped without packing images`,
      );
    }

    // Build addresses
    const warehouseAddress = {
      name: process.env.WAREHOUSE_NAME || "WMS Warehouse",
      company_name: process.env.WAREHOUSE_COMPANY || "Your Company",
      address_line1: process.env.WAREHOUSE_ADDRESS1 || "123 Warehouse St",
      city_locality: process.env.WAREHOUSE_CITY || "Los Angeles",
      state_province: process.env.WAREHOUSE_STATE || "CA",
      postal_code: process.env.WAREHOUSE_ZIP || "90210",
      country_code: "US",
      phone: process.env.WAREHOUSE_PHONE || "555-123-4567",
    };

    const addr = shippingAddress || (order.shippingAddress as any);
    if (!addr) {
      throw new Error("Shipping address is required");
    }

    const customerAddress = {
      name: addr.name || order.customerName || "Customer",
      company_name: addr.company || undefined,
      address_line1: addr.address1 || addr.addressLine1,
      address_line2: addr.address2 || addr.addressLine2 || undefined,
      city_locality: addr.city,
      state_province:
        addr.province_code || addr.province || addr.state || addr.stateProvince,
      postal_code: addr.zip || addr.postalCode,
      country_code:
        addr.country_code || addr.countryCode || addr.country || "US",
      phone: addr.phone || "555-123-4567",
      address_residential_indicator: "yes" as const,
    };

    if (
      !customerAddress.address_line1 ||
      !customerAddress.city_locality ||
      !customerAddress.state_province ||
      !customerAddress.postal_code
    ) {
      throw new Error("Incomplete shipping address - missing required fields");
    }

    // Determine if we need separate labels (USPS multi-package)
    const needsSeparateLabels =
      carrierCode === "stamps_com" && packages.length > 1;

    let allLabelPackages: any[] = [];
    let totalShipmentCost = 0;

    if (needsSeparateLabels) {
      // USPS: Create separate labels in parallel
      console.log(
        `[ShippingService] Creating ${packages.length} separate USPS labels`,
      );

      const labelPromises = packages.map(async (pkg, i) => {
        const shipment = {
          carrier_code: carrierCode,
          service_code: serviceCode,
          ship_from: warehouseAddress,
          ship_to: customerAddress,
          packages: [
            {
              package_code: pkg.packageCode || "package",
              weight: { value: pkg.weight, unit: "ounce" },
              dimensions: pkg.length
                ? {
                    length: pkg.length,
                    width: pkg.width,
                    height: pkg.height,
                    unit: "inch",
                  }
                : undefined,
            },
          ],
          advanced_options: { custom_field1: order.orderNumber || orderId },
        };

        const response = await fetch(`${this.baseUrl}/labels`, {
          method: "POST",
          headers: {
            "API-Key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            shipment,
            label_format: "pdf",
            label_layout: "4x6",
            label_download_type: "url",
          }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(
            `USPS label ${i + 1} failed: ${response.status} - ${err?.message || response.statusText}`,
          );
        }

        const label = await response.json();
        return {
          label,
          tracking_number: label.tracking_number,
          label_download: label.label_download,
          cost: label.shipment_cost?.amount || 0,
          items: pkg.items || [],
          pkg,
        };
      });

      const results = await Promise.allSettled(labelPromises);
      const successes = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<any>).value);

      if (successes.length === 0) {
        const failures = results.filter((r) => r.status === "rejected");
        throw new Error(
          `All label creations failed: ${(failures[0] as any)?.reason?.message}`,
        );
      }

      allLabelPackages = successes;
      totalShipmentCost = successes.reduce((sum, s) => sum + s.cost, 0);
    } else {
      // UPS/FedEx: Single multi-package shipment
      console.log(
        `[ShippingService] Creating single ${carrierCode.toUpperCase()} shipment with ${packages.length} package(s)`,
      );

      const shipment = {
        carrier_code: carrierCode,
        service_code: serviceCode,
        ship_from: warehouseAddress,
        ship_to: customerAddress,
        packages: packages.map((pkg, idx) => ({
          package_code: pkg.packageCode || "package",
          weight: {
            value: Math.max(pkg.weight || 1, 0.1),
            unit: "pound" as const,
          },
          dimensions: {
            unit: "inch" as const,
            length: Math.max(pkg.length || 10, 1),
            width: Math.max(pkg.width || 8, 1),
            height: Math.max(pkg.height || 6, 1),
          },
          label_messages: {
            reference1: truncateReference(order.orderNumber, carrierCode),
            reference2: truncateReference(
              notes || `Package ${idx + 1} of ${packages.length}`,
              carrierCode,
            ),
          },
        })),
      };

      const response = await fetch(`${this.baseUrl}/labels`, {
        method: "POST",
        headers: {
          "API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          shipment,
          label_format: "pdf",
          label_layout: "4x6",
          label_download_type: "url",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `ShipEngine API Error: ${response.status} - ${errorData?.message || response.statusText}`,
        );
      }

      const label = await response.json();
      totalShipmentCost = label.shipment_cost?.amount || 0;

      // Handle multi-package responses
      // UPS/FedEx: parent has tracking_number + label_download,
      // children may or may not have their own tracking numbers.
      const labelPackages = label.packages || label.children || [];
      if (labelPackages.length === 0 || !labelPackages[0]?.tracking_number) {
        // No child packages OR children lack tracking — use parent for all
        // UPS multi-package returns one label PDF + one master tracking for all packages
        allLabelPackages = packages.map((pkg, idx) => ({
          tracking_number:
            labelPackages[idx]?.tracking_number ||
            (packages.length === 1
              ? label.tracking_number
              : `${label.tracking_number}-${idx + 1}`),
          label_download:
            labelPackages[idx]?.label_download || label.label_download,
          cost: totalShipmentCost / packages.length,
          pkg,
          items: pkg.items || [],
        }));
      } else {
        // Children have their own tracking (some carriers)
        allLabelPackages = labelPackages.map((lp: any, idx: number) => ({
          tracking_number: lp.tracking_number || label.tracking_number,
          label_download: lp.label_download || label.label_download,
          cost: totalShipmentCost / labelPackages.length,
          pkg: packages[idx] || packages[0],
          items: packages[idx]?.items || [],
        }));
      }
    }

    if (allLabelPackages.length === 0) {
      throw new Error("No labels were created");
    }

    console.log(
      `[ShippingService] Created ${allLabelPackages.length} label(s), total cost: $${totalShipmentCost.toFixed(2)}`,
    );
    // Debug: log what each package got mapped to
    allLabelPackages.forEach((lp, idx) => {
      console.log(
        `[ShippingService]   Package ${idx + 1}: tracking=${lp.tracking_number || "NONE"}, labelUrl=${lp.label_download?.pdf ? "YES" : "NO"}`,
      );
    });

    const allTrackingNumbers = allLabelPackages
      .map((lp) => lp.tracking_number)
      .filter(Boolean)
      .join(", ");

    // ─── Database Transaction ──────────────────────────────────────────────
    const result = await this.prisma.$transaction(async (tx) => {
      // 1️⃣ Create ShippingPackage records
      const shippingPackages = await Promise.all(
        allLabelPackages.map((lp, idx) => {
          const originalPkg = lp.pkg || packages[idx] || packages[0];
          return tx.shippingPackage.create({
            data: {
              orderId: order.id,
              carrierCode,
              serviceCode,
              packageCode: originalPkg.packageCode || "package",
              trackingNumber: lp.tracking_number,
              labelUrl: lp.label_download?.pdf || lp.label_download?.href,
              cost: new Prisma.Decimal(lp.cost),
              currency: "USD",
              weight: new Prisma.Decimal(originalPkg.weight || 1),
              dimensions: {
                length: originalPkg.length || 10,
                width: originalPkg.width || 8,
                height: originalPkg.height || 6,
                unit: "inch",
              },
              items: {
                create: (lp.items || []).map((item: any) => ({
                  productName: item.productName || item.sku,
                  sku: item.sku,
                  quantity: item.quantity,
                  unitPrice: new Prisma.Decimal(item.unitPrice || 0),
                })),
              },
            },
          });
        }),
      );

      // 2️⃣ Consume inventory via PICKED allocations (only place decrement happens)

      // Safety net: promote any remaining ALLOCATED → PICKED
      // (handles edge cases where pick confirmation didn't update allocation status)
      await tx.allocation.updateMany({
        where: {
          orderItem: { orderId: order.id },
          status: "ALLOCATED",
        },
        data: {
          status: "PICKED",
          pickedAt: new Date(),
        },
      });

      // Derive shipped items from packages (primary) or top-level items (legacy fallback)
      const shippedItems: Array<{ sku: string; quantity: number }> = [];

      // Collect from package items first
      for (const lp of allLabelPackages) {
        for (const item of lp.items || []) {
          const existing = shippedItems.find((si) => si.sku === item.sku);
          if (existing) {
            existing.quantity += item.quantity;
          } else {
            shippedItems.push({ sku: item.sku, quantity: item.quantity });
          }
        }
      }

      // Fallback: top-level items or all order items
      if (shippedItems.length === 0) {
        const fallback =
          items && items.length > 0
            ? items
            : order.items.map((oi) => ({
                sku: oi.productVariant?.sku || oi.sku,
                quantity: oi.quantity,
              }));
        shippedItems.push(...fallback);
      }

      for (const shippedItem of shippedItems) {
        const orderItem = order.items.find(
          (oi) => oi.productVariant?.sku === shippedItem.sku,
        );
        if (!orderItem) continue;

        let remaining = shippedItem.quantity;

        const allocations = await tx.allocation.findMany({
          where: {
            orderItemId: orderItem.id,
            status: "PICKED",
          },
          orderBy: { allocatedAt: "asc" },
        });

        for (const alloc of allocations) {
          if (remaining <= 0) break;

          const consumeQty = Math.min(alloc.quantity, remaining);

          await tx.inventoryUnit.update({
            where: { id: alloc.inventoryUnitId },
            data: { quantity: { decrement: consumeQty } },
          });

          remaining -= consumeQty;
        }

        // ✅ Hard fail if you tried to ship more than was picked
        if (remaining > 0) {
          throw new Error(
            `Cannot ship ${shippedItem.quantity} of ${shippedItem.sku}: only ${
              shippedItem.quantity - remaining
            } PICKED`,
          );
        }

        // ✅ Track shipped qty on the order item
        await tx.orderItem.update({
          where: { id: orderItem.id },
          data: {
            quantityShipped: { increment: shippedItem.quantity },
          },
        });
      }

      // 2️⃣b Close all PICKED allocations for this order (AFTER all items consumed)
      await tx.allocation.updateMany({
        where: {
          orderItem: {
            orderId: order.id,
          },
          status: "PICKED",
        },
        data: {
          status: "RELEASED",
          releasedAt: new Date(),
        },
      });

      // 3️⃣ Update order
      const updatedOrder = await tx.order.update({
        where: { id: order.id },
        data: {
          status: "SHIPPED",
          trackingNumber: joinDedup(order.trackingNumber, allTrackingNumbers),
          shippedAt: new Date(),
        },
      });

      // 4️⃣ Persist fulfillment event (DB source of truth)
      await tx.fulfillmentEvent.create({
        data: {
          orderId: order.id,
          type: EVENT_TYPES.SHIPPING_LABEL_CREATED,
          payload: {
            carrier: carrierCode,
            service: serviceCode,
            trackingNumbers: allTrackingNumbers.split(", ").filter(Boolean),
            totalCost: totalShipmentCost,
            packageCount: allLabelPackages.length,
          },
          correlationId,
          userId,
        },
      });

      return { shippingPackages, updatedOrder };
    });

    // Publish real-time event (optional - won't fail if pubsub not configured)
    try {
      await publish({
        id: randomUUID(),
        type: EVENT_TYPES.SHIPPING_LABEL_CREATED,
        orderId,
        payload: {
          carrier: carrierCode,
          service: serviceCode,
          trackingNumbers: allTrackingNumbers.split(", ").filter(Boolean),
          totalCost: totalShipmentCost,
          packageCount: allLabelPackages.length,
          labels: allLabelPackages.map((lp) => ({
            trackingNumber: lp.tracking_number,
            labelUrl: lp.label_download?.pdf || lp.label_download?.href,
            trackingUrl: getTrackingUrl(carrierCode, lp.tracking_number),
          })),
        },
        correlationId,
        userId,
        timestamp: new Date().toISOString(),
      });
    } catch (pubsubError) {
      console.warn("[ShippingService] Failed to publish event:", pubsubError);
    }

    return {
      success: true,
      labels: allLabelPackages.map((lp, idx) => ({
        packageId: result.shippingPackages[idx].id,
        trackingNumber: lp.tracking_number,
        trackingUrl: getTrackingUrl(carrierCode, lp.tracking_number),
        labelUrl: lp.label_download?.pdf || lp.label_download?.href,
        cost: lp.cost,
        carrier: getShopifyCarrierName(carrierCode),
        service: serviceCode,
      })),
      totalCost: totalShipmentCost,
      orderId: order.id,
      orderNumber: order.orderNumber,

      packingImages: order.packingImages.map((img) => ({
        id: img.id,
        url: img.url,
        filename: img.filename,
        uploadedAt: img.createdAt,
        uploadedBy: img.uploadedBy,
      })),

      shippingPackageIds: result.shippingPackages.map((sp) => sp.id),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Void Label
  // ─────────────────────────────────────────────────────────────────────────────

  async voidLabel(
    labelId: string,
    packageId?: string,
    userId?: string,
  ): Promise<{ approved: boolean; message: string }> {
    const response = await fetch(`${this.baseUrl}/labels/${labelId}/void`, {
      method: "PUT",
      headers: {
        "API-Key": this.apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || response.statusText);
    }

    const data = await response.json();

    if (packageId) {
      await this.prisma.shippingPackage.update({
        where: { id: packageId },
        data: { voidedAt: new Date() },
      });
    }

    return {
      approved: data.approved || false,
      message: data.message || "",
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Track Shipment
  // ─────────────────────────────────────────────────────────────────────────────

  async trackShipment(
    carrierCode: string,
    trackingNumber: string,
  ): Promise<{
    trackingNumber: string;
    statusCode: string;
    statusDescription: string;
    events: Array<{
      occurredAt: string;
      description: string;
      city: string;
      state: string;
    }>;
  }> {
    const response = await fetch(
      `${this.baseUrl}/tracking?carrier_code=${carrierCode}&tracking_number=${trackingNumber}`,
      {
        headers: {
          "API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData?.message || response.statusText);
    }

    const data = await response.json();

    return {
      trackingNumber: data.tracking_number,
      statusCode: data.status_code,
      statusDescription: data.status_description,
      events: (data.events || []).map((event: any) => ({
        occurredAt: event.occurred_at,
        description: event.description,
        city: event.city_locality,
        state: event.state_province,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Get Order Shipping Packages
  // ─────────────────────────────────────────────────────────────────────────────

  async getOrderShippingPackages(orderId: string) {
    return this.prisma.shippingPackage.findMany({
      where: { orderId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
  }
}
