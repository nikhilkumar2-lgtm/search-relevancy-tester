import { z } from 'zod';
import { MATCH_MODES } from '../../../shared/matcher.js';

const sheetSchema = z.object({
  sheet: z.string().trim().min(1, 'Sheet link or ID is required').max(500),
  tab: z.string().trim().max(200).optional().default(''),
});

export const previewSchema = sheetSchema;

const requestFields = {
  curl: z.string().min(10, 'Paste a cURL command').max(100_000),
  queryToken: z.string().min(1).max(500).default('{{QUERY}}'),
  queryJsonPath: z.string().trim().max(200).optional().default(''),
  bodyOverrides: z.record(z.any()).optional().default({}),
  responsePath: z.string().trim().max(300).default(''),
  matchField: z.string().trim().max(300).default(''),
  displayField: z.string().trim().max(300).optional().default(''),
  matchMode: z.enum(MATCH_MODES).default('normalized'),
  timeoutMs: z.coerce.number().int().min(1000).max(120_000).default(15_000),
  retries: z.coerce.number().int().min(0).max(5).default(1),
};

export const testSchema = z.object({ ...requestFields, query: z.string().min(1).max(1000) });

export const runSchema = z.object({
  ...requestFields,
  responsePath: z.string().trim().max(300),
  concurrency: z.coerce.number().int().min(1).max(20).default(3),
  delayMs: z.coerce.number().int().min(0).max(10_000).default(200),
  thresholds: z
    .object({ excellent: z.coerce.number().min(0).max(100), good: z.coerce.number().min(0).max(100), fair: z.coerce.number().min(0).max(100) })
    .refine((t) => t.excellent >= t.good && t.good >= t.fair, 'Thresholds must be descending')
    .optional(),
  writeBack: z.boolean().optional().default(false),
  sheet: sheetSchema,
});
