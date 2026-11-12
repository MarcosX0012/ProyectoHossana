import { prisma } from '../../lib/prisma.js';

export async function listCatalog(activeOnly = true) {
  return prisma.productCatalog.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: { sortorder: 'asc' },
  });
}

export async function listAll() {
  return prisma.productCatalog.findMany({ orderBy: { sortorder: 'asc' } });
}

export async function createItem(data: { name: string; code: string; active?: boolean; sortorder?: number }) {
  return prisma.productCatalog.create({ data });
}

export async function updateItem(id: string, data: Partial<{ name: string; code: string; active: boolean; sortorder: number }>) {
  return prisma.productCatalog.update({ where: { id }, data });
}

export async function deleteItem(id: string) {
  return prisma.productCatalog.delete({ where: { id } });
}
