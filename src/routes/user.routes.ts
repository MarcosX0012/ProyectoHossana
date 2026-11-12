import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as authService from '../modules/auth/service.js';
import { revokeAllSessions, type AccessTokenClaims } from '../modules/auth/tokens.js';
import {
  countUnreadNotifications,
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../modules/notifications/service.js';
import { phoneIndex } from '../modules/auth/tokens.js';

/**
 * RUTAS DE PERFIL Y CUENTA
 *
 * `GET /me` es el endpoint que el frontend llama al arrancar para
 * saber quien es el usuario y que permisos tiene. Si el token expiro,
 * responde 401 y el frontend intenta renovarlo.
 */

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Perfil del usuario autenticado',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      const profile = await authService.getProfile(user.sub);

      return {
        data: {
          ...profile,
          // El permiso derivado evita que el frontend tenga que
          // replicar la logica de roles y se desincronice con el backend.
          permissions: {
            canCreateShipments: profile.roles.some((r) => ['SENDER', 'OPERATOR', 'ADMIN'].includes(r)),
            canOperate: profile.roles.some((r) => ['OPERATOR', 'COURIER', 'ADMIN'].includes(r)),
            canAdminister: profile.roles.includes('ADMIN'),
            emailVerified: profile.emailVerifiedAt !== null,
          },
        },
      };
    },
  );

  app.patch(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Actualiza el perfil',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      const input = updateSchema.parse(req.body);
      const profile = await authService.updateProfile(user.sub, input);
      return { data: profile };
    },
  );

  app.post(
    '/me/phone-hash',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Devuelve el indice cifrado de un telefono',
        description:
          'Util para verificar si un numero ya esta registrado sin ' +
          'almacenar ni comparar el numero en claro.',
      },
    },
    async (req) => {
      const { phone } = z.object({ phone: z.string().min(7).max(15) }).parse(req.body);
      return { data: { index: phoneIndex(phone) } };
    },
  );

  app.get(
    '/me/notifications',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Historial de notificaciones del usuario',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(30),
          unreadOnly: z
            .enum(['true', 'false'])
            .optional()
            .transform((value) => value === 'true'),
          channel: z.enum(['WHATSAPP', 'EMAIL', 'SMS', 'PUSH', 'IN_APP']).optional(),
        })
        .parse(req.query ?? {});

      const notifications = await listUserNotifications(user.sub, query);
      return { data: notifications };
    },
  );

  app.get(
    '/me/notifications/unread-count',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Cantidad de notificaciones sin leer',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      return { data: { count: await countUnreadNotifications(user.sub) } };
    },
  );

  app.post(
    '/me/notifications/read-all',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Marca todas las notificaciones como leidas',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      return { data: { updated: await markAllNotificationsRead(user.sub) } };
    },
  );

  app.patch(
    '/me/notifications/:id/read',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Marca una notificacion como leida',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      const params = z.object({ id: z.string().uuid('Notificacion invalida') }).parse(req.params);
      return { data: { updated: await markNotificationRead(user.sub, params.id) } };
    },
  );

  app.delete(
    '/me/sessions',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['users'],
        summary: 'Cierra todas las sesiones del usuario',
      },
    },
    async (req) => {
      const user = req.currentUser as AccessTokenClaims;
      const count = await revokeAllSessions(user.sub, 'USER_REVOKED_ALL');
      return { data: { revoked: count } };
    },
  );
}

const updateSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9]{7,15}$/, 'Telefono invalido')
      .optional(),
    locale: z.enum(['es', 'en', 'pt']).optional(),
    notificationEmail: z
      .union([
        z.string().trim().toLowerCase().email('Correo de notificaciones invalido').max(254),
        z.literal(''),
        z.null(),
      ])
      .optional()
      .transform((value) => (value === '' ? null : value)),
  })
  .refine((v) => Object.keys(v).length > 0, 'No hay campos para actualizar');