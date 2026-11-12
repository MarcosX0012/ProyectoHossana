import {
  Prisma,
  type NotificationChannel,
  type NotificationStatus,
  type ShipmentStatus,
} from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { issueOtp } from '../auth/tokens.js';
import { SHIPMENT_TEMPLATES, sendWhatsAppTemplate } from './whatsapp.js';
import { buildDeliveryOtpEmail, buildNotificationEmail, sendEmail } from './email.js';
import { STATUS_DEFINITIONS } from '../shipments/stateMachine.js';

/**
 * SERVICIO DE NOTIFICACIONES
 * ===========================
 *
 * Decide QUE notificar y a QUIEN. El COMO (correo, WhatsApp, en la app)
 * queda en `dispatchNotification` y se cambia sin tocar la logica de
 * negocio.
 *
 * Dos reglas que evitan el problema clasico de estos sistemas:
 *
 *  1. Solo se notifica lo que el usuario pediria saber. Mandar un
 *     correo por cada micro hito satura al usuario y lo hace ignorar
 *     los avisos importantes. Hay una lista explicita de hitos
 *     notificables; el resto queda en la linea de tiempo sin avisar.
 *
 *  2. Notificar es best-effort, nunca bloqueante. Si el correo falla,
 *     la entrega ya ocurrio y no se revierte. Un fallo de notificacion
 *     no puede impedir que un paquete se marque entregado.
 *
 * El correo reutiliza el mismo proveedor que el OTP de registro
 * (`EMAIL_PROVIDER`). En desarrollo, si el proveedor no esta
 * configurado, el mensaje se registra en el log y la notificacion queda
 * como SKIPPED; el aviso dentro de la app se crea igual.
 */

/** Hitos que generan notificacion al receptor. */
const NOTIFIABLE_STATUSES: ShipmentStatus[] = [
  'AWAITING_PICKUP',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_ATTEMPTED',
  'EXCEPTION',
  'LOST',
  'RETURNED',
];

/** Hitos que generan notificacion al emisor. */
const SENDER_NOTIFIABLE: ShipmentStatus[] = ['EXCEPTION', 'LOST', 'RETURNING'];

/**
 * Hitos que el repartidor asignado necesita conocer. Si el evento lo
 * hizo el propio repartidor no se le avisa: ya sabe lo que registro.
 */
const COURIER_NOTIFIABLE_STATUSES: ShipmentStatus[] = [
  'AWAITING_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DISTRIBUTION_CENTER',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'EXCEPTION',
  'LOST',
  'RETURNING',
  'RETURNED',
  'CANCELLED',
  'ON_HOLD',
];

export function shouldNotifyReceiver(status: ShipmentStatus): boolean {
  return NOTIFIABLE_STATUSES.includes(status);
}

export function shouldNotifySender(status: ShipmentStatus): boolean {
  return SENDER_NOTIFIABLE.includes(status);
}

export function shouldNotifyCourier(status: ShipmentStatus): boolean {
  return COURIER_NOTIFIABLE_STATUSES.includes(status);
}

type TargetRole = 'recipient' | 'sender' | 'courier';

interface ShipmentNotificationInfo {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  recipientId: string | null;
  senderId: string;
  assignedCourierId?: string | null;
  estimatedDeliveryAt: Date | null;
}

interface CourierShipmentInfo {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  estimatedDeliveryAt: Date | null;
  originDepartment?: { name: string } | null;
  destDepartment?: { name: string } | null;
  originBranch?: { city: string } | null;
  destinationBranch?: { city: string } | null;
  recipientAddress?: {
    city: string;
    contactName: string;
    contactPhone: string;
  } | null;
}

export interface RecordNotificationInput {
  userId: string;
  shipmentId?: string | null;
  channel: NotificationChannel;
  template: string;
  payload: Record<string, unknown>;
  status?: NotificationStatus;
  providerMessageId?: string | null;
  error?: string | null;
  sentAt?: Date | null;
}

/**
 * Registra una notificacion ya enviada. Se usa cuando el envio fue
 * sincrono (por ejemplo desde un job) y ya tenemos el id del proveedor.
 */
export async function recordNotification(input: RecordNotificationInput) {
  const status = input.status ?? 'SENT';
  return prisma.notification.create({
    data: {
      userId: input.userId,
      shipmentId: input.shipmentId ?? null,
      channel: input.channel,
      template: input.template,
      payload: input.payload as Prisma.InputJsonValue,
      status,
      providerMessageId: input.providerMessageId ?? null,
      error: input.error ?? null,
      sentAt: input.sentAt ?? (status === 'SKIPPED' ? null : new Date()),
    },
    select: { id: true, status: true },
  });
}

/**
 * Canales que se crean para cada aviso. El aviso dentro de la app es
 * siempre obligatorio; el correo es el canal principal; WhatsApp queda
 * opcional y solo si esta configurado.
 */
function notificationChannels(): NotificationChannel[] {
  const channels: NotificationChannel[] = ['IN_APP', 'EMAIL'];
  if (env.WHATSAPP_ENABLED) channels.push('WHATSAPP');
  return channels;
}

function actionUrlFor(trackingCode: string): string {
  return `/envios/${trackingCode}`;
}

function templateForEvent(status: ShipmentStatus, role: TargetRole): string {
  if (role === 'courier') {
    if (status === 'CANCELLED') return 'courier_shipment_cancelled';
    return 'courier_shipment_update';
  }

  if (status === 'OUT_FOR_DELIVERY') return 'shipment_out_for_delivery';
  if (status === 'DELIVERED') return 'shipment_delivered';
  if (status === 'EXCEPTION' || status === 'LOST') return 'shipment_exception';
  if (status === 'CANCELLED') return 'shipment_cancelled';
  return 'shipment_status_update';
}

/**
 * Crea las filas de notificacion y dispara los canales externos.
 * El aviso IN_APP se guarda ya como SENT: no depende de un proveedor.
 */
async function enqueueForUser(input: {
  userId: string;
  shipmentId: string;
  template: string;
  payload: Record<string, unknown>;
}): Promise<string[]> {
  const created: Array<{ id: string; channel: NotificationChannel }> = [];

  for (const channel of notificationChannels()) {
    const isInApp = channel === 'IN_APP';
    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        shipmentId: input.shipmentId,
        channel,
        template: input.template,
        payload: input.payload as Prisma.InputJsonValue,
        status: isInApp ? 'SENT' : 'QUEUED',
        sentAt: isInApp ? new Date() : null,
        deliveredAt: isInApp ? new Date() : null,
      },
      select: { id: true },
    });
    created.push({ id: notification.id, channel });
  }

  // El envio se hace fuera de la transaccion del evento. Si el proceso
  // muere entre ambos, queda QUEUED y el worker lo recoge.
  for (const notification of created) {
    if (notification.channel === 'IN_APP') continue;
    await dispatchNotification(notification.id);
  }

  return created.map((notification) => notification.id);
}

/**
 * Encola la notificacion de un hito de la linea de tiempo.
 * Se llama DESPUES de confirmar el evento, nunca dentro de la
 * transaccion: la notificacion es consecuencia, no parte del estado.
 */
export async function notifyShipmentEvent(
  shipment: ShipmentNotificationInfo,
  event: {
    status: ShipmentStatus;
    title: string;
    description: string | null;
    occurredAt: Date;
  },
  options: { actorId?: string | null } = {},
): Promise<void> {
  const definition = STATUS_DEFINITIONS[event.status];
  const statusLabel = definition?.label ?? event.status;

  const targets = new Map<string, TargetRole>();
  if (shipment.recipientId && shouldNotifyReceiver(event.status)) {
    targets.set(shipment.recipientId, 'recipient');
  }
  if (shouldNotifySender(event.status)) {
    targets.set(shipment.senderId, 'sender');
  }
  if (
    shipment.assignedCourierId &&
    shouldNotifyCourier(event.status) &&
    shipment.assignedCourierId !== options.actorId
  ) {
    targets.set(shipment.assignedCourierId, 'courier');
  }

  if (targets.size === 0) return;

  for (const [userId, role] of targets) {
    const template = templateForEvent(event.status, role);
    const payload = {
      trackingCode: shipment.trackingCode,
      status: event.status,
      statusLabel,
      title: event.title,
      message: event.description ?? event.title,
      description: event.description,
      occurredAt: event.occurredAt.toISOString(),
      estimatedDeliveryAt: shipment.estimatedDeliveryAt?.toISOString() ?? null,
      actionUrl: actionUrlFor(shipment.trackingCode),
      actionLabel: role === 'courier' ? 'Ver envío asignado' : 'Ver envío',
    };

    try {
      await enqueueForUser({
        userId,
        shipmentId: shipment.id,
        template,
        payload,
      });

      logger.info(
        {
          trackingCode: shipment.trackingCode,
          status: event.status,
          recipient: role,
        },
        'Notificacion encolada',
      );
    } catch (error) {
      logger.warn(
        {
          err: error,
          trackingCode: shipment.trackingCode,
          status: event.status,
          recipient: role,
        },
        'No se pudo encolar la notificacion',
      );
    }
  }
}

function courierDestination(shipment: CourierShipmentInfo): string {
  return (
    shipment.destDepartment?.name ??
    shipment.destinationBranch?.city ??
    shipment.recipientAddress?.city ??
    'destino'
  );
}

function courierOrigin(shipment: CourierShipmentInfo): string {
  return (
    shipment.originDepartment?.name ??
    shipment.originBranch?.city ??
    'origen'
  );
}

/** Aviso al repartidor cuando se le asigna un envio. */
export async function notifyCourierAssigned(
  shipment: CourierShipmentInfo,
  courier: { id: string; firstName: string; lastName: string },
  actorId?: string | null,
): Promise<void> {
  if (courier.id === actorId) return;

  const origin = courierOrigin(shipment);
  const destination = courierDestination(shipment);
  const recipient = shipment.recipientAddress;
  const title = 'Nuevo envío asignado';
  const message = [
    `Se te asignó el envío ${shipment.trackingCode} de ${origin} a ${destination}.`,
    recipient?.contactName
      ? `Receptor: ${recipient.contactName}${recipient.contactPhone ? ` · ${recipient.contactPhone}` : ''}.`
      : null,
    'Revisa los datos y el estado en el sistema antes de salir a reparto.',
  ]
    .filter(Boolean)
    .join(' ');

  const payload = {
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    statusLabel: STATUS_DEFINITIONS[shipment.status]?.label ?? shipment.status,
    title,
    message,
    occurredAt: new Date().toISOString(),
    estimatedDeliveryAt: shipment.estimatedDeliveryAt?.toISOString() ?? null,
    actionUrl: actionUrlFor(shipment.trackingCode),
    actionLabel: 'Ver envío asignado',
    origin,
    destination,
    recipientName: recipient?.contactName ?? null,
    recipientPhone: recipient?.contactPhone ?? null,
  };

  try {
    await enqueueForUser({
      userId: courier.id,
      shipmentId: shipment.id,
      template: 'courier_shipment_assigned',
      payload,
    });
  } catch (error) {
    logger.warn(
      { err: error, trackingCode: shipment.trackingCode, courierId: courier.id },
      'No se pudo notificar la asignacion al repartidor',
    );
  }
}

/** Aviso al repartidor cuando se le quita un envio. */
export async function notifyCourierUnassigned(
  shipment: CourierShipmentInfo,
  courier: { id: string; firstName: string; lastName: string },
): Promise<void> {
  const title = 'Envío desasignado';
  const message = `Se te quitó la asignación del envío ${shipment.trackingCode}.`;

  try {
    await enqueueForUser({
      userId: courier.id,
      shipmentId: shipment.id,
      template: 'courier_shipment_unassigned',
      payload: {
        trackingCode: shipment.trackingCode,
        status: shipment.status,
        statusLabel: STATUS_DEFINITIONS[shipment.status]?.label ?? shipment.status,
        title,
        message,
        occurredAt: new Date().toISOString(),
        actionUrl: actionUrlFor(shipment.trackingCode),
        actionLabel: 'Ver envío',
      },
    });
  } catch (error) {
    logger.warn(
      { err: error, trackingCode: shipment.trackingCode, courierId: courier.id },
      'No se pudo notificar la desasignacion al repartidor',
    );
  }
}

/**
 * Envia la notificacion pendiente. Idempotente: si ya esta SENT o
 * DELIVERED, no vuelve a enviar.
 */
export async function dispatchNotification(
  notificationId: string,
): Promise<{ status: NotificationStatus; error?: string }> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
    select: {
      id: true,
      status: true,
      channel: true,
      template: true,
      payload: true,
      attempts: true,
      userId: true,
    },
  });

  if (!notification) return { status: 'FAILED', error: 'Notificacion no encontrada' };
  if (notification.status === 'SENT' || notification.status === 'DELIVERED') {
    return { status: notification.status };
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { status: 'SENDING', attempts: { increment: 1 } },
  });

  const user = await prisma.user.findUnique({
    where: { id: notification.userId },
    select: { email: true, notificationEmail: true, phoneHash: true },
  });

  if (!user) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'SKIPPED', error: 'El usuario de la notificacion no existe' },
    });
    return { status: 'SKIPPED', error: 'El usuario de la notificacion no existe' };
  }

  try {
    if (notification.channel === 'IN_APP') {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: 'SENT', sentAt: new Date(), deliveredAt: new Date(), error: null },
      });
      return { status: 'SENT' };
    }

    if (notification.channel === 'EMAIL') {
      return await dispatchEmailNotification(notification, user);
    }

    if (notification.channel === 'WHATSAPP') {
      return await dispatchWhatsAppNotification(notification, user);
    }

    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: 'SKIPPED', error: `Canal no soportado: ${notification.channel}` },
    });
    return { status: 'SKIPPED', error: `Canal no soportado: ${notification.channel}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error desconocido';
    const attempts = notification.attempts + 1;

    // Tras varios intentos se marca FAILED para no reintentar en bucle:
    // una direccion invalida o un token vencido fallara siempre.
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: attempts >= 5 ? 'FAILED' : 'QUEUED', error: message.slice(0, 500) },
    });

    logger.warn({ notificationId, attempts, err: message }, 'Notificacion fallida');
    return { status: attempts >= 5 ? 'FAILED' : 'QUEUED', error: message };
  }
}

async function dispatchEmailNotification(
  notification: {
    id: string;
    template: string;
    payload: Prisma.JsonValue;
    attempts: number;
  },
  user: { email: string; notificationEmail: string | null },
): Promise<{ status: NotificationStatus; error?: string }> {
  const to = (user.notificationEmail?.trim() || user.email).trim();
  if (!to) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SKIPPED', error: 'El usuario no tiene correo registrado' },
    });
    return { status: 'SKIPPED', error: 'El usuario no tiene correo registrado' };
  }

  const payload = (notification.payload ?? {}) as Record<string, unknown>;
  const title = String(payload.title ?? 'Actualización de tu envío');
  const message = String(
    payload.message ?? payload.description ?? 'Hay una actualización en el sistema.',
  );

  const email = buildNotificationEmail({
    title,
    message,
    trackingCode: payload.trackingCode ? String(payload.trackingCode) : null,
    statusLabel: payload.statusLabel ? String(payload.statusLabel) : null,
    occurredAt: payload.occurredAt ? new Date(String(payload.occurredAt)) : null,
    estimatedDeliveryAt: payload.estimatedDeliveryAt
      ? new Date(String(payload.estimatedDeliveryAt))
      : null,
    actionUrl: payload.actionUrl ? String(payload.actionUrl) : null,
    actionLabel: payload.actionLabel ? String(payload.actionLabel) : null,
  });

  const result = await sendEmail({ ...email, to });

  if (!result.delivered) {
    const error = 'Correo registrado en el log (sin proveedor configurado)';
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SKIPPED', error },
    });
    return { status: 'SKIPPED', error };
  }

  await prisma.notification.update({
    where: { id: notification.id },
    data: {
      status: 'SENT',
      providerMessageId: result.providerMessageId,
      sentAt: new Date(),
      error: null,
    },
  });

  return { status: 'SENT' };
}

async function dispatchWhatsAppNotification(
  notification: {
    id: string;
    template: string;
    payload: Prisma.JsonValue;
    attempts: number;
  },
  user: { phoneHash: string | null },
): Promise<{ status: NotificationStatus; error?: string }> {
  if (!user.phoneHash) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SKIPPED', error: 'El usuario no tiene telefono registrado' },
    });
    return { status: 'SKIPPED', error: 'El usuario no tiene telefono registrado' };
  }

  if (!env.WHATSAPP_ENABLED) {
    await prisma.notification.update({
      where: { id: notification.id },
      data: { status: 'SKIPPED', error: 'WHATSAPP_ENABLED=false' },
    });
    return { status: 'SKIPPED', error: 'WHATSAPP_ENABLED=false' };
  }

  const payload = (notification.payload ?? {}) as Record<string, unknown>;
  const trackingCode = String(payload.trackingCode ?? '');
  const statusLabel = String(payload.statusLabel ?? '');

  const template = buildTemplate(notification.template, statusLabel, trackingCode, payload);
  const { messageId } = await sendWhatsAppTemplate(user.phoneHash, template);

  await prisma.notification.update({
    where: { id: notification.id },
    data: { status: 'SENT', providerMessageId: messageId, sentAt: new Date(), error: null },
  });

  return { status: 'SENT' };
}

function buildTemplate(
  template: string,
  statusLabel: string,
  trackingCode: string,
  payload: Record<string, unknown>,
) {
  if (template === 'shipment_out_for_delivery') {
    const eta = payload.estimatedDeliveryAt
      ? new Date(String(payload.estimatedDeliveryAt)).toLocaleDateString('es')
      : 'hoy';
    return SHIPMENT_TEMPLATES.shipmentOutForDelivery(trackingCode, eta);
  }

  if (template === 'shipment_delivered') {
    const at = payload.occurredAt ? new Date(String(payload.occurredAt)).toLocaleString('es') : '';
    return SHIPMENT_TEMPLATES.shipmentDelivered(trackingCode, at);
  }

  if (template === 'shipment_exception') {
    return SHIPMENT_TEMPLATES.shipmentException(trackingCode, statusLabel);
  }

  return SHIPMENT_TEMPLATES.shipmentStatusUpdate(trackingCode, statusLabel);
}

// ── OTP de confirmacion de entrega ────────────────────────────

/**
 * Envia el OTP al receptor para que confirme la entrega.
 * Es la proteccion anti-fraude: sin este codigo, el repartidor no
 * puede marcar la entrega como verificada.
 *
 * Primero intenta WhatsApp (si esta configurado) y, si no hay
 * telefono/proveedor o el envio falla, usa el mismo correo que el OTP
 * de registro de cuentas. En desarrollo el codigo se devuelve en
 * `devCode` para poder probar el flujo completo sin proveedor.
 */
export interface DeliveryOtpResult {
  sent: boolean;
  /** Canal por el que salio el codigo. `null` si no se envio. */
  channel: 'WHATSAPP' | 'EMAIL' | null;
  expiresAt?: Date;
  error?: string;
  /** Solo en desarrollo y solo cuando no se pudo enviar. */
  devCode?: string;
}

export async function sendDeliveryOtp(
  shipmentId: string,
  actorId: string,
): Promise<DeliveryOtpResult> {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, trackingCode: true, recipientId: true },
  });

  if (!shipment) return { sent: false, channel: null, error: 'Envio no encontrado' };
  if (!shipment.recipientId) {
    return { sent: false, channel: null, error: 'El envio no tiene receptor registrado' };
  }

  // Un OTP nuevo en cada solicitud, no se reutiliza uno viejo: si el
  // repartidor recibio un codigo antes, uno nuevo invalida el anterior.
  const { code, expiresAt } = await issueOtp(
    shipment.recipientId,
    shipment.id,
    'DELIVERY_CONFIRMATION',
  );

  // En produccion el codigo NUNCA sale de aqui: solo viaja al receptor.
  const exposeCode = !env.isProduction;
  const devCode = exposeCode ? { devCode: code } : {};

  const user = await prisma.user.findUnique({
    where: { id: shipment.recipientId },
    select: { email: true, notificationEmail: true, phoneHash: true },
  });

  if (!user) {
    return { sent: false, channel: null, expiresAt, error: 'Receptor no encontrado', ...devCode };
  }

  // 1) WhatsApp, si esta disponible.
  if (env.WHATSAPP_ENABLED && user.phoneHash) {
    try {
      const { messageId } = await sendWhatsAppTemplate(
        user.phoneHash,
        SHIPMENT_TEMPLATES.deliveryOtp(shipment.trackingCode, code),
      );

      await recordNotification({
        userId: shipment.recipientId,
        shipmentId: shipment.id,
        channel: 'WHATSAPP',
        template: 'delivery_otp',
        payload: { trackingCode: shipment.trackingCode },
        providerMessageId: messageId,
      });

      return { sent: true, channel: 'WHATSAPP', expiresAt };
    } catch (error) {
      logger.warn(
        {
          err: error,
          trackingCode: shipment.trackingCode,
          requestedBy: actorId,
        },
        'OTP de entrega: WhatsApp fallo, se intenta por correo',
      );
    }
  }

  // 2) Correo, reutilizando el proveedor del OTP de registro.
  const to = (user.notificationEmail?.trim() || user.email).trim();
  let emailLogged = false;
  if (to) {
    try {
      const result = await sendEmail({ ...buildDeliveryOtpEmail(shipment.trackingCode, code), to });

      if (result.delivered) {
        await recordNotification({
          userId: shipment.recipientId,
          shipmentId: shipment.id,
          channel: 'EMAIL',
          template: 'delivery_otp',
          payload: { trackingCode: shipment.trackingCode },
          providerMessageId: result.providerMessageId,
        });
        return { sent: true, channel: 'EMAIL', expiresAt };
      }

      emailLogged = true;
      await recordNotification({
        userId: shipment.recipientId,
        shipmentId: shipment.id,
        channel: 'EMAIL',
        template: 'delivery_otp',
        payload: { trackingCode: shipment.trackingCode },
        status: 'SKIPPED',
        error: 'Correo registrado en el log (sin proveedor configurado)',
      });
    } catch (error) {
      return {
        sent: false,
        channel: null,
        expiresAt,
        error: error instanceof Error ? error.message : 'Error enviando el OTP por correo',
        ...devCode,
      };
    }
  }

  logger.info(
    {
      trackingCode: shipment.trackingCode,
      requestedBy: actorId,
      ...(exposeCode ? { otp: code } : {}),
    },
    'OTP de entrega generado (sin canal de envio disponible)',
  );

  return {
    sent: false,
    channel: null,
    expiresAt,
    error: emailLogged
      ? 'Correo registrado en el log (sin proveedor configurado)'
      : 'No hay un canal de envio disponible para el receptor',
    ...devCode,
  };
}

// ── Consulta y lectura de notificaciones ──────────────────────

export async function listUserNotifications(
  userId: string,
  options: { limit?: number; unreadOnly?: boolean; channel?: NotificationChannel } = {},
) {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.channel ? { channel: options.channel } : {}),
    },
    select: {
      id: true,
      channel: true,
      template: true,
      payload: true,
      status: true,
      queuedAt: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      shipmentId: true,
      error: true,
    },
    orderBy: { queuedAt: 'desc' },
    take: options.limit ?? 30,
  });
}

export async function countUnreadNotifications(userId: string): Promise<number> {
  // Solo los avisos dentro de la app cuentan para el badge. Las filas
  // de correo/WhatsApp son el registro de entrega de esos mismos avisos.
  return prisma.notification.count({
    where: { userId, channel: 'IN_APP', readAt: null },
  });
}

export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, channel: 'IN_APP', readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}
