import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { listCouriers } from '../../modules/couriers/service.js';
import { hashPassword } from '../../modules/auth/service.js';
import { encryptPII, blindIndex } from '../../lib/crypto.js';
import { validationError } from '../../lib/errors.js';

/**
 * Gestion de usuarios desde el panel de administracion.
 *
 * Seguridad de la creacion de repartidores:
 *  - El hash se genera con argon2id, el MISMO algoritmo que usa el
 *    login. Usar bcrypt aqui producia usuarios que nunca podian
 *    entrar: argon2.verify rechaza hashes de otro formato.
 *  - La contrasena es aleatoria por usuario (nunca una fija compartida)
 *    y se devuelve UNA sola vez en la respuesta para que el admin la
 *    entregue por un canal seguro. No se vuelve a mostrar.
 *  - El `create` usa `select` explicito: sin el, Prisma devuelve
 *    passwordHash/phoneHash/phoneCipher y la respuesta los filtraba.
 */

const COURIER_CREATE_SCHEMA = z.object({
  email: z.string().trim().toLowerCase().email('Correo electronico invalido').max(254),
  notificationEmail: emptyToUndefined(
    z.string().trim().toLowerCase().email('Correo de avisos invalido').max(254).optional(),
  ),
  firstName: z.string().trim().min(1, 'El nombre es obligatorio').max(80),
  lastName: z.string().trim().min(1, 'El apellido es obligatorio').max(80),
  phone: emptyToUndefined(z.string().trim().min(7, 'Telefono invalido').max(20).optional()),
  employeeNumber: z.string().trim().min(1).max(30),
  isActive: z.boolean().optional(),
});

/** Un string vacio en el formulario significa "no proporcionado". */
function emptyToUndefined<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

/** Campos seguros para devolver en respuestas de usuario. */
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  notificationEmail: true,
  firstName: true,
  lastName: true,
  phone: true,
  roles: true,
  status: true,
  locale: true,
  employeenumber: true,
  courieravailability: true,
  isactive: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

/** Contrasena aleatoria legible: sin caracteres ambiguos (0/O, 1/l/I). */
function generateTempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(14);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export async function userAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async (req) => {
    const query: any = req.query;
    const role = query.role;

    // El listado de repartidores se comparte con el panel del operador
    // y calcula la disponibilidad en vivo desde los envios activos.
    if (role === "COURIER") {
      return { data: await listCouriers() };
    }

    const where: any = {};
    if (role) { where.roles = { has: role }; }
    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        notificationEmail: true,
        phone: true,
        roles: true,
        employeenumber: true,
        courieravailability: true,
        isactive: true,
      },
    });
    return {
      data: users.map((user) => ({
        ...user,
        employeeNumber: user.employeenumber,
        courierAvailability: user.courieravailability,
        isActive: user.isactive !== false,
      })),
    };
  });

  app.get("/users/courier/next-number", { preHandler: [app.authenticate, app.requireRole("ADMIN")] }, async () => {
    const count = await prisma.user.count({ where: { roles: { has: "COURIER" } } });
    const num = String(count + 1).padStart(4, "0");
    return { data: { employeeNumber: "EMP-" + num } };
  });

  app.post(
    "/users/courier",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (req, reply) => {
      const input = COURIER_CREATE_SCHEMA.parse(req.body);

      const employeeTaken = await prisma.user.findUnique({
        where: { employeenumber: input.employeeNumber },
        select: { id: true },
      });
      if (employeeTaken) {
        throw validationError("Ya existe un repartidor con ese numero de empleado");
      }

      // Contrasena temporal aleatoria: nunca una fija compartida.
      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);

      const user = await prisma.user.create({
        data: {
          email: input.email,
          notificationEmail: input.notificationEmail ?? null,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          // El telefono se guarda cifrado (AES-GCM) mas su indice de
          // busqueda (HMAC), igual que el resto del modelo de PII.
          ...(input.phone
            ? { phone: input.phone, phoneCipher: encryptPII(input.phone), phoneHash: blindIndex(input.phone) }
            : {}),
          roles: ["COURIER"],
          status: "ACTIVE",
          employeenumber: input.employeeNumber,
          isactive: input.isActive !== false,
          courieravailability: "AVAILABLE",
        },
        select: SAFE_USER_SELECT,
      });

      return reply.status(201).send({
        data: { ...user, employeeNumber: user.employeenumber, isActive: user.isactive !== false },
        // Entrega unica: el admin la transmite al repartidor por un
        // canal seguro y ella debe cambiarse al primer login.
        temporaryPassword: tempPassword,
        message: "Guarda la contrasena temporal: no se volvera a mostrar.",
      });
    },
  );

  app.patch(
    "/users/:id/active",
    { preHandler: [app.authenticate, app.requireRole("ADMIN")] },
    async (req) => {
      const params: any = req.params;
      const body = z.object({ isActive: z.boolean() }).parse(req.body);

      const user = await prisma.user.update({
        where: { id: params.id },
        data: { isactive: body.isActive },
        select: SAFE_USER_SELECT,
      });

      return { data: { ...user, isActive: user.isactive !== false } };
    },
  );
}
