import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCourierDetail, listCouriers } from '../modules/couriers/service.js';

/**
 * Listado compartido de repartidores.
 *
 * Lo consumen el panel del administrador y el del operador: ambos
 * necesitan ver quien esta disponible antes de asignar un envio. El
 * estado se calcula en vivo desde los envios activos, no desde el
 * campo guardado, para que "Ocupado" desaparezca en cuanto el envio
 * se entrega.
 */
export async function couriersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/couriers',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN', 'OPERATOR')],
      schema: { tags: ['couriers'], summary: 'Lista repartidores y su disponibilidad' },
    },
    async () => {
      return { data: await listCouriers() };
    },
  );

  app.get(
    '/couriers/:id',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN', 'OPERATOR')],
      schema: { tags: ['couriers'], summary: 'Detalle y resumen de un repartidor' },
    },
    async (req) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      return { data: await getCourierDetail(id) };
    },
  );
}
