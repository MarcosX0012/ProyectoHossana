import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { TERMINAL_SHIPMENT_STATUSES } from '../shipments/stateMachine.js';

/**
 * DISPONIBILIDAD DE REPARTIDORES
 *
 * Un repartidor esta "Ocupado" mientras tenga al menos un envio
 * asignado que no haya llegado a un estado terminal. En cuanto todos
 * sus envios se entregan (o se cancelan/devuelven/pierden), vuelve a
 * estar "Disponible".
 *
 * La fuente de verdad es la tabla de envios, no el campo
 * `courieravailability`: ese campo se mantiene sincronizado para otros
 * consumidores, pero la UI siempre puede recalcular el estado real.
 */

export type CourierAvailability = 'AVAILABLE' | 'ON_ROUTE';
export type CourierDisplayStatus = CourierAvailability | 'INACTIVE';

type DbClient = Prisma.TransactionClient | typeof prisma;

/** Traduce el conteo de envios activos a un estado visible. */
export function availabilityFor(
  activeShipments: number,
  isActive = true,
): CourierDisplayStatus {
  if (!isActive) return 'INACTIVE';
  return activeShipments > 0 ? 'ON_ROUTE' : 'AVAILABLE';
}

/** Cuenta envios activos por repartidor en una sola consulta. */
export async function getActiveAssignmentCounts(
  courierIds: string[],
  db: DbClient = prisma,
): Promise<Map<string, number>> {
  if (courierIds.length === 0) return new Map();

  const rows = await db.shipment.groupBy({
    by: ['assignedcourierid'],
    where: {
      assignedcourierid: { in: courierIds },
      status: { notIn: TERMINAL_SHIPMENT_STATUSES },
    },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.assignedcourierid) {
      counts.set(row.assignedcourierid, row._count._all);
    }
  }
  return counts;
}

/**
 * Recalcula y persiste la disponibilidad de un repartidor.
 *
 * Se llama despues de asignar/reasignar un envio y despues de cada
 * cambio de estado, de modo que el campo nunca se quede en ON_ROUTE
 * cuando el envio ya fue entregado.
 */
export async function syncCourierAvailability(
  courierId: string,
  db: DbClient = prisma,
): Promise<CourierAvailability> {
  const activeShipments = await db.shipment.count({
    where: {
      assignedcourierid: courierId,
      status: { notIn: TERMINAL_SHIPMENT_STATUSES },
    },
  });

  const availability: CourierAvailability =
    activeShipments > 0 ? 'ON_ROUTE' : 'AVAILABLE';

  await db.user.update({
    where: { id: courierId },
    data: { courieravailability: availability },
  });

  return availability;
}
