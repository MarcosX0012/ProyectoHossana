import type { RouteType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { conflict, notFound, validationError } from '../../lib/errors.js';
import { MIN_INPUT_WEIGHT_LBS, MAX_WEIGHT_LBS } from './schema.js';
import type { ShippingRateInput } from './schema.js';
import { DEFAULT_NIO_PER_USD, nioCentsToUsdCents } from './currency.js';

/**
 * SERVICIO DE TARIFAS
 * ===================
 *
 * Regla de negocio (Hossana S.A.):
 *
 *   Costo total = Tarifa base
 *               + (libras adicionales redondeadas x costo por libra extra)
 *               + Delivery
 *
 *  - La tarifa base incluye las primeras 2 libras.
 *  - Si el paquete pesa menos de 2 libras, se cobra igual como 2.
 *  - Si el peso tiene decimales, las libras adicionales se redondean
 *    hacia arriba (4.5 lb => 3 libras adicionales).
 *  - El delivery es fijo por categoria de ruta (0 en ruta local).
 *
 * La categoria de la ruta (LOCAL/SHORT/MEDIUM/LONG) vive en la tabla
 * `ShippingRate`, un registro por par origen-destino.
 */

export interface RateBreakdown {
  /** Id de la tarifa aplicada (se guarda como snapshot en el envio). */
  shippingRateId: string;
  originDepartmentId: string;
  destDepartmentId: string;
  routeType: RouteType;
  routeTypeLabel: string;
  /** Peso que el cliente ingreso, en libras. */
  weightLbs: number;
  /** Peso efectivamente usado para cobrar (minimo 2 lb). */
  weightUsedForCalc: number;
  includedLbs: number;
  /** Libras adicionales ya redondeadas hacia arriba. */
  extraLbsCharged: number;
  extraPerLbCents: number;
  extraPerLbUsdCents: number;
  baseAmountCents: number;
  baseAmountUsdCents: number;
  deliveryCents: number;
  deliveryUsdCents: number;
  totalCents: number;
  totalUsdCents: number;
  /** Tipo de cambio NIO por USD usado para la equivalencia. */
  exchangeRateNioPerUsd: number;
  currency: string;
  /** Mensaje listo para mostrar sobre el minimo cobrado. */
  minWeightNote: string;
}

const ROUTE_LABELS: Record<RouteType, string> = {
  LOCAL: 'Local',
  SHORT: 'Corta',
  MEDIUM: 'Media',
  LONG: 'Larga',
};

export function routeTypeLabel(routeType: RouteType): string {
  return ROUTE_LABELS[routeType];
}

// ── Departamentos ──────────────────────────────────────────────

export async function listDepartments(onlyActive = true) {
  return prisma.department.findMany({
    where: onlyActive ? { isActive: true } : {},
    select: {
      id: true,
      code: true,
      name: true,
      countryCode: true,
      sortOrder: true,
      isActive: true,
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

// ── Tarifas ────────────────────────────────────────────────────

const RATE_INCLUDE = {
  originDepartment: { select: { id: true, code: true, name: true } },
  destDepartment: { select: { id: true, code: true, name: true } },
} as const;

export async function listRates(onlyActive = false) {
  return prisma.shippingRate.findMany({
    where: onlyActive ? { isActive: true } : {},
    include: RATE_INCLUDE,
    orderBy: [
      { originDepartment: { sortOrder: 'asc' } },
      { destDepartment: { sortOrder: 'asc' } },
    ],
  });
}

async function findRate(originDepartmentId: string, destDepartmentId: string) {
  return prisma.shippingRate.findFirst({
    where: { originDepartmentId, destDepartmentId, isActive: true },
    orderBy: { priority: 'desc' },
  });
}

/**
 * Calcula el desglose del costo. Lanza un error claro si no hay tarifa
 * para la ruta o si el peso esta fuera de rango.
 */
export async function calculateRate(
  originDepartmentId: string,
  destDepartmentId: string,
  weightLbs: number,
): Promise<RateBreakdown> {
  if (
    !Number.isFinite(weightLbs) ||
    weightLbs < MIN_INPUT_WEIGHT_LBS ||
    weightLbs > MAX_WEIGHT_LBS
  ) {
    throw validationError(
      `El peso debe estar entre ${MIN_INPUT_WEIGHT_LBS} y ${MAX_WEIGHT_LBS} libras`,
    );
  }

  const rate = await findRate(originDepartmentId, destDepartmentId);
  if (!rate) {
    throw notFound('Tarifa para esa ruta');
  }

  const includedLbs = Number(rate.includedLbs);
  // Las primeras `includedLbs` libras van incluidas; por debajo del
  // minimo se cobra igual que el minimo (nunca menos).
  const weightUsedForCalc = Math.max(weightLbs, includedLbs);
  const extraExact = weightUsedForCalc - includedLbs;
  const extraLbsCharged = extraExact > 0 ? Math.ceil(extraExact) : 0;

  const extraCents = extraLbsCharged * rate.extraPerLbCents;
  const totalCents = rate.baseAmountCents + extraCents + rate.deliveryCents;

  return {
    shippingRateId: rate.id,
    originDepartmentId,
    destDepartmentId,
    routeType: rate.routeType,
    routeTypeLabel: routeTypeLabel(rate.routeType),
    weightLbs,
    weightUsedForCalc,
    includedLbs,
    extraLbsCharged,
    extraPerLbCents: rate.extraPerLbCents,
    extraPerLbUsdCents: nioCentsToUsdCents(rate.extraPerLbCents),
    baseAmountCents: rate.baseAmountCents,
    baseAmountUsdCents: nioCentsToUsdCents(rate.baseAmountCents),
    deliveryCents: rate.deliveryCents,
    deliveryUsdCents: nioCentsToUsdCents(rate.deliveryCents),
    totalCents,
    totalUsdCents: nioCentsToUsdCents(totalCents),
    exchangeRateNioPerUsd: DEFAULT_NIO_PER_USD,
    currency: rate.currency,
    minWeightNote:
      weightLbs < includedLbs
        ? `El paquete pesa menos de ${includedLbs} lb, pero se cobra la tarifa minima de ${includedLbs} lb.`
        : '',
  };
}

// ── Gestion (ADMIN/OPERATOR) ───────────────────────────────────

export async function createRate(input: ShippingRateInput) {
  const existing = await prisma.shippingRate.findUnique({
    where: {
      originDepartmentId_destDepartmentId: {
        originDepartmentId: input.originDepartmentId,
        destDepartmentId: input.destDepartmentId,
      },
    },
    select: { id: true },
  });

  if (existing) {
    throw conflict('Ya existe una tarifa para ese par de departamentos');
  }

  return prisma.shippingRate.create({
    data: {
      originDepartmentId: input.originDepartmentId,
      destDepartmentId: input.destDepartmentId,
      routeType: input.routeType,
      baseAmountCents: input.baseAmountCents,
      includedLbs: input.includedLbs,
      extraPerLbCents: input.extraPerLbCents,
      deliveryCents: input.deliveryCents,
      currency: input.currency.toUpperCase(),
      isActive: input.isActive,
      priority: input.priority,
      notes: input.notes ?? null,
    },
    include: RATE_INCLUDE,
  });
}

export async function updateRate(id: string, input: Partial<ShippingRateInput>) {
  const existing = await prisma.shippingRate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Tarifa');

  return prisma.shippingRate.update({
    where: { id },
    data: {
      ...(input.routeType !== undefined ? { routeType: input.routeType } : {}),
      ...(input.baseAmountCents !== undefined ? { baseAmountCents: input.baseAmountCents } : {}),
      ...(input.includedLbs !== undefined ? { includedLbs: input.includedLbs } : {}),
      ...(input.extraPerLbCents !== undefined ? { extraPerLbCents: input.extraPerLbCents } : {}),
      ...(input.deliveryCents !== undefined ? { deliveryCents: input.deliveryCents } : {}),
      ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    },
    include: RATE_INCLUDE,
  });
}

export async function deactivateRate(id: string) {
  const existing = await prisma.shippingRate.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('Tarifa');
  return prisma.shippingRate.update({ where: { id }, data: { isActive: false } });
}
