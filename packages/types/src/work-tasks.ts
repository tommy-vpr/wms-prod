import { z } from "zod";

export const WorkTaskType = {
  PICKING: "PICKING",
  PACKING: "PACKING",
  SHIPPING: "SHIPPING",
  QC: "QC",
} as const;
export type WorkTaskType = (typeof WorkTaskType)[keyof typeof WorkTaskType];

export const WorkTaskStatus = {
  PENDING: "PENDING",
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
} as const;
export type WorkTaskStatus = (typeof WorkTaskStatus)[keyof typeof WorkTaskStatus];

export const CreateWorkTaskSchema = z.object({
  type: z.enum(["PICKING", "PACKING", "SHIPPING", "QC"]),
  orderIds: z.array(z.string()).min(1),
  priority: z.number().int().min(0).max(100).default(0),
  assignedTo: z.string().optional(),
  notes: z.string().optional(),
  idempotencyKey: z.string().optional(),
});
export type CreateWorkTaskInput = z.infer<typeof CreateWorkTaskSchema>;

export const UpdateWorkTaskSchema = z.object({
  status: z.enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  assignedTo: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  notes: z.string().optional(),
});
export type UpdateWorkTaskInput = z.infer<typeof UpdateWorkTaskSchema>;

export const ListWorkTasksQuerySchema = z.object({
  type: z.enum(["PICKING", "PACKING", "SHIPPING", "QC"]).optional(),
  status: z.enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "PAUSED", "COMPLETED", "CANCELLED"]).optional(),
  assignedTo: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});
export type ListWorkTasksQuery = z.infer<typeof ListWorkTasksQuerySchema>;
