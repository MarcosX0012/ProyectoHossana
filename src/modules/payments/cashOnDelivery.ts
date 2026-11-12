import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { conflict, forbidden } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';

/**
 * COBRO CONTRA ENTREGA
 * ====================
 *
 * El unico paso que marca un envio ON_DELIVERY como pagado es la
 * confirmacion explicita del repartidor asignado (o de un administrador
 * u operador). No hay pasarela: el dinero se cobra en la puerta.
 */
export async function recordCashOnDelivery(
  trackingCode: string,
  actor: { userId: string; roles: string[] },
  collected: boolean,
  req?: FastifyRequest,
): Promise<void> {
  const shipment = await prisma.shipment.findUnique({
    where: { trackingCode },
    select: {
      id: true,
      trackingCode: true,
      paymentMethod: true,
      paymentStatus: true,
      assignedcourierid: true,
    },
  });

  if (!shipment) return;
  if (shipment.paymentMethod !== 'ON_DELIVERY') return;

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');

  // Solo el courier ASIGNADO (o staff) puede reportar el cobro. Sin
  // esto, cualquier repartidor podria marcar pagos de envios ajenos.
  if (!isStaff && shipment.assignedcourierid !== actor.userId) {
    await recordAudit(
      {
        userId: actor.userId,
        action: 'PAYMENT_COD_COLLECTED',
        entity: 'Shipment',
        entityId: shipment.id,
        shipmentCode: shipment.trackingCode,
        outcome: 'DENIED',
        metadata: { reason: 'COURIER_NOT_ASSIGNED' },
      },
      req,
    );
    throw forbidden('Este envio no esta asignado a ti');
  }

  // Revertir un pago ya registrado no es operativo: deja el envio como
  // pendiente de cobro con el paquete entregado. Esa correccion la
  // hace un administrador por el flujo de auditoria.
  if (!collected && shipment.paymentStatus === 'PAID') {
    throw conflict('El cobro ya fue registrado; la reversa requiere a un administrador');
  }

  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { paymentStatus: collected ? 'PAID' : 'PENDING', paidAt: collected ? new Date() : null },
  });

  await recordAudit(
    {
      userId: actor.userId,
      action: collected ? 'PAYMENT_COD_COLLECTED' : 'PAYMENT_COD_NOT_COLLECTED',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { collected, previousStatus: shipment.paymentStatus },
    },
    req,
  );
}
