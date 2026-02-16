import { z } from "zod";

export const IdParamSchema = z.object({
  id: z.string(),
});
export type IdParam = z.infer<typeof IdParamSchema>;

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
