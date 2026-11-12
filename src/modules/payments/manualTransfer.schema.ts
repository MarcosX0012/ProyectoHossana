import { z } from 'zod';

/** Campos de texto que acompanan al archivo en el multipart. */
export const submitTransferSchema = z.object({
  bankAccountId: z.string().uuid('Cuenta bancaria invalida').optional(),
  reference: z.string().trim().max(120).optional(),
  senderName: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
});

export type SubmitTransferFields = z.infer<typeof submitTransferSchema>;

export const listSubmissionsQuerySchema = z.object({
  status: z.enum(['PENDING_REVIEW', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const reviewSubmissionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).optional(),
});
