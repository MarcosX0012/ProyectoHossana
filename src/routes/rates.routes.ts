import type { FastifyInstance } from 'fastify';
import {
  calculateRateSchema,
  shippingRateSchema,
  shippingRateUpdateSchema,
} from '../modules/rates/schema.js';
import * as rateService from '../modules/rates/service.js';
import { DEFAULT_NIO_PER_USD, nioCentsToUsdCents } from '../modules/rates/currency.js';

/**
 * RUTAS DE CATALOGO Y TARIFAS
 *
 *  - Departamentos y catalogo de tarifas: PUBLICOS (el portal del
 *    cliente los muestra antes de iniciar sesion).
 *  - Calculo de costo: autenticado (lo usa el formulario de envio).
 *  - Gestion de tarifas: ADMIN y OPERATOR.
 */

export async function ratesRoutes(app: FastifyInstance): Promise<void> {
  // ── Departamentos (publico) ───────────────────────────────
  app.get(
    '/departments',
    {
      schema: {
        tags: ['rates'],
        summary: 'Lista los departamentos de cobertura',
      },
    },
    async () => {
      return { data: await rateService.listDepartments(true) };
    },
  );

  // ── Catalogo de tarifas (publico) ─────────────────────────
  app.get(
    '/shipping-rates/catalog',
    {
      schema: {
        tags: ['rates'],
        summary: 'Catalogo publico de tarifas activas',
      },
    },
    async () => {
      const rates = await rateService.listRates(true);
      return {
        data: rates.map((rate) => ({
          id: rate.id,
          routeType: rate.routeType,
          routeTypeLabel: rateService.routeTypeLabel(rate.routeType),
          originDepartment: rate.originDepartment,
          destDepartment: rate.destDepartment,
          baseAmountCents: rate.baseAmountCents,
          baseAmountUsdCents: nioCentsToUsdCents(rate.baseAmountCents),
          includedLbs: Number(rate.includedLbs),
          extraPerLbCents: rate.extraPerLbCents,
          extraPerLbUsdCents: nioCentsToUsdCents(rate.extraPerLbCents),
          deliveryCents: rate.deliveryCents,
          deliveryUsdCents: nioCentsToUsdCents(rate.deliveryCents),
          currency: rate.currency,
          exchangeRateNioPerUsd: DEFAULT_NIO_PER_USD,
        })),
        meta: { exchangeRateNioPerUsd: DEFAULT_NIO_PER_USD },
      };
    },
  );

  // ── Calculo de costo (autenticado) ────────────────────────
  app.post(
    '/shipping-rates/calculate',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['rates'],
        summary: 'Calcula el costo de envio por origen, destino y peso',
      },
    },
    async (req) => {
      const input = calculateRateSchema.parse(req.body);
      const breakdown = await rateService.calculateRate(
        input.originDepartmentId,
        input.destDepartmentId,
        input.weightLbs,
      );
      return { data: breakdown };
    },
  );

  // ── Gestion (admin/operador) ──────────────────────────────
  app.get(
    '/shipping-rates',
    {
      preHandler: [app.authenticate, app.requireRole('OPERATOR', 'ADMIN')],
      schema: {
        tags: ['rates'],
        summary: 'Lista todas las tarifas (gestion)',
      },
    },
    async () => {
      return { data: await rateService.listRates(false) };
    },
  );

  app.post(
    '/shipping-rates',
    {
      preHandler: [app.authenticate, app.requireRole('OPERATOR', 'ADMIN')],
      schema: {
        tags: ['rates'],
        summary: 'Crea una tarifa',
      },
    },
    async (req, reply) => {
      const input = shippingRateSchema.parse(req.body);
      const rate = await rateService.createRate(input);
      return reply.status(201).send({ data: rate });
    },
  );

  app.patch(
    '/shipping-rates/:id',
    {
      preHandler: [app.authenticate, app.requireRole('OPERATOR', 'ADMIN')],
      schema: {
        tags: ['rates'],
        summary: 'Actualiza una tarifa',
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      const input = shippingRateUpdateSchema.parse(req.body);
      return { data: await rateService.updateRate(id, input) };
    },
  );

  app.delete(
    '/shipping-rates/:id',
    {
      preHandler: [app.authenticate, app.requireRole('OPERATOR', 'ADMIN')],
      schema: {
        tags: ['rates'],
        summary: 'Desactiva una tarifa',
      },
    },
    async (req) => {
      const { id } = req.params as { id: string };
      await rateService.deactivateRate(id);
      return { message: 'Tarifa desactivada' };
    },
  );
}
