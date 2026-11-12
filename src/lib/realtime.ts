import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { isTrackingTokenExpired, verifyTrackingToken } from '../modules/auth/qrTokens.js';

/**
 * TIEMPO REAL
 * ===========
 *
 * Cuando se registra un hito, el usuario que mira la linea de tiempo lo
 * ve aparecer sin recargar. Eso es lo que convierte "un historial de
 * estados" en "rastreo en vivo".
 *
 * Como no hay Redis en este despliegue, la escala entre instancias se
 * resuelve con el adaptador de Socket.io sobre PostgreSQL
 * (LISTEN/NOTIFY), que es exactamente lo que hace un Postgres
 * multi-nodo. Si mas adelante se anaden varias instancias, este archivo
 * no cambia.
 *
 * Salas:
 *   shipment:<trackingCode>  -> watchers de un envio concreto (rastreo publico)
 *   user:<userId>            -> notificaciones personales de un usuario
 *
 * Las salas se autoriza al entrar, no despues: el socket valida el
 * token en el handshake.
 */

let io: SocketIOServer | null = null;

interface SocketUser {
  userId: string;
  roles: string[];
}

/**
 * Socket.io v4 exige ampliar `SocketData` (no `Socket`) para tipar
 * `socket.data`. Al ampliarlo aqui, todos los handlers obtienen
 * `socket.data.user` con tipo sin repetir casteos.
 */
declare module 'socket.io' {
  interface SocketData {
    user?: SocketUser;
  }
}

export async function initRealtime(httpServer: HttpServer): Promise<SocketIOServer> {
  const server = new SocketIOServer(httpServer, {
    path: '/ws',
    cors: {
      origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
      credentials: true,
    },
    // Los clientes moviles pierden conexion con frecuencia; reenfocar
    // con backoff exponencial es mejor que cortar la sesion.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: false,
    },
  });

  try {
    const { createAdapter } = await import('@socket.io/postgres-adapter');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: env.DATABASE_URL, max: 4 });
    server.adapter(createAdapter(pool, { tableName: 'socket_io_channels' }));
    logger.info('Realtime: adaptador de Socket.io sobre PostgreSQL activo');
  } catch (error) {
    logger.warn(
      { err: error },
      'Realtime: sin adaptador Postgres, se operara en instancia unica',
    );
  }

  // Middleware de autenticacion del handshake.
  server.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace(/^Bearer /i, '');

    if (!token) {
      // Sin token solo se permite entrar a salas publicas, que se validan
      // contra la firma del QR. Se marca como anonimo.
      socket.data.user = undefined;
      return next();
    }

    try {
      const payload = verifyRealtimeToken(token);
      socket.data.user = payload;
      return next();
    } catch {
      return next(new Error('Token invalido'));
    }
  });

  server.on('connection', (socket) => {
    const user = socket.data.user;

    if (user) {
      void socket.join(`user:${user.userId}`);
      // `publishToRoles` emite a `role:<rol>`; sin estas salas los
      // avisos de administracion y operaciones nunca llegaban a nadie.
      for (const role of user.roles) void socket.join(`role:${role}`);
      logger.debug({ socketId: socket.id, userId: user.userId }, 'Realtime: usuario conectado');
    }

    // Unirse a la linea de tiempo de un envio.
    // - `full`: exige sesion y que el usuario sea emisor, receptor,
    //   courier asignado o staff.
    // - `public`: exige el token firmado que viaja en el QR. Un codigo
    //   de rastreo pelado es enumerable y no autoriza la sala.
    socket.on('track:join', async (payload: unknown, ack?: (r: unknown) => void) => {
      const parsed = parseTrackRequest(payload);
      if (!parsed) {
        ack?.({ ok: false, error: 'Payload invalido' });
        return;
      }

      try {
        if (parsed.level === 'full') {
          const actor = socket.data.user;
          if (!actor) {
            ack?.({ ok: false, error: 'Sesion requerida para el rastreo completo' });
            return;
          }

          const shipment = await prisma.shipment.findUnique({
            where: { trackingCode: parsed.trackingCode },
            select: { senderId: true, recipientId: true, assignedcourierid: true },
          });

          if (!shipment) {
            ack?.({ ok: false, error: 'Envio no encontrado' });
            return;
          }

          const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');
          const isParticipant =
            shipment.senderId === actor.userId ||
            shipment.recipientId === actor.userId ||
            shipment.assignedcourierid === actor.userId;

          if (!isStaff && !isParticipant) {
            logger.warn(
              { userId: actor.userId, trackingCode: parsed.trackingCode },
              'Realtime: acceso denegado a la sala del envio',
            );
            ack?.({ ok: false, error: 'No tienes acceso a este envio' });
            return;
          }
        } else {
          if (!parsed.trackingToken) {
            ack?.({ ok: false, error: 'Token de rastreo requerido' });
            return;
          }

          const verified = verifyTrackingToken(parsed.trackingToken);
          if (
            !verified ||
            verified.trackingCode.toUpperCase() !== parsed.trackingCode ||
            isTrackingTokenExpired(verified)
          ) {
            ack?.({ ok: false, error: 'Token de rastreo invalido o caducado' });
            return;
          }
        }

        const room = `shipment:${parsed.trackingCode}`;
        await socket.join(room);
        ack?.({ ok: true, room, level: parsed.level });
        logger.debug(
          { trackingCode: parsed.trackingCode, level: parsed.level, socketId: socket.id },
          'Realtime: observando envio',
        );
      } catch (error) {
        logger.error(
          { err: error, trackingCode: parsed.trackingCode, socketId: socket.id },
          'Realtime: error autorizando la sala del envio',
        );
        ack?.({ ok: false, error: 'No se pudo autorizar el rastreo' });
      }
    });

    socket.on('track:leave', (payload: unknown) => {
      const parsed = parseTrackRequest(payload);
      if (parsed) void socket.leave(`shipment:${parsed.trackingCode}`);
    });

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, 'Realtime: desconectado');
    });
  });

  io = server;
  logger.info('Realtime: servidor Socket.io inicializado');
  return server;
}

interface TrackRequest {
  trackingCode: string;
  level: 'public' | 'full';
  trackingToken?: string;
}

function parseTrackRequest(payload: unknown): TrackRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const trackingCode =
    typeof record.trackingCode === 'string' ? record.trackingCode.trim().toUpperCase() : null;
  if (!trackingCode || trackingCode.length > 80) return null;

  const rawLevel = record.level;
  if (rawLevel !== undefined && rawLevel !== 'public' && rawLevel !== 'full') return null;
  const level: 'public' | 'full' = rawLevel === 'full' ? 'full' : 'public';

  const trackingToken =
    typeof record.trackingToken === 'string' && record.trackingToken.trim()
      ? record.trackingToken.trim()
      : undefined;

  return { trackingCode, level, trackingToken };
}

interface RealtimeTokenPayload {
  userId: string;
  roles: string[];
  exp: number;
}

/**
 * Verifica el JWT de acceso para el handshake del socket.
 * Se implementa aqui (y no via @fastify/jwt) porque el servidor
 * Socket.io corre fuera del ciclo de vida de Fastify.
 */
function verifyRealtimeToken(token: string): RealtimeTokenPayload {
  // Se reutiliza el verificador del modulo de autenticacion en lugar de
  // duplicar la verificacion JWT aqui: una sola implementacion garantiza
  // que el servidor HTTP y el de tiempo real no puedan divergir.
  const claims = verifyAccessToken(token);

  if (!claims.sub) throw new Error('Token sin usuario');
  return { userId: claims.sub, roles: claims.roles as string[], exp: 0 };
}

// ── API de emision ───────────────────────────────────────────

/**
 * Publica un hito en la linea de tiempo del envio. Se llama
 * automaticamente tras crear un ShipmentEvent.
 */
export function publishShipmentEvent(
  trackingCode: string,
  event: {
    id: string;
    sequence: number;
    status: string;
    occurredAt: Date;
    title?: string | null;
  },
  options: { includePrivateData?: boolean } = {},
): void {
  if (!io) return;

  const payload = {
    type: 'shipment.event',
    trackingCode,
    event: {
      id: event.id,
      sequence: event.sequence,
      status: event.status,
      title: event.title ?? null,
      occurredAt: event.occurredAt.toISOString(),
    },
  };

  io.to(`shipment:${trackingCode}`).emit('shipment:event', payload);

  // Actualizacion de cabecera para quien solo mira el estado actual.
  io.to(`shipment:${trackingCode}`).emit('shipment:status', {
    type: 'shipment.status',
    trackingCode,
    status: event.status,
    at: event.occurredAt.toISOString(),
  });

  if (options.includePrivateData) {
    logger.debug({ trackingCode }, 'Realtime: evento con datos privados marcado');
  }
}

/** Avisa a un usuario concreto (nuevo envio, pago rechazado, etc.). */
export function publishToUser(userId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

export function publishToRoles(roles: string[], event: string, data: unknown): void {
  if (!io) return;
  for (const role of roles) io.to(`role:${role}`).emit(event, data);
}

export function getRealtimeServer(): SocketIOServer | null {
  return io;
}

export async function closeRealtime(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}