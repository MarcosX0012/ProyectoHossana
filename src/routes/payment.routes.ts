import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound, forbidden, validationError } from '../lib/errors.js';
import { createPaymentSession, paymentsEnabled, recordCashOnDelivery } from '../modules/payments/stripe.js';
import {
  getProofForSubmission,
  getShipmentPaymentInfo,
  listBankAccounts,
  listSubmissions,
  reviewSubmission,
  submitBankTransfer,
  type ProofUpload,
} from '../modules/payments/manualTransfer.js';
import {
  listSubmissionsQuerySchema,
  reviewSubmissionSchema,
  submitTransferSchema,
} from '../modules/payments/manualTransfer.schema.js';
import type { AccessTokenClaims } from '../modules/auth/tokens.js';
import { env as appEnv } from '../config/env.js';

/**
 * RUTAS DE PAGOS
 *
 * Hay tres formas de pago:
 *
 *  - ONLINE: Stripe (integracion heredada, deshabilitada por defecto).
 *  - BANK_TRANSFER: transferencia manual + comprobante + aprobacion
 *    de un administrador. Es el flujo activo para prepago.
 *  - ON_DELIVERY: cobro contra entrega. No bloquea el despacho.
 *
 * El unico paso que marca un envio como pagado es la aprobacion
 * explicita del pago. Subir un comprobante no cobra nada.
 */

function actorOf(req: { currentUser?: AccessTokenClaims }): { userId: string; roles: string[] } {
  const user = req.currentUser as AccessTokenClaims;
  return { userId: user.sub, roles: user.roles };
}

function fieldValue(fields: Record<string, unknown>, name: string): string | undefined {
  const raw = fields[name];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first && typeof first === 'object' && 'value' in first) {
    return String((first as { value: unknown }).value);
  }
  return typeof first === 'string' ? first : undefined;
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  // ── Pago online heredado ───────────────────────────────────
  app.post(
    '/shipments/:code/pay',
    {
      preHandler: [app.authenticate, app.requireRole('SENDER', 'ADMIN')],
      schema: {
        tags: ['payments'],
        summary: 'Crea la sesion de pago de un envio',
      },
    },
    async (req) => {
      const { code } = req.params as { code: string };
      const user = req.currentUser as AccessTokenClaims;

      if (!paymentsEnabled()) {
        throw validationError('Los pagos en linea no estan habilitados en este entorno');
      }

      const shipment = await prisma.shipment.findUnique({
        where: { trackingCode: code.toUpperCase() },
        select: {
          id: true,
          trackingCode: true,
          senderId: true,
          amountCents: true,
          currency: true,
          paymentStatus: true,
          paymentMethod: true,
          itemCount: true,
        },
      });

      if (!shipment) throw notFound('Envio');
      if (shipment.senderId !== user.sub && !user.roles.includes('ADMIN')) {
        throw forbidden('Solo el emisor puede iniciar el pago');
      }
      if (shipment.paymentMethod !== 'ONLINE') {
        throw validationError('Este envio no usa pago online');
      }
      if (shipment.amountCents <= 0) {
        throw validationError('El envio no tiene importe definido');
      }

      const session = await createPaymentSession(
        {
          trackingCode: shipment.trackingCode,
          amountCents: shipment.amountCents,
          currency: shipment.currency,
          customerEmail: user.email,
          description: `Envio ${shipment.trackingCode} · ${shipment.itemCount} articulo(s)`,
        },
        req,
      );

      return { data: session };
    },
  );

  // ── Cuentas bancarias activas ──────────────────────────────
  app.get(
    '/bank-accounts',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['payments'],
        summary: 'Cuentas bancarias activas para transferencias',
      },
    },
    async (req) => {
      const query = z
        .object({ currency: z.enum(['NIO', 'USD']).optional() })
        .parse(req.query ?? {});
      return { data: await listBankAccounts(query.currency) };
    },
  );

  // ── Estado del pago + instrucciones ────────────────────────
  app.get(
    '/shipments/:code/payment',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['payments'],
        summary: 'Estado del pago de un envio',
      },
    },
    async (req) => {
      const { code } = req.params as { code: string };
      return { data: await getShipmentPaymentInfo(code, actorOf(req)) };
    },
  );

  // ── Subir comprobante de transferencia ─────────────────────
  app.post(
    '/shipments/:code/transfer',
    {
      preHandler: [app.authenticate, app.requireRole('SENDER', 'ADMIN')],
      schema: {
        tags: ['payments'],
        summary: 'Sube el comprobante de una transferencia bancaria',
        consumes: ['multipart/form-data'],
      },
    },
    async (req, reply) => {
      const { code } = req.params as { code: string };
      const fields: Record<string, unknown> = {};
      let proof: ProofUpload | null = null;

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== 'proof') {
            // Consumir y descartar archivos inesperados.
            await part.toBuffer();
            continue;
          }
          if (proof) {
            await part.toBuffer();
            throw validationError('Solo se permite un comprobante por envio');
          }
          const buffer = await part.toBuffer();
          proof = { buffer, mimetype: part.mimetype, filename: part.filename };
        } else {
          fields[part.fieldname] = part.value;
        }
      }

      if (!proof) {
        throw validationError('Adjunta el comprobante de la transferencia');
      }

      const parsed = submitTransferSchema.parse({
        bankAccountId: fieldValue(fields, 'bankAccountId'),
        reference: fieldValue(fields, 'reference'),
        senderName: fieldValue(fields, 'senderName'),
        note: fieldValue(fields, 'note'),
      });

      const submission = await submitBankTransfer(code, actorOf(req), parsed, proof);
      return reply.status(201).send({ data: submission });
    },
  );

  // ── Ver comprobante (solo autorizados) ─────────────────────
  app.get(
    '/submissions/:id/proof',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['payments'],
        summary: 'Descarga el comprobante de una transferencia',
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const proof = await getProofForSubmission(id, actorOf(req));

      try {
        await stat(proof.absolutePath);
      } catch {
        throw notFound('Comprobante');
      }

      const filename = path
        .basename(proof.originalName || `comprobante-${id}`)
        .replace(/["\r\n]/g, '');
      reply
        .type(proof.mimeType)
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store');
      return reply.send(createReadStream(proof.absolutePath));
    },
  );

  // ── Revision administrativa ────────────────────────────────
  app.get(
    '/admin/submissions',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN', 'OPERATOR')],
      schema: {
        tags: ['payments'],
        summary: 'Lista los comprobantes de transferencia',
      },
    },
    async (req) => {
      const query = listSubmissionsQuerySchema.parse(req.query ?? {});
      return listSubmissions(query);
    },
  );

  app.post(
    '/admin/submissions/:id/approve',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN', 'OPERATOR')],
      schema: {
        tags: ['payments'],
        summary: 'Aprueba un comprobante y marca el envio como pagado',
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = reviewSubmissionSchema.parse({ decision: 'APPROVE', ...(req.body as object) });
      return {
        data: await reviewSubmission(id, actorOf(req), 'APPROVE', body.note),
      };
    },
  );

  app.post(
    '/admin/submissions/:id/reject',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN', 'OPERATOR')],
      schema: {
        tags: ['payments'],
        summary: 'Rechaza un comprobante y permite volver a subirlo',
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const body = reviewSubmissionSchema.parse({ decision: 'REJECT', ...(req.body as object) });
      return {
        data: await reviewSubmission(id, actorOf(req), 'REJECT', body.note),
      };
    },
  );

  // ── Cobro contra entrega ───────────────────────────────────
  app.post(
    '/shipments/:code/cod-collected',
    {
      preHandler: [app.authenticate, app.requireRole('COURIER', 'OPERATOR', 'ADMIN')],
      schema: {
        tags: ['payments'],
        summary: 'Registra si el repartidor cobro contra entrega',
      },
    },
    async (req) => {
      const { code } = req.params as { code: string };
      const user = req.currentUser as AccessTokenClaims;
      // El body es OBLIGATORIO y explicito: antes un body vacio se
      // interpretaba como `collected: true` y marcaba pagos por
      // accidente (un POST vacio, un cliente roto).
      const { collected } = z.object({ collected: z.boolean() }).parse(req.body);

      await recordCashOnDelivery(
        code.toUpperCase(),
        { userId: user.sub, roles: user.roles },
        collected,
        req,
      );

      return {
        data: {
          trackingCode: code.toUpperCase(),
          paymentStatus: collected ? 'PAID' : 'PENDING',
        },
      };
    },
  );

  // ── Estado del subsistema ──────────────────────────────────
  app.get(
    '/status',
    {
      schema: {
        tags: ['payments'],
        summary: 'Estado del subsistema de pagos',
      },
    },
    async () => {
      return {
        data: {
          enabled: true,
          provider: 'manual',
          modes: ["BANK_TRANSFER", 'ON_DELIVERY'],
          bankTransferEnabled: true,
          onlineEnabled: paymentsEnabled(),
          // Nunca se expone si hay clave; solo si el servicio esta activo.
          webhookConfigured: Boolean(appEnv.STRIPE_WEBHOOK_SECRET),
        },
      };
    },
  );
}
