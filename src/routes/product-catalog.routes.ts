import type { FastifyInstance } from 'fastify';
import * as service from '../modules/product-catalog/service.js';

export async function productCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get('/public/product-catalog', async () => {
    const items = await service.listCatalog(true);
    return { data: items };
  });

  app.get('/admin/product-catalog', { preHandler: [app.authenticate, app.requireRole('ADMIN')] }, async () => {
    const items = await service.listAll();
    return { data: items };
  });

  app.post('/admin/product-catalog', { preHandler: [app.authenticate, app.requireRole('ADMIN')] }, async (req, reply) => {
    const body = req.body as any;
    const item = await service.createItem(body);
    return reply.status(201).send({ data: item });
  });

  app.patch('/admin/product-catalog/:id', { preHandler: [app.authenticate, app.requireRole('ADMIN')] }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const item = await service.updateItem(id, body);
    return { data: item };
  });

  app.delete('/admin/product-catalog/:id', { preHandler: [app.authenticate, app.requireRole('ADMIN')] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await service.deleteItem(id);
    return reply.status(204).send();
  });
}
