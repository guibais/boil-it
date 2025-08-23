import { z } from 'zod';

export const ModuleSchema = z.object({
  description: z.string().optional(),
  origin: z.string().optional(),
  refs: z.array(z.string()).optional(),
  dependencies: z.array(z.string()).optional(),
  path: z.string().optional(),
  files: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
});

export const DefaultSchema = z.object({
  origin: z.string(),
  files: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
});

export const BoilItConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  modules: z.record(ModuleSchema),
  default: DefaultSchema.optional(),
});

export type Module = z.infer<typeof ModuleSchema>;
export type Default = z.infer<typeof DefaultSchema>;
export type BoilItConfig = z.infer<typeof BoilItConfigSchema>;
