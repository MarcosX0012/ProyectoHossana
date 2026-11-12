import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';

export async function courierRoutes(app: FastifyInstance): Promise<void> {
  app.get('/my-shipments', { preHandler: [app.authenticate, app.requireRole('COURIER')] }, async (req) => {
    const user = req.currentUser as any;
    const shipments = await prisma.shipment.findMany({
      where: { assignedcourierid: user.sub },
      include: {
        recipientAddress: true,
        senderAddress: true,
        originBranch: { select: { id: true, name: true, city: true } },
        destinationBranch: { select: { id: true, name: true, city: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return { data: shipments };
  });

  app.get('/my-route/today', { preHandler: [app.authenticate, app.requireRole('COURIER')] }, async (req) => {
    const user = req.currentUser as any;
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
    const shipments = await prisma.shipment.findMany({
      where: { assignedcourierid: user.sub, status: { in: ['AWAITING_PICKUP', 'PICKED_UP', 'IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY'] } },
      include: { recipientAddress: true, senderAddress: true },
      orderBy: { updatedAt: 'asc' },
    });
    return { data: shipments };
  });

  app.get('/route/:courierId/today', { preHandler: [app.authenticate, app.requireRole('ADMIN','OPERATOR')] }, async (req) => {
    const { courierId } = req.params as { courierId: string };
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
    const shipments = await prisma.shipment.findMany({
      where: { assignedcourierid: courierId, updatedAt: { gte: today, lt: tomorrow } },
      include: { recipientAddress: true, users_shipments_assignedcourieridTousers: { select: { firstName: true, lastName: true, employeenumber: true } } },
      orderBy: { updatedAt: 'asc' },
    });
    return { data: shipments };
  });
}
