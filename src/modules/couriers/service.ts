import type { ShipmentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { notFound } from '../../lib/errors.js';
import { TERMINAL_SHIPMENT_STATUSES } from '../shipments/stateMachine.js';
import {
  availabilityFor,
  getActiveAssignmentCounts,
  type CourierDisplayStatus,
} from './availability.js';

export interface CourierListRow {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  notificationEmail: string | null;
  phone: string | null;
  employeeNumber: string | null;
  isActive: boolean;
  courierAvailability: CourierDisplayStatus;
  activeShipments: number;
  currentShipment: {
    id: string;
    trackingCode: string;
    status: ShipmentStatus;
    updatedAt: Date;
  } | null;
}

/**
 * Listado de repartidores con su disponibilidad calculada en vivo.
 *
 * Lo consumen tanto el panel del administrador como el del operador.
 * El estado no depende de un valor guardado que pueda quedar viejo:
 * se deriva de los envios activos asignados a cada repartidor.
 */
export async function listCouriers(): Promise<CourierListRow[]> {
  const couriers = await prisma.user.findMany({
    where: { roles: { has: 'COURIER' } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      notificationEmail: true,
      phone: true,
      employeenumber: true,
      isactive: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });

  const courierIds = couriers.map((courier) => courier.id);

  const [counts, activeShipments] = await Promise.all([
    getActiveAssignmentCounts(courierIds),
    courierIds.length === 0
      ? Promise.resolve([])
      : prisma.shipment.findMany({
          where: {
            assignedcourierid: { in: courierIds },
            status: { notIn: TERMINAL_SHIPMENT_STATUSES },
          },
          select: {
            id: true,
            trackingCode: true,
            status: true,
            updatedAt: true,
            assignedcourierid: true,
          },
          orderBy: { updatedAt: 'desc' },
        }),
  ]);

  // El envio mas reciente de cada repartidor es el que se muestra como
  // "envio actual" en la tabla.
  const currentByCourier = new Map<
    string,
    { id: string; trackingCode: string; status: ShipmentStatus; updatedAt: Date }
  >();
  for (const shipment of activeShipments) {
    if (shipment.assignedcourierid && !currentByCourier.has(shipment.assignedcourierid)) {
      currentByCourier.set(shipment.assignedcourierid, {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        status: shipment.status,
        updatedAt: shipment.updatedAt,
      });
    }
  }

  return couriers.map((courier) => {
    const activeShipmentsCount = counts.get(courier.id) ?? 0;
    const isActive = courier.isactive !== false;

    return {
      id: courier.id,
      firstName: courier.firstName,
      lastName: courier.lastName,
      email: courier.email,
      notificationEmail: courier.notificationEmail,
      phone: courier.phone,
      employeeNumber: courier.employeenumber,
      isActive,
      courierAvailability: availabilityFor(activeShipmentsCount, isActive),
      activeShipments: activeShipmentsCount,
      currentShipment: currentByCourier.get(courier.id) ?? null,
    };
  });
}

export interface CourierShipmentSummary {
  totalShipments: number;
  activeShipments: number;
  deliveredShipments: number;
  closedShipments: number;
}

export interface CourierDetailRow extends CourierListRow {
  summary: CourierShipmentSummary;
}

/**
 * Detalle de un repartidor con el resumen de los envios que lo tienen
 * como repartidor asignado actualmente, incluidos los ya entregados o
 * cerrados.
 *
 * Los contadores salen de una sola agrupacion por estado, de modo que
 * el panel de historial no necesita consultar envio por envio.
 */
export async function getCourierDetail(courierId: string): Promise<CourierDetailRow> {
  const courier = await prisma.user.findFirst({
    where: { id: courierId, roles: { has: 'COURIER' } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      notificationEmail: true,
      phone: true,
      employeenumber: true,
      isactive: true,
    },
  });

  if (!courier) throw notFound('Repartidor');

  const [statusCounts, currentShipment] = await Promise.all([
    prisma.shipment.groupBy({
      by: ['status'],
      where: { assignedcourierid: courierId },
      _count: { _all: true },
    }),
    prisma.shipment.findFirst({
      where: {
        assignedcourierid: courierId,
        status: { notIn: TERMINAL_SHIPMENT_STATUSES },
      },
      select: { id: true, trackingCode: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
  ]);

  const countFor = (statuses: ShipmentStatus[]) =>
    statusCounts
      .filter((row) => statuses.includes(row.status))
      .reduce((sum, row) => sum + row._count._all, 0);

  const totalShipments = statusCounts.reduce((sum, row) => sum + row._count._all, 0);
  const activeShipments = statusCounts
    .filter((row) => !TERMINAL_SHIPMENT_STATUSES.includes(row.status))
    .reduce((sum, row) => sum + row._count._all, 0);
  const deliveredShipments = countFor(['DELIVERED']);
  const closedShipments = countFor(['RETURNED', 'LOST', 'CANCELLED']);
  const isActive = courier.isactive !== false;

  return {
    id: courier.id,
    firstName: courier.firstName,
    lastName: courier.lastName,
    email: courier.email,
    notificationEmail: courier.notificationEmail,
    phone: courier.phone,
    employeeNumber: courier.employeenumber,
    isActive,
    courierAvailability: availabilityFor(activeShipments, isActive),
    activeShipments,
    currentShipment,
    summary: {
      totalShipments,
      activeShipments,
      deliveredShipments,
      closedShipments,
    },
  };
}
