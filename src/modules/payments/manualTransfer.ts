import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { PaymentSubmissionStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { recordAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, validationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import {
  DEFAULT_NIO_PER_USD,
  formatCents,
  nioCentsToUsdCents,
} from '../rates/currency.js';
import { applyStateChange } from '../shipments/service.js';

/**
 * TRANSFERENCIAS BANCARIAS MANUALES
 * =================================
 *
 * Flujo:
 *   1. El emisor crea el envio con paymentMethod=BANK_TRANSFER.
 *      Queda en AWAITING_PAYMENT y no puede avanzar.
 *   2. El emisor transfiere a la cuenta de la moneda elegida y sube
 *      una foto o PDF del comprobante.
 *   3. El envio queda en PENDING_REVIEW.
 *   4. Un ADMIN aprueba (PAID y pasa a AWAITING_PICKUP) o rechaza
 *      (REJECTED y el emisor puede volver a subir otro comprobante).
 *
 * El archivo se guarda fuera de la base; en la base solo vive el
 * nombre generado. Esto evita cargar binarios en cada consulta y
 * permite servir el comprobante solo a quien tiene permiso.
 */

const ALLOWED_PROOF_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export interface ProofUpload {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

export interface SubmitTransferInput {
  bankAccountId?: string;
  reference?: string | null;
  senderName?: string | null;
  note?: string | null;
}

export interface SubmissionActor {
  userId: string;
  roles: string[];
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function saveProof(file: ProofUpload): Promise<{ filename: string; size: number }> {
  const extension = ALLOWED_PROOF_MIME[file.mimetype];
  if (!extension) {
    throw validationError('El comprobante debe ser una imagen JPG, PNG, WEBP o un PDF');
  }
  if (file.buffer.length === 0) {
    throw validationError('El comprobante esta vacio');
  }
  if (file.buffer.length > env.paymentProofMaxBytes) {
    throw validationError(
      `El comprobante supera el limite de ${env.PAYMENT_PROOF_MAX_MB} MB`,
    );
  }

  await mkdir(env.paymentProofDir, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  await writeFile(path.join(env.paymentProofDir, filename), file.buffer, { flag: 'wx' });
  return { filename, size: file.buffer.length };
}

async function removeProof(filename: string): Promise<void> {
  try {
    await unlink(path.join(env.paymentProofDir, filename));
  } catch (error) {
    logger.warn({ filename, err: error }, 'No se pudo borrar un comprobante huerfano');
  }
}

export async function listBankAccounts(currency?: 'NIO' | 'USD') {
  return prisma.bankAccount.findMany({
    where: {
      isActive: true,
      ...(currency ? { currency } : {}),
    },
    orderBy: [{ currency: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      currency: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
      accountType: true,
      notes: true,
    },
  });
}

const SUBMISSION_SELECT = {
  id: true,
  shipmentId: true,
  status: true,
  currency: true,
  amountCents: true,
  amountNioCents: true,
  exchangeRateNioPerUsd: true,
  reference: true,
  senderName: true,
  note: true,
  proofMimeType: true,
  proofOriginalName: true,
  proofSizeBytes: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  bankAccount: {
    select: {
      id: true,
      currency: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
      accountType: true,
    },
  },
  submittedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  reviewedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  shipment: {
    select: {
      id: true,
      trackingCode: true,
      status: true,
      paymentStatus: true,
      paymentCurrency: true,
      amountCents: true,
      amountUsdCents: true,
      senderId: true,
      recipientId: true,
    },
  },
} satisfies Prisma.PaymentSubmissionSelect;

export async function getShipmentPaymentInfo(
  trackingCodeInput: string,
  actor: SubmissionActor,
) {
  const trackingCode = trackingCodeInput.toUpperCase();
  const shipment = await prisma.shipment.findUnique({
    where: { trackingCode },
    select: {
      id: true,
      trackingCode: true,
      senderId: true,
      recipientId: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      amountCents: true,
      amountUsdCents: true,
      paymentCurrency: true,
      exchangeRateNioPerUsd: true,
      currency: true,
      paidAt: true,
    },
  });

  if (!shipment) throw notFound('Envio');

  const isAdmin = actor.roles.includes('ADMIN');
  const isSender = shipment.senderId === actor.userId;
  const isParty = isSender || shipment.recipientId === actor.userId;
  if (!isParty && !isAdmin && !actor.roles.includes('OPERATOR')) {
    throw forbidden('No tienes acceso a los datos de pago de este envio');
  }

  const canManage = isSender || isAdmin;
  const exchangeRate = Number(shipment.exchangeRateNioPerUsd ?? DEFAULT_NIO_PER_USD);
  const amountUsdCents =
    shipment.amountUsdCents ?? nioCentsToUsdCents(shipment.amountCents, exchangeRate);
  const expectedAmountCents =
    shipment.paymentCurrency === 'USD' ? amountUsdCents : shipment.amountCents;

  const [submissions, bankAccounts] = await Promise.all([
    prisma.paymentSubmission.findMany({
      where: { shipmentId: shipment.id },
      select: SUBMISSION_SELECT,
      orderBy: { createdAt: 'desc' },
    }),
    canManage && shipment.paymentMethod === 'BANK_TRANSFER'
      ? listBankAccounts(shipment.paymentCurrency === 'USD' ? 'USD' : 'NIO')
      : Promise.resolve([]),
  ]);

  return {
    ...shipment,
    amountUsdCents,
    amountUsdFormatted: formatCents(amountUsdCents, 'USD'),
    amountFormatted: formatCents(shipment.amountCents, shipment.currency),
    amountPaymentFormatted: formatCents(expectedAmountCents, shipment.paymentCurrency),
    expectedAmountCents,
    exchangeRateNioPerUsd: exchangeRate,
    canManage,
    bankAccounts,
    submissions,
  };
}

export async function submitBankTransfer(
  trackingCodeInput: string,
  actor: SubmissionActor,
  input: SubmitTransferInput,
  proof: ProofUpload,
) {
  const trackingCode = trackingCodeInput.toUpperCase();
  const shipment = await prisma.shipment.findUnique({
    where: { trackingCode },
    select: {
      id: true,
      trackingCode: true,
      senderId: true,
      status: true,
      paymentMethod: true,
      paymentStatus: true,
      amountCents: true,
      amountUsdCents: true,
      paymentCurrency: true,
      exchangeRateNioPerUsd: true,
    },
  });

  if (!shipment) throw notFound('Envio');

  const isAdmin = actor.roles.includes('ADMIN');
  if (shipment.senderId !== actor.userId && !isAdmin) {
    throw forbidden('Solo el emisor puede subir el comprobante de pago');
  }
  if (shipment.paymentMethod !== 'BANK_TRANSFER') {
    throw validationError('Este envio no usa transferencia bancaria');
  }
  if (shipment.status !== 'AWAITING_PAYMENT') {
    throw conflict('El envio ya no esta esperando pago');
  }
  if (shipment.paymentStatus === 'PAID') {
    throw conflict('Este envio ya fue pagado');
  }
  if (shipment.paymentStatus === 'PENDING_REVIEW') {
    throw conflict('Ya hay un comprobante en revision para este envio');
  }
  if (shipment.amountCents <= 0) {
    throw validationError('El envio no tiene importe definido');
  }

  const bankAccount = await prisma.bankAccount.findFirst({
    where: {
      isActive: true,
      currency: shipment.paymentCurrency,
      ...(input.bankAccountId ? { id: input.bankAccountId } : {}),
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  if (!bankAccount) {
    throw validationError(
      `No hay una cuenta bancaria activa en ${shipment.paymentCurrency} para este envio`,
    );
  }

  const pending = await prisma.paymentSubmission.findFirst({
    where: { shipmentId: shipment.id, status: 'PENDING_REVIEW' },
    select: { id: true },
  });
  if (pending) throw conflict('Ya hay un comprobante en revision para este envio');

  const saved = await saveProof(proof);
  const exchangeRate = Number(shipment.exchangeRateNioPerUsd ?? DEFAULT_NIO_PER_USD);
  const amountUsdCents =
    shipment.amountUsdCents ?? nioCentsToUsdCents(shipment.amountCents, exchangeRate);
  const amountCents =
    shipment.paymentCurrency === 'USD' ? amountUsdCents : shipment.amountCents;

  let submission;
  try {
    submission = await prisma.$transaction(async (tx) => {
      // Revalidar dentro de la transaccion: dos peticiones simultaneas
      // no deben dejar dos comprobantes pendientes.
      const pendingInside = await tx.paymentSubmission.findFirst({
        where: { shipmentId: shipment.id, status: 'PENDING_REVIEW' },
        select: { id: true },
      });
      if (pendingInside) {
        throw conflict('Ya hay un comprobante en revision para este envio');
      }

      await tx.shipment.update({
        where: { id: shipment.id },
        data: { paymentStatus: 'PENDING_REVIEW' },
      });

      return tx.paymentSubmission.create({
        data: {
          shipmentId: shipment.id,
          bankAccountId: bankAccount.id,
          submittedById: actor.userId,
          status: 'PENDING_REVIEW',
          currency: shipment.paymentCurrency,
          amountCents,
          amountNioCents: shipment.amountCents,
          exchangeRateNioPerUsd: exchangeRate,
          reference: clean(input.reference),
          senderName: clean(input.senderName),
          note: clean(input.note),
          proofPath: saved.filename,
          proofMimeType: proof.mimetype,
          proofOriginalName: clean(proof.filename),
          proofSizeBytes: saved.size,
        },
        select: SUBMISSION_SELECT,
      });
    });
  } catch (error) {
    await removeProof(saved.filename);
    throw error;
  }

  await recordAudit({
    userId: actor.userId,
    action: 'PAYMENT_PROOF_SUBMITTED',
    entity: 'PaymentSubmission',
    entityId: submission.id,
    shipmentCode: shipment.trackingCode,
    metadata: {
      bankAccountId: bankAccount.id,
      currency: shipment.paymentCurrency,
      amountCents,
    },
  });

  return submission;
}

export async function listSubmissions(options: {
  status?: PaymentSubmissionStatus;
  search?: string;
  page: number;
  pageSize: number;
}) {
  const where: Prisma.PaymentSubmissionWhereInput = {
    ...(options.status ? { status: options.status } : {}),
    ...(options.search
      ? {
          OR: [
            { reference: { contains: options.search, mode: 'insensitive' } },
            { senderName: { contains: options.search, mode: 'insensitive' } },
            { shipment: { trackingCode: { contains: options.search, mode: 'insensitive' } } },
            {
              submittedBy: {
                OR: [
                  { firstName: { contains: options.search, mode: 'insensitive' } },
                  { lastName: { contains: options.search, mode: 'insensitive' } },
                  { email: { contains: options.search, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.paymentSubmission.count({ where }),
    prisma.paymentSubmission.findMany({
      where,
      select: SUBMISSION_SELECT,
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
    }),
  ]);

  return {
    data: rows,
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      total,
      totalPages: Math.ceil(total / options.pageSize),
    },
  };
}

export async function reviewSubmission(
  submissionId: string,
  actor: SubmissionActor,
  decision: 'APPROVE' | 'REJECT',
  reviewNote: string | null | undefined,
) {
  if (!actor.roles.includes('ADMIN') && !actor.roles.includes('OPERATOR')) {
    throw forbidden('Solo personal autorizado puede revisar comprobantes de pago');
  }

  const submission = await prisma.paymentSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      shipmentId: true,
      amountCents: true,
      currency: true,
      bankAccountId: true,
      shipment: {
        select: {
          id: true,
          trackingCode: true,
          status: true,
          paymentStatus: true,
        },
      },
    },
  });

  if (!submission) throw notFound('Comprobante de pago');
  if (submission.status !== 'PENDING_REVIEW') {
    throw conflict('Este comprobante ya fue revisado');
  }

  const note = clean(reviewNote);
  if (decision === 'REJECT' && !note) {
    throw validationError('Indica el motivo del rechazo');
  }

  const now = new Date();

  if (decision === 'REJECT') {
    const rejected = await prisma.$transaction(async (tx) => {
      await tx.shipment.update({
        where: { id: submission.shipmentId },
        data: { paymentStatus: 'REJECTED' },
      });
      return tx.paymentSubmission.update({
        where: { id: submission.id },
        data: {
          status: 'REJECTED',
          reviewedById: actor.userId,
          reviewedAt: now,
          reviewNote: note,
        },
        select: SUBMISSION_SELECT,
      });
    });

    await recordAudit({
      userId: actor.userId,
      action: 'PAYMENT_PROOF_REJECTED',
      entity: 'PaymentSubmission',
      entityId: submission.id,
      shipmentCode: submission.shipment.trackingCode,
      metadata: { reviewNote: note },
    });

    return rejected;
  }

  const approved = await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: submission.shipmentId },
      data: { paymentStatus: 'PAID', paidAt: now },
    });
    return tx.paymentSubmission.update({
      where: { id: submission.id },
      data: {
        status: 'APPROVED',
        reviewedById: actor.userId,
        reviewedAt: now,
        reviewNote: note,
      },
      select: SUBMISSION_SELECT,
    });
  });

  // El pago ya quedo aprobado. Mover el envio es un efecto secundario:
  // si la maquina de estados no lo permite, no se pierde la aprobacion.
  if (['AWAITING_PAYMENT', 'CONFIRMED'].includes(submission.shipment.status)) {
    try {
      await applyStateChange(submission.shipmentId, {
        to: 'AWAITING_PICKUP',
        title: 'Pago aprobado',
        description: 'El comprobante de transferencia fue aprobado por un administrador.',
        source: 'MANUAL',
        operatorId: actor.userId,
        idempotencyKey: `payment-approved:${submission.id}`,
        metadata: {
          submissionId: submission.id,
          bankAccountId: submission.bankAccountId,
          amountCents: submission.amountCents,
          currency: submission.currency,
        },
      });
    } catch (error) {
      logger.warn(
        { submissionId: submission.id, err: error },
        'Pago aprobado, pero no se pudo mover el envio a AWAITING_PICKUP',
      );
    }
  }

  await recordAudit({
    userId: actor.userId,
    action: 'PAYMENT_PROOF_APPROVED',
    entity: 'PaymentSubmission',
    entityId: submission.id,
    shipmentCode: submission.shipment.trackingCode,
    metadata: {
      bankAccountId: submission.bankAccountId,
      amountCents: submission.amountCents,
      currency: submission.currency,
      reviewNote: note,
    },
  });

  return approved;
}

export async function getProofForSubmission(
  submissionId: string,
  actor: SubmissionActor,
) {
  const submission = await prisma.paymentSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      proofPath: true,
      proofMimeType: true,
      proofOriginalName: true,
      submittedById: true,
      shipment: { select: { senderId: true, recipientId: true } },
    },
  });

  if (!submission) throw notFound('Comprobante de pago');

  const isAdmin = actor.roles.includes('ADMIN');
  const isOperator = actor.roles.includes('OPERATOR');
  const isSender = submission.shipment.senderId === actor.userId;
  const isUploader = submission.submittedById === actor.userId;

  // El receptor NO ve el comprobante: contiene datos bancarios del
  // emisor. Solo el emisor, quien lo subio, y el personal autorizado.
  if (!isAdmin && !isOperator && !isSender && !isUploader) {
    throw forbidden('No tienes acceso a este comprobante');
  }

  return {
    absolutePath: path.join(env.paymentProofDir, path.basename(submission.proofPath)),
    mimeType: submission.proofMimeType,
    originalName: submission.proofOriginalName,
  };
}
