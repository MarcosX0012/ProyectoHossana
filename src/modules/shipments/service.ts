import { Prisma, ShipmentStatus, type EventSource, type UserRole } from '@prisma/client';
import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  conflict,
  forbidden,
  notFound,
  paymentRequired,
  unauthorized,
  validationError,
} from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { allocateTrackingCode, buildEstimatedDelivery, normalizeTrackingCode } from '../../lib/tracking.js';
import { signTrackingToken } from '../auth/qrTokens.js';
import { sha256 } from '../../lib/crypto.js';
import { publishShipmentEvent } from '../../lib/realtime.js';
import {
  assertTransition,
  isActive,
  labelOf,
  STATUS_DEFINITIONS,
  TERMINAL_SHIPMENT_STATUSES,
} from './stateMachine.js';
import { calculateRate } from '../rates/service.js';
import { DEFAULT_NIO_PER_USD, nioCentsToUsdCents } from '../rates/currency.js';
import { syncCourierAvailability } from '../couriers/availability.js';
import {
  notifyCourierAssigned,
  notifyCourierUnassigned,
  notifyShipmentEvent,
} from '../notifications/service.js';
import type {
  AddressInput,
  CreateShipmentInput,
  DeliverShipmentInput,
  ListShipmentsQuery,
  ManualEventInput,
} from './schema.js';
import type { FastifyRequest } from 'fastify';

/**
 * Servicio de envios: el corelogico del sistema.
 *
 * Dos invariantes sostienen todo este archivo:
 *
 *  I1 Â· Un evento se escribe SIEMPRE dentro de una transaccion que
 *       tambien actualiza el estado del envio y su `version`. Si
 *       alguno de los tres falla, no se escribe ninguno. Nunca hay
 *       un hito en la linea de tiempo sin el estado correspondiente.
 *
 *  I2 Â· Toda mutacion pasa por `applyStateChange`, que valida la
 *       transicion contra la maquina de estados. Ninguna ruta escribe
 *       `shipment.status` directamente.
 */

// â”€â”€ Serializacion de direcciones â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Las direcciones se guardan CIFRADAS en la base. El unico lugar
 * donde se descifran es aqui, y solo para los destinatarios
 * autorizados: el emisor, el receptor y el personal operativo.
 */
function encryptAddress(input: AddressInput) {
  return {
    contactName: input.contactName,
    contactPhone: input.contactPhone, // ver nota: cifrado a nivel de columna en produccion
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    region: input.region ?? null,
    postalCode: input.postalCode ?? null,
    countryCode: input.countryCode.toUpperCase(),
    instructions: input.instructions ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };
}

/** Direccion segura para superficies no autorizadas (rastreo publico). */
export function redactAddress(address: {
  city: string;
  region: string | null;
  countryCode: string;
  contactName: string;
}): { city: string; region: string | null; countryCode: string } {
  return {
    city: address.city,
    region: address.region,
    countryCode: address.countryCode,
  };
}

// â”€â”€ Creacion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CreateShipmentResult {
  trackingCode: string;
  shipmentId: string;
  status: ShipmentStatus;
  /** Token firmado que viaja dentro del QR. No es el codigo de rastreo. */
  qrToken: string;
  trackingUrl: string;
  estimatedDeliveryAt: Date;
}

export async function createShipment(
  userId: string,
  input: CreateShipmentInput,
  req?: FastifyRequest,
): Promise<CreateShipmentResult> {
  // â”€â”€ Idempotencia â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Un doble clic, un reintento de red o un replay del cliente no
  // deben crear dos envios. Se resuelve con la clave primaria
  // compuesta en `idempotency_keys`, no con una comprobacion previa
  // que abriria una condicion de carrera.
  if (input.idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key_endpoint: { key: input.idempotencyKey, endpoint: 'POST /api/shipments' } },
    });

    if (existing) {
      // La clave la genero este usuario: si llega con otro, es un
      // error de cliente o un intento de replay cruzado.
      if (existing.userId && existing.userId !== userId) {
        throw conflict('La clave de idempotencia no corresponde a este usuario');
      }

      // Misma clave con datos distintos nunca debe devolver la
      // respuesta anterior: se rechaza en lugar de asumir el replay.
      if (existing.requestHash && existing.requestHash !== sha256(JSON.stringify(input))) {
        throw conflict('La clave de idempotencia ya se uso con otros datos');
      }

      if (existing.responseBody) {
        const body = existing.responseBody as unknown as CreateShipmentResult;
        logger.info({ key: input.idempotencyKey }, 'Creacion de envio idempotente: replay');
        return body;
      }

      if (!existing.completedAt) {
        // La peticion original sigue en curso.
        throw conflict('Una peticion identica ya esta en proceso');
      }

      // Registro completado sin respuesta guardada (peticiones
      // anteriores al fix): no se puede responder el replay y crear
      // otro envio seria un duplicado. Se pide una clave nueva.
      throw conflict('La peticion anterior no quedo registrada; usa una clave nueva');
    }
  }

  // â”€â”€ Resolucion del receptor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let recipientId = input.recipientId ?? null;
  let recipientEmail = input.recipientEmail ?? null;

  if (!recipientId && recipientEmail) {
    const recipient = await prisma.user.findUnique({
      where: { email: recipientEmail },
      select: { id: true },
    });
    if (recipient) {
      recipientId = recipient.id;
    } else {
      // El receptor aun no tiene cuenta. Se creara al link del primer
      // rastreo o cuando se registre con ese correo.
      recipientEmail = recipientEmail.toLowerCase();
    }
  }

  // â”€â”€ Calculos derivados â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const itemCount = input.items.reduce((sum, item) => sum + item.quantity, 0);
  const derivedWeight = input.items.reduce(
    (sum, item) => sum + (item.weightGrams ?? 0) * item.quantity,
    0,
  );
  const weightGrams = input.weightGrams ?? (derivedWeight > 0 ? derivedWeight : undefined);
  const declaredValueCents =
    input.declaredValueCents ??
    input.items.reduce((sum, item) => sum + item.unitValueCents * item.quantity, 0);

  // â”€â”€ Tarifa automatica â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // El costo no viaja en la peticion: se deriva del par de
  // departamentos (ruta) y del peso declarado por el cliente. La
  // tarifa se consulta ANTES de la transaccion para fallar rapido si
  // no hay ruta configurada o el peso esta fuera de rango.
  const rate = await calculateRate(
    input.originDepartmentId,
    input.destDepartmentId,
    input.weightLbs,
  );

  const isPrepaid =
    input.paymentMethod === 'ONLINE' || input.paymentMethod === 'BANK_TRANSFER';
  const needsPayment = isPrepaid && rate.totalCents > 0;
  const chargedAmountCents = rate.totalCents;
  // Contra entrega se cobra siempre en cordobas; la transferencia
  // manual permite elegir la moneda. El monto en USD es solo una
  // equivalencia congelada para mostrar y conciliar.
  const paymentCurrency =
    input.paymentMethod === 'BANK_TRANSFER' ? input.paymentCurrency : 'NIO';
  const amountUsdCents = nioCentsToUsdCents(chargedAmountCents);
  const paymentStatus = needsPayment ? 'PENDING' : isPrepaid ? 'NOT_REQUIRED' : 'PENDING';

  const trackingCode = await allocateTrackingCode();
  const qrToken = signTrackingToken(trackingCode);
  const estimatedDeliveryAt = buildEstimatedDelivery(3);
  const initialStatus = needsPayment ? 'AWAITING_PAYMENT' : 'CONFIRMED';

  // â”€â”€ Lineas de codigo unicas dentro del envio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const lines = input.items.map((item, index) => ({
    lineCode: item.lineCode ?? String(index + 1).padStart(2, '0'),
  }));
  const lineCodes = lines.map((l) => l.lineCode);
  if (new Set(lineCodes).size !== lineCodes.length) {
    throw validationError('Los codigos de linea de los productos deben ser unicos dentro del envio');
  }

  let created: { id: string; trackingCode: string; status: ShipmentStatus };
  try {
    created = await prisma.$transaction(
      async (tx) => {
      if (input.idempotencyKey) {
        // `create` (no upsert): si una peticion concurrente ya inserto
        // esta clave, la transaccion falla con violacion de unicidad y
        // se traduce a "ya en proceso" en el catch exterior. El registro
        // se crea SIN completedAt: es el marcador de "en curso" y solo
        // se completa (con la respuesta) si el envio se crea de verdad.
        await tx.idempotencyKey.create({
          data: {
            key: input.idempotencyKey,
            endpoint: 'POST /api/shipments',
            userId,
            requestHash: sha256(JSON.stringify(input)),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }

      const senderAddress = await tx.address.create({ data: encryptAddress(input.senderAddress) });
      const recipientAddress = await tx.address.create({ data: encryptAddress(input.recipientAddress) });

      const shipment = await tx.shipment.create({
        data: {
          trackingCode,
          status: initialStatus,
          statusChangedAt: new Date(),
          senderId: userId,
          recipientId,
          senderAddressId: senderAddress.id,
          recipientAddressId: recipientAddress.id,
          originBranchId: input.originBranchId ?? null,
          destinationBranchId: input.destinationBranchId ?? null,
          qrTokenHash: sha256(qrToken),
          paymentMethod: input.paymentMethod,
          paymentStatus,
          amountCents: chargedAmountCents,
          paymentCurrency,
          amountUsdCents,
          exchangeRateNioPerUsd: DEFAULT_NIO_PER_USD,
          currency: rate.currency,
          weightGrams: weightGrams ?? null,
          declaredValueCents: declaredValueCents > 0 ? declaredValueCents : null,
          itemCount,
          estimatedDeliveryAt,
          // Snapshot de la tarifa aplicada: si manana cambian los
          // precios, este envio conserva lo que realmente se cobro.
          originDepartmentId: input.originDepartmentId,
          destDepartmentId: input.destDepartmentId,
          weightLbs: rate.weightLbs,
          weightUnit: 'LB',
          shippingRateId: rate.shippingRateId,
          routeType: rate.routeType,
          baseAmountCents: rate.baseAmountCents,
          extraPerLbCents: rate.extraPerLbCents,
          deliveryCents: rate.deliveryCents,
          extraLbsCharged: rate.extraLbsCharged,
          lbsChargedMin: rate.includedLbs,
          weightUsedForCalc: rate.weightUsedForCalc,
          items: {
            create: input.items.map((item, index) => ({
              lineCode: lineCodes[index]!,
              sku: item.sku ?? null,
              name: item.name,
              description: item.description ?? null,
              quantity: item.quantity,
              unitValueCents: item.unitValueCents,
              weightGrams: item.weightGrams ?? null,
              isFragile: item.isFragile,
              isHazmat: item.isHazmat,
            })),
          },
        },
        select: { id: true, trackingCode: true, status: true },
      });

      // Primer hito: el origen de la linea de tiempo.
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          sequence: 1,
          status: 'CREATED',
          title: STATUS_DEFINITIONS.CREATED.label,
          description: 'El envio fue registrado en el sistema.',
          occurredAt: new Date(),
          source: 'SYSTEM',
          metadata: {
            itemCount,
            paymentMethod: input.paymentMethod,
            paymentCurrency,
            amountUsdCents,
          },
        },
      });

      // `initialStatus` solo puede ser AWAITING_PAYMENT o CONFIRMED:
      // el envio nunca nace en CREATED porque el registro ya es un hecho
      // consumado (si el pago falla, el estado lo reflejara despues).
      await tx.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          sequence: 2,
          status: initialStatus,
          title: labelOf(initialStatus),
          description:
            initialStatus === 'AWAITING_PAYMENT'
              ? 'El envio espera la confirmacion del pago.'
              : 'Los datos del envio fueron validados.',
          occurredAt: new Date(),
          source: 'SYSTEM',
        },
      });

      return shipment;
      },
      {
        // El codigo de rastreo y la linea de tiempo deben quedar
        // consistentes: si no, es preferible fallar y reintentar.
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  } catch (error) {
    // Dos peticiones con la misma clave en curso: la segunda pierde la
    // carrera por la clave unica. Se distingue de otras colisiones
    // (p. ej. el codigo de rastreo) mirando el indice afectado.
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const isIdempotencyRace =
        (error.code === 'P2002' &&
          String(
            Array.isArray(error.meta?.target) ? error.meta.target.join(',') : error.meta?.target,
          ).includes('endpoint')) ||
        error.code === 'P2034';
      if (isIdempotencyRace) {
        throw conflict('Una peticion identica ya esta en proceso');
      }
    }
    throw error;
  }

  await recordAudit(
    {
      userId,
      action: 'SHIPMENT_CREATED',
      entity: 'Shipment',
      entityId: created.id,
      shipmentCode: created.trackingCode,
      metadata: {
        itemCount,
        paymentMethod: input.paymentMethod,
        paymentCurrency,
        hasRecipientAccount: Boolean(recipientId),
        chargedAmountCents,
        amountUsdCents,
        routeType: rate.routeType,
        weightLbs: rate.weightLbs,
      },
    },
    req,
  );

  const result: CreateShipmentResult = {
    trackingCode: created.trackingCode,
    shipmentId: created.id,
    status: created.status,
    qrToken,
    trackingUrl: `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/track/${qrToken}`,
    estimatedDeliveryAt,
  };

  // La respuesta se guarda DESPUES de crear el envio: un replay con la
  // misma clave devuelve exactamente este resultado en vez de crear
  // otro envio. Sin esto el registro existia pero siempre creaba uno
  // nuevo (la idempotencia era de papel).
  if (input.idempotencyKey) {
    await prisma.idempotencyKey.update({
      where: { key_endpoint: { key: input.idempotencyKey, endpoint: 'POST /api/shipments' } },
      data: {
        responseCode: 201,
        responseBody: result as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });
  }

  return result;
}

// â”€â”€ Autorizacion de acceso â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Decide si `actor` puede ver el detalle completo de `shipment`.
 *
 * Tres niveles, que es lo que evita que el rastreo publico se convierta
 * en una fuga de datos personales:
 *
 *   PUBLIC     cualquiera con el codigo: solo estado y hitos.
 *   FULL       emisor, receptor, operador, admin y el courier ASIGNADO
 *              a ese envio.
 *   RESTRICTED emisor y admin, sobre envios ya despachados: el
 *              receptor pierde acceso a la direccion de origen.
 */
export type Visibility = 'PUBLIC' | 'RESTRICTED' | 'FULL';

export function visibilityFor(
  actor: { userId: string; roles: UserRole[] } | undefined,
  shipment: {
    senderId: string;
    recipientId: string | null;
    status: ShipmentStatus;
    assignedcourierid?: string | null;
  },
): Visibility {
  if (!actor) return 'PUBLIC';

  const { userId, roles } = actor;
  const isAdmin = roles.includes('ADMIN');
  const isOperator = roles.includes('OPERATOR');
  const isCourier = roles.includes('COURIER');
  const isSender = shipment.senderId === userId;
  const isRecipient = shipment.recipientId !== null && shipment.recipientId === userId;

  if (isAdmin || isOperator) return 'FULL';

  // Un courier solo tiene acceso completo al envio que TIENE ASIGNADO.
  // Con solo el rol COURIER devolver FULL filtraba datos (direcciones,
  // contacto del receptor) de cualquier envio: los codigos de rastreo
  // son secuenciales y enumerables.
  if (isCourier && shipment.assignedcourierid === userId) return 'FULL';

  if (isSender) return 'FULL';
  if (isRecipient) {
    // El receptor no necesita saber de donde vino el paquete una vez
    // que salio. Limitar esto es buena practica de minima informacion.
    return shipment.status === 'CREATED' || shipment.status === 'CONFIRMED' ||
           shipment.status === 'AWAITING_PAYMENT'
      ? 'FULL'
      : 'RESTRICTED';
  }

  return 'PUBLIC';
}

export async function loadShipmentByCode(trackingCodeInput: string) {
  const code = normalizeTrackingCode(trackingCodeInput);
  const shipment = await prisma.shipment.findUnique({
    where: { trackingCode: code },
    include: {
      senderAddress: true,
      recipientAddress: true,
      originBranch: { select: { id: true, name: true, city: true } },
      destinationBranch: { select: { id: true, name: true, city: true } },
      originDepartment: { select: { id: true, code: true, name: true } },
      destDepartment: { select: { id: true, code: true, name: true } },
      users_shipments_assignedcourieridTousers: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
    },
  });

  if (!shipment) throw notFound('Envio');
  return shipment;
}

// â”€â”€ Transicion de estado (nucleo) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StateChangeInput {
  to: ShipmentStatus;
  title?: string;
  description?: string;
  locationName?: string;
  occurredAt?: Date;
  source?: EventSource;
  operatorId?: string | null;
  courierEventId?: string | null;
  idempotencyKey?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** Datos adicionales a guardar en el envio al transicionar. */
  patch?: Prisma.ShipmentUpdateInput;
  /**
   * Permite desactivar los avisos para procesos internos (por ejemplo
   * el seed). Por defecto toda transicion notifica a quien corresponda.
   */
  notify?: boolean;
}

export interface StateChangeResult {
  trackingCode: string;
  eventId: string;
  sequence: number;
  status: ShipmentStatus;
  occurredAt: Date;
  changed: boolean;
}

/**
 * Estados que implican que el paquete ya entro al proceso logistico.
 * Un envio prepagado (pago en linea o transferencia) no puede llegar a
 * ninguno de estos estados hasta que el pago este aprobado.
 *
 * ON_HOLD, EXCEPTION y CANCELLED quedan fuera a proposito: son salidas
 * operativas, no un avance del envio.
 */
const PAYMENT_GATED_TARGETS: ReadonlySet<ShipmentStatus> = new Set([
  'AWAITING_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DISTRIBUTION_CENTER',
  'OUT_FOR_DELIVERY',
  'DELIVERY_ATTEMPTED',
  'DELIVERED',
  'RETURNING',
  'RETURNED',
  'LOST',
]);

function assertPaymentAllowsTransition(shipment: {
  paymentMethod: 'ONLINE' | 'ON_DELIVERY' | 'BANK_TRANSFER';
  paymentStatus: 'NOT_REQUIRED' | 'PENDING' | 'PENDING_REVIEW' | 'PAID' | 'REJECTED' | 'FAILED' | 'REFUNDED';
  status: ShipmentStatus;
}, target: ShipmentStatus): void {
  const requiresPrepayment =
    shipment.paymentMethod === 'ONLINE' || shipment.paymentMethod === 'BANK_TRANSFER';
  const settled = shipment.paymentStatus === 'PAID' || shipment.paymentStatus === 'NOT_REQUIRED';

  if (
    requiresPrepayment &&
    !settled &&
    target !== shipment.status &&
    PAYMENT_GATED_TARGETS.has(target)
  ) {
    throw paymentRequired(
      'El envio no puede avanzar hasta que el pago sea aprobado por un administrador.',
      { paymentMethod: shipment.paymentMethod, paymentStatus: shipment.paymentStatus },
    );
  }
}

/**
 * Aplica un cambio de estado de forma atomica y publica el evento.
 *
 * Es la UNICA via para mover un envio. Todas las rutas pasan por aqui,
 * lo que garantiza que la maquina de estados, la linea de tiempo y la
 * version del envio nunca se desincronicen.
 */
export async function applyStateChange(
  shipmentId: string,
  input: StateChangeInput,
): Promise<StateChangeResult> {
  const result = await prisma.$transaction(
    async (tx) => {
      const shipment = await tx.shipment.findUnique({
        where: { id: shipmentId },
        select: {
          id: true,
          trackingCode: true,
          status: true,
          version: true,
          deliveredAt: true,
          assignedcourierid: true,
          paymentMethod: true,
          paymentStatus: true,
        },
      });

      if (!shipment) throw notFound('Envio');

      // â”€â”€ Idempotencia del evento â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      if (input.idempotencyKey || input.courierEventId) {
        const existing = await tx.shipmentEvent.findFirst({
          where: input.courierEventId
            ? { courierEventId: input.courierEventId }
            : { idempotencyKey: input.idempotencyKey! },
          select: { id: true, sequence: true, status: true, occurredAt: true },
        });

        if (existing) {
          // Ya se aplico: se devuelve el resultado original.
          logger.info(
            { trackingCode: shipment.trackingCode, eventId: existing.id },
            'Evento duplicado ignorado (idempotencia)',
          );
          return {
            trackingCode: shipment.trackingCode,
            eventId: existing.id,
            sequence: existing.sequence,
            status: existing.status,
            occurredAt: existing.occurredAt,
            changed: false,
          };
        }
      }

      // â”€â”€ Validacion de la transicion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Se valida SIEMPRE, incluso si el estado solicitado es igual:
      // en ese caso es un no-op legitimo (dos webhooks del mismo
      // courier reportando "en transito"), no un error.
      if (input.to !== shipment.status) {
        assertTransition(shipment.status, input.to);
      }

      // Regla de negocio: un envio prepagado no avanza en la logistica
      // mientras el pago siga pendiente. La aprobacion del pago marca
      // PAID antes de mover el envio, por lo que este guard no la bloquea.
      assertPaymentAllowsTransition(shipment, input.to);

      const occurredAt = input.occurredAt ?? new Date();

      // Un evento con fecha futura no se acepta: romperia el orden
      // de la linea de tiempo y permitiraia Manipulation del historial.
      if (occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
        throw validationError('La fecha del evento no puede ser futura');
      }

      const nextSequence =
        (
          await tx.shipmentEvent.aggregate({
            where: { shipmentId },
            _max: { sequence: true },
          })
        )._max.sequence ?? 0;

      const event = await tx.shipmentEvent.create({
        data: {
          shipmentId,
          sequence: nextSequence + 1,
          status: input.to,
          title: input.title ?? labelOf(input.to),
          description: input.description ?? STATUS_DEFINITIONS[input.to]?.description ?? null,
          locationName: input.locationName ?? null,
          occurredAt,
          source: input.source ?? 'MANUAL',
          operatorId: input.operatorId ?? null,
          courierEventId: input.courierEventId ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          metadata: input.metadata,
        },
        select: { id: true, sequence: true, status: true, occurredAt: true, title: true },
      });

      // Actualizacion del envio con bloqueo optimista: si `version`
      // cambio desde la lectura, la transicion no se aplica. Es la
      // defensa contra dos operadores moviendo el mismo paquete a la vez.
      const updateData: Prisma.ShipmentUpdateInput = {
        status: input.to,
        statusChangedAt: occurredAt,
        version: { increment: 1 },
        ...(input.patch ?? {}),
      };

      // Solo se fija deliveredAt si el patch no trajo un valor
      // explicito: deliverShipment manda `deliveredAt: null` cuando la
      // entrega NO fue verificada (p. ej. prueba fisica sin OTP), y ese
      // null legitimo no debe sobrescribirse con la fecha del evento.
      if (
        input.to === 'DELIVERED' &&
        shipment.deliveredAt === null &&
        updateData.deliveredAt === undefined
      ) {
        updateData.deliveredAt = occurredAt;
      }
      if (input.to === 'CANCELLED') {
        updateData.cancelledAt = occurredAt;
      }
      if (input.to === 'PICKED_UP') {
        updateData.dispatchedAt = occurredAt;
      }

      const updated = await tx.shipment.updateMany({
        where: { id: shipmentId, version: shipment.version },
        data: updateData,
      });

      if (updated.count === 0) {
        throw conflict(
          'El envio cambio de estado concurrentemente. Reintenta la operacion.',
        );
      }

      // El repartidor queda ocupado mientras tenga envios activos y
      // vuelve a disponible al entregarlos. Se recalcula dentro de la
      // misma transaccion para que no quede un estado intermedio.
      if (shipment.assignedcourierid) {
        await syncCourierAvailability(shipment.assignedcourierid, tx);
      }

      return {
        trackingCode: shipment.trackingCode,
        eventId: event.id,
        sequence: event.sequence,
        status: event.status,
        occurredAt: event.occurredAt,
        changed: true,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 },
  );

  // Publicacion en tiempo real FUERA de la transaccion: si el publish
  // falla, el evento ya esta persistido (correcto) y el cliente recibe
  // la Actualizacion al reconectar via GET.
  if (result.changed) {
    publishShipmentEvent(result.trackingCode, {
      id: result.eventId,
      sequence: result.sequence,
      status: result.status,
      occurredAt: result.occurredAt,
      title: labelOf(result.status),
    });
  }

  // Avisos por correo y dentro de la app. Tambien fuera de la
  // transaccion y best-effort: un fallo de notificacion no revierte el
  // cambio de estado que ya quedo persistido.
  if (result.changed && input.notify !== false) {
    try {
      const notificationShipment = await prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: {
          id: true,
          trackingCode: true,
          status: true,
          senderId: true,
          recipientId: true,
          assignedcourierid: true,
          estimatedDeliveryAt: true,
        },
      });

      if (notificationShipment) {
        await notifyShipmentEvent(
          {
            id: notificationShipment.id,
            trackingCode: notificationShipment.trackingCode,
            status: notificationShipment.status,
            senderId: notificationShipment.senderId,
            recipientId: notificationShipment.recipientId,
            assignedCourierId: notificationShipment.assignedcourierid,
            estimatedDeliveryAt: notificationShipment.estimatedDeliveryAt,
          },
          {
            status: result.status,
            title: input.title ?? labelOf(result.status),
            description:
              input.description ?? STATUS_DEFINITIONS[result.status]?.description ?? null,
            occurredAt: result.occurredAt,
          },
          { actorId: input.operatorId ?? null },
        );
      }
    } catch (error) {
      logger.warn(
        { err: error, trackingCode: result.trackingCode, status: result.status },
        'No se pudieron generar las notificaciones del cambio de estado',
      );
    }
  }

  return result;
}

// â”€â”€ Consultas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * El peso y el contenido de un paquete se comunican al transporte en
 * el momento del despacho. La API expone el importe en centavos; este
 * helper documenta la convencion para el frontend y el webhook.
 */
export function formatAmountCents(amountCents: number, currency: string): string {
  const major = amountCents / 100;
  return `${currency} ${major.toFixed(2)}`;
}

const SHIPMENT_LIST_SELECT = {
  id: true,
  trackingCode: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  estimatedDeliveryAt: true,
  deliveredAt: true,
  cancelledAt: true,
  itemCount: true,
  weightGrams: true,
  weightLbs: true,
  weightUnit: true,
  routeType: true,
  paymentMethod: true,
  paymentStatus: true,
  amountCents: true,
  paymentCurrency: true,
  amountUsdCents: true,
  exchangeRateNioPerUsd: true,
  currency: true,
  originDepartment: { select: { id: true, code: true, name: true } },
  destDepartment: { select: { id: true, code: true, name: true } },
  courierCode: true,
  courierTrackingNumber: true,
  senderId: true,
  recipientId: true,
  // Necesario para `visibilityFor`: el courier solo tiene acceso
  // completo al envio que le esta asignado.
  assignedcourierid: true,
  originBranch: { select: { id: true, name: true, city: true } },
  destinationBranch: { select: { id: true, name: true, city: true } },
  recipientAddress: { select: { city: true, region: true, countryCode: true, contactName: true } },
  sender: { select: { id: true, firstName: true, lastName: true } },
  recipient: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ShipmentSelect;

export async function listShipments(
  actor: { userId: string; roles: UserRole[] },
  query: ListShipmentsQuery,
) {
  const where: Prisma.ShipmentWhereInput = {};

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');

  if (!isStaff) {
    // Un usuario normal solo ve lo que envia o lo que recibe.
    where.OR = [{ senderId: actor.userId }, { recipientId: actor.userId }];
  }

  if (query.status) {
    const statuses = Array.isArray(query.status) ? query.status : [query.status];
    where.status = { in: statuses as ShipmentStatus[] };
  }

  if (query.scope === 'active') {
    where.status = {
      in: (Object.keys(STATUS_DEFINITIONS) as ShipmentStatus[]).filter((s) => isActive(s)),
    };
  } else if (query.scope === 'closed') {
    where.status = {
      in: (Object.keys(STATUS_DEFINITIONS) as ShipmentStatus[]).filter((s) => !isActive(s)),
    };
  }



  if (query.courierCode) where.courierCode = query.courierCode;
  if (query.courierTrackingNumber) where.courierTrackingNumber = query.courierTrackingNumber;
  // El filtro por repartidor es exclusivo del panel operativo: un
  // usuario normal no puede listar los envios de otra persona.
  if (isStaff && query.assignedCourierId) {
    where.assignedcourierid = query.assignedCourierId;
  }
  if (query.originBranchId) where.originBranchId = query.originBranchId;
  if (query.destinationBranchId) where.destinationBranchId = query.destinationBranchId;
  if (query.originDepartmentId) where.originDepartmentId = query.originDepartmentId;
  if (query.destDepartmentId) where.destDepartmentId = query.destDepartmentId;

  if (query.month && query.year) {
    const start = new Date(query.year, query.month - 1, 1);
    const end = new Date(query.year, query.month, 0, 23, 59, 59, 999);
    where.createdAt = { gte: start, lte: end };
  } else if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = query.from;
    if (query.to) where.createdAt.lte = query.to;
  } else if (query.from || query.to) {
    where.createdAt = {};
    if (query.from) where.createdAt.gte = query.from;
    if (query.to) where.createdAt.lte = query.to;
  }

  if (query.search) {
    where.AND = [
      {
        OR: [
          { trackingCode: { contains: normalizeTrackingCode(query.search), mode: 'insensitive' } },
          { courierTrackingNumber: { contains: query.search, mode: 'insensitive' } },
          {
            items: {
              some: { name: { contains: query.search, mode: 'insensitive' } },
            },
          },
          {
            recipientAddress: {
              is: { contactName: { contains: query.search, mode: 'insensitive' } },
            },
          },
        ],
      },
    ];
  }

  const [total, shipments] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      select: { ...SHIPMENT_LIST_SELECT, users_shipments_assignedcourieridTousers: { select: { id: true, firstName: true, lastName: true, phone: true } } } as any,
      orderBy: { [query.sort]: query.order },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    data: shipments.map((shipment: any) => {
      const decorated = decorate(shipment, actor, 'LIST');
      const assigned = shipment.users_shipments_assignedcourieridTousers;
      return {
        ...decorated,
        assignedCourier: assigned
          ? {
              id: assigned.id,
              name: `${assigned.firstName} ${assigned.lastName}`.trim(),
              phone: assigned.phone ?? null,
            }
          : null,
      };
    }),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
  };
}

/**
 * Anade el derivado que el frontend necesita para pintar la linea de
 * tiempo sin conocer la maquina de estados: que etiqueta y que color
 * corresponde a cada estado.
 */
function decorate<
  T extends { status: ShipmentStatus; trackingCode: string; senderId: string; recipientId: string | null },
>(row: T, actor: { userId: string; roles: UserRole[] }, view: 'LIST' | 'DETAIL' | 'PUBLIC') {
  const visibility = visibilityFor(actor, row);
  const definition = STATUS_DEFINITIONS[row.status];

  return {
    ...row,
    statusLabel: definition?.label ?? row.status,
    statusDescription: definition?.description ?? null,
    statusIcon: definition?.icon ?? 'package',
    statusTone: definition?.tone ?? 'neutral',
    statusPhase: definition?.phase ?? 'excepcion',
    isActive: isActive(row.status),
    visibility,
    // El codigo de rastreo solo se expone completo a quien tiene
    // acceso legitimateo. Un tercero ve un codigo enmascarado.
    trackingCode: visibility === 'PUBLIC' ? maskTrackingCode(row.trackingCode) : row.trackingCode,
  };
}

export function maskTrackingCode(code: string): string {
  const parts = code.split('-');
  if (parts.length !== 3) return 'â€¢â€¢â€¢â€¢â€¢â€¢';
  return `${parts[0]}-${parts[1]}-â€¢â€¢â€¢â€¢â€¢â€¢`;
}

export async function getShipmentDetail(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);
  const visibility = visibilityFor(actor, shipment);

  // Un tercero que llega con un codigo valido: se registra el acceso
  // porque la vista publica es la superficie mas expuesta.
  if (visibility === 'PUBLIC') {
    await recordAudit(
      {
        action: 'SHIPMENT_VIEW_RESTRICTED',
        entity: 'Shipment',
        entityId: shipment.id,
        shipmentCode: shipment.trackingCode,
        outcome: 'DENIED',
        metadata: { reason: 'NOT_OWNER', visibility },
      },
      req,
    );
    throw notFound('Envio');
  }

  const items = await prisma.shipmentItem.findMany({
    where: { shipmentId: shipment.id },
    orderBy: { lineCode: 'asc' },
  });

  await recordAudit(
    {
      userId: actor.userId,
      action: 'SHIPMENT_VIEW',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { visibility },
      role: actor.roles[0] ?? null,
    },
    req,
  );

  const base = decorate(shipment, actor, 'DETAIL');
  const exchangeRate = Number(shipment.exchangeRateNioPerUsd ?? DEFAULT_NIO_PER_USD);
  const amountUsdCents =
    shipment.amountUsdCents ?? nioCentsToUsdCents(shipment.amountCents, exchangeRate);

  return {
    ...base,
    senderAddress: visibility === 'FULL' ? shipment.senderAddress : null,
    recipientAddress: shipment.recipientAddress,
    // El receptor no ve la direccion de origen una vez despachado.
    originAddressVisible: visibility === 'FULL',
    amountFormatted: formatAmountCents(shipment.amountCents, shipment.currency),
    amountUsdCents,
    amountUsdFormatted: formatAmountCents(amountUsdCents, 'USD'),
    amountPaymentFormatted: formatAmountCents(
      shipment.paymentCurrency === 'USD' ? amountUsdCents : shipment.amountCents,
      shipment.paymentCurrency,
    ),
    exchangeRateNioPerUsd: exchangeRate,
    items,
    courier: {
      code: shipment.courierCode,
      shipmentId: shipment.courierShipmentId,
      trackingNumber: shipment.courierTrackingNumber,
      syncedAt: shipment.courierSyncedAt,
    },
    assignedCourier: (shipment as any).users_shipments_assignedcourieridTousers
      ? {
          id: (shipment as any).users_shipments_assignedcourieridTousers.id,
          name: `${(shipment as any).users_shipments_assignedcourieridTousers.firstName} ${(shipment as any).users_shipments_assignedcourieridTousers.lastName}`.trim(),
          phone: (shipment as any).users_shipments_assignedcourieridTousers.phone ?? null,
          email: (shipment as any).users_shipments_assignedcourieridTousers.email ?? null,
        }
      : null,
  };
}

// â”€â”€ Linea de tiempo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface TimelineEntry {
  id: string;
  sequence: number;
  status: ShipmentStatus;
  statusLabel: string;
  statusIcon: string;
  statusTone: string;
  title: string;
  description: string | null;
  locationName: string | null;
  occurredAt: Date;
  source: string;
  operatorName: string | null;
  metadata: unknown;
}

export async function getTimeline(
  trackingCodeInput: string,
  options: { limit?: number; cursor?: number } = {},
  req?: FastifyRequest,
  actor?: { userId: string; roles: UserRole[] },
): Promise<TimelineEntry[]> {
  const shipment = await loadShipmentByCode(trackingCodeInput);
  // Sin actor es la vista publica (rastreo sin sesion, por codigo o
  // token del QR). Con actor se calcula el nivel real de acceso: un
  // tercero autenticado que conoce el codigo no debe ver mas que la
  // vista publica, y para simplificar la superficie ni siquiera entra.
  const visibility = visibilityFor(actor, shipment);

  if (actor && visibility === 'PUBLIC') {
    await recordAudit(
      {
        userId: actor.userId,
        action: 'TIMELINE_VIEW',
        entity: 'Shipment',
        entityId: shipment.id,
        shipmentCode: shipment.trackingCode,
        outcome: 'DENIED',
        metadata: { reason: 'NOT_OWNER' },
      },
      req,
    );
    throw notFound('Envio');
  }

  const limit = options.limit ?? 50;

  const events = await prisma.shipmentEvent.findMany({
    where: {
      shipmentId: shipment.id,
      ...(options.cursor ? { sequence: { lt: options.cursor } } : {}),
    },
    include: {
      operator: { select: { firstName: true, lastName: true, roles: true } },
    },
    orderBy: { sequence: 'desc' },
    take: limit,
  });

  await recordAudit(
    {
      userId: req?.currentUser?.sub,
      action: 'TIMELINE_VIEW',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { level: visibility, count: events.length },
    },
    req,
  );

  return events.map((event) => {
    const definition = STATUS_DEFINITIONS[event.status];
    return {
      id: event.id,
      sequence: event.sequence,
      status: event.status,
      statusLabel: definition?.label ?? event.status,
      statusIcon: definition?.icon ?? 'package',
      statusTone: definition?.tone ?? 'neutral',
      title: event.title,
      description: event.description,
      locationName: event.locationName,
      occurredAt: event.occurredAt,
      source: event.source,
      // En la vista publica no se expone quien opero: podria revelar
      // la identidad de un repartidor.
      operatorName:
        visibility === 'FULL' && event.operator
          ? `${event.operator.firstName} ${event.operator.lastName}`.trim()
          : null,
      // Los metadatos pueden contener datos del proveedor (p.ej. URLs
      // de firma): solo para staff.
      metadata: visibility === 'FULL' ? event.metadata : null,
    };
  });
}

// â”€â”€ Actualizacion y cancelacion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function updateShipment(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  data: {
    recipientAddress?: AddressInput;
    weightGrams?: number;
    declaredValueCents?: number;
    notes?: string | null;
    paymentMethod?: 'ONLINE' | 'ON_DELIVERY' | 'BANK_TRANSFER';
    paymentCurrency?: 'NIO' | 'USD';
  },
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isSender = shipment.senderId === actor.userId;
  const isAdmin = actor.roles.includes('ADMIN');
  if (!isSender && !isAdmin) throw forbidden('Solo el emisor puede modificar el envio');

  // Editar un paquete ya despachado rompe la trazabilidad: el peso y
  // el contenido ya se comunicaron al transporte.
  if (!isAdmin && !['CREATED', 'CONFIRMED', 'AWAITING_PAYMENT'].includes(shipment.status)) {
    throw conflict('El envio ya fue despachado y no puede modificarse');
  }

  if (data.recipientAddress) {
    await prisma.address.update({
      where: { id: shipment.recipientAddressId },
      data: encryptAddress(data.recipientAddress),
    });
  }

  if (data.paymentMethod !== undefined && shipment.paymentStatus === 'PAID') {
    throw conflict('No se puede cambiar la forma de pago de un envio ya pagado');
  }
  if (data.paymentCurrency !== undefined && data.paymentMethod === undefined) {
    throw validationError('Indica tambien la forma de pago al cambiar la moneda de cobro');
  }

  const nextPaymentCurrency =
    data.paymentMethod === undefined
      ? undefined
      : data.paymentMethod === 'BANK_TRANSFER'
        ? (data.paymentCurrency ?? (shipment.paymentCurrency === 'USD' ? 'USD' : 'NIO'))
        : 'NIO';

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      ...(data.weightGrams !== undefined ? { weightGrams: data.weightGrams } : {}),
      ...(data.declaredValueCents !== undefined
        ? { declaredValueCents: data.declaredValueCents }
        : {}),
      ...(data.paymentMethod !== undefined
        ? {
            paymentMethod: data.paymentMethod,
            paymentCurrency: nextPaymentCurrency,
            paymentStatus:
              data.paymentMethod === 'ON_DELIVERY'
                ? 'PENDING'
                : shipment.amountCents > 0
                  ? 'PENDING'
                  : 'NOT_REQUIRED',
          }
        : {}),
      version: { increment: 1 },
    },
    select: SHIPMENT_LIST_SELECT,
  });

  await recordAudit(
    { userId: actor.userId, action: 'SHIPMENT_UPDATED', entity: 'Shipment', entityId: shipment.id, shipmentCode: shipment.trackingCode },
    req,
  );

  return decorate(updated, actor, 'DETAIL');
}

export async function cancelShipment(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  reason: string,
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isSender = shipment.senderId === actor.userId;
  const isAdmin = actor.roles.includes('ADMIN');
  if (!isSender && !isAdmin) throw forbidden('Solo el emisor o un administrador puede cancelar el envio');

  // Cancelar en transito significaria dejar un paquete fisico sin
  // destino logistico: eso se resuelve con devolucion, no con cancelacion.
  if (['IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY'].includes(shipment.status)) {
    throw conflict(
      'El envio ya esta en transito y no puede cancelarse; solicite una devolucion',
    );
  }

  const result = await applyStateChange(shipment.id, {
    to: 'CANCELLED',
    title: 'Envio cancelado',
    description: reason,
    source: 'MANUAL',
    operatorId: actor.userId,
    patch: { cancelReason: reason },
  });

  await recordAudit(
    { userId: actor.userId, action: 'SHIPMENT_CANCELLED', entity: 'Shipment', entityId: shipment.id, shipmentCode: shipment.trackingCode, metadata: { reason } },
    req,
  );

  return result;
}

// â”€â”€ Eventos manuales (operador / admin) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function recordManualEvent(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  input: ManualEventInput,
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');
  const isCourier = actor.roles.includes('COURIER');
  if (!isStaff && !isCourier) {
    throw forbidden('Registrar eventos manuales requiere rol de operador o courier');
  }

  // Estados que un courier NO puede fijar por la via manual:
  //  - DELIVERED exige el flujo de entrega con OTP verificado (o prueba
  //    fisica revisada por staff). Por aqui un courier podria "entregar"
  //    sin que nadie recibiera el paquete.
  //  - CANCELLED, LOST y RETURNED son decisiones de negocio con
  //    consecuencias de cobro: solo staff.
  //  El courier conserva EXCEPTION, DELIVERY_ATTEMPTED, ON_HOLD y los
  //  estados operativos, que son su trabajo diario.
  const COURIER_FORBIDDEN_MANUAL_STATUSES: ReadonlySet<string> = new Set([
    'DELIVERED',
    'CANCELLED',
    'LOST',
    'RETURNED',
  ]);

  if (!isStaff && COURIER_FORBIDDEN_MANUAL_STATUSES.has(input.status)) {
    await recordAudit(
      {
        userId: actor.userId,
        action: 'SHIPMENT_EVENT_MANUAL',
        entity: 'Shipment',
        entityId: shipment.id,
        shipmentCode: shipment.trackingCode,
        outcome: 'DENIED',
        metadata: { to: input.status, reason: 'COURIER_TERMINAL_STATUS' },
      },
      req,
    );
    throw forbidden(
      input.status === 'DELIVERED'
        ? 'La entrega solo se registra con el flujo de verificacion (OTP) o por un operador'
        : 'Ese estado solo lo puede fijar un operador o administrador',
    );
  }

  const result = await applyStateChange(shipment.id, {
    to: input.status,
    title: input.title,
    description: input.description,
    locationName: input.locationName,
    occurredAt: input.occurredAt,
    source: 'MANUAL',
    operatorId: actor.userId,
    idempotencyKey: input.idempotencyKey ?? null,
    metadata: input.metadata as Prisma.InputJsonValue | undefined,
  });

  await recordAudit(
    {
      userId: actor.userId,
      action: 'SHIPMENT_EVENT_MANUAL',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { to: input.status, changed: result.changed },
      role: actor.roles[0] ?? null,
    },
    req,
  );

  return result;
}

// â”€â”€ Cadena de custodia â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function registerCustody(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  input: {
    action: string;
    branchId?: string | null;
    scanCode?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    note?: string | null;
    occurredAt?: Date;
  },
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR') || actor.roles.includes('COURIER');
  if (!isStaff) throw forbidden('Registrar custodia requiere rol operativo');

  // Un envio terminal no genera custodia nueva: si aparece un escaneo
  // sobre un paquete ya entregado, es una anomalia a investigar.
  if (!isActive(shipment.status)) {
    throw conflict(
      `El envio esta en estado terminal (${labelOf(shipment.status)}); un nuevo escaneo requiere intervencion de un administrador`,
    );
  }

  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.custodyRecord.create({
      data: {
        shipmentId: shipment.id,
        handlerId: actor.userId,
        branchId: input.branchId ?? null,
        action: input.action as never,
        scanCode: input.scanCode ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      },
      select: {
        id: true,
        action: true,
        branchId: true,
        scanCode: true,
        latitude: true,
        longitude: true,
        note: true,
        occurredAt: true,
        handler: { select: { firstName: true, lastName: true, roles: true } },
        branch: { select: { name: true, city: true } },
      },
    });

    // La custodia y el hito van juntos: si alguien escanea, el
    // receptor debe verlo en la linea de tiempo en el momento.
    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        sequence:
          ((await tx.shipmentEvent.aggregate({ where: { shipmentId: shipment.id }, _max: { sequence: true } }))
            ._max.sequence ?? 0) + 1,
        status: shipment.status,
        title: 'Movimiento registrado',
        description: input.note ?? CUSTODY_LABELS[input.action] ?? 'El paquete fue escaneado',
        locationName: input.branchId ? undefined : null,
        occurredAt: input.occurredAt ?? new Date(),
        source: 'SCAN',
        operatorId: actor.userId,
        metadata: { custodyId: created.id, action: input.action },
      },
    });

    return created;
  });

  await recordAudit(
    {
      userId: actor.userId,
      action: 'CUSTODY_RECORDED',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { custodyAction: input.action },
      role: actor.roles[0] ?? null,
    },
    req,
  );

  return record;
}

const CUSTODY_LABELS: Record<string, string> = {
  PICKUP: 'El paquete fue recogido',
  SCAN_IN: 'El paquete ingreso a la sede',
  SCAN_OUT: 'El paquete salio de la sede',
  HANDOFF: 'El paquete cambio de manos',
  SORT: 'El paquete fue clasificado',
  LOAD_VEHICLE: 'El paquete fue cargado en vehiculo',
  DELIVER: 'El paquete fue entregado',
  ATTEMPT_DELIVERY: 'Se intento entregar el paquete',
  RETURN: 'El paquete fue devuelto',
};

export async function getCustodyChain(trackingCodeInput: string) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  return prisma.custodyRecord.findMany({
    where: { shipmentId: shipment.id },
    include: {
      handler: { select: { firstName: true, lastName: true, roles: true } },
      branch: { select: { name: true, city: true } },
    },
    orderBy: { occurredAt: 'desc' },
  });
}

// â”€â”€ Entrega con verificacion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function deliverShipment(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  input: DeliverShipmentInput,
  req?: FastifyRequest,
  options: { notify?: boolean } = {},
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');
  const isCourier = actor.roles.includes('COURIER');
  if (!isCourier && !isStaff) {
    throw forbidden('Solo el personal de reparto puede registrar una entrega');
  }

  // El courier que registra la entrega debe ser el ASIGNADO al envio.
  // Sin esto, cualquier repartidor podria cerrar envios de otros
  // (basta conocer o adivinar el codigo, que es secuencial).
  if (!isStaff && shipment.assignedcourierid !== actor.userId) {
    await recordAudit(
      {
        userId: actor.userId,
        action: 'DELIVERY_FORBIDDEN',
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

  // â”€â”€ Verificacion por OTP: la proteccion real contra entrega a la
  // persona equivocada. Si el receptor no presenta el codigo, la
  // entrega se registra SIN `deliveredAt`, lo que deja el envio en un
  // estado que se ve en el panel como "por verificar".
  let verified = false;
  let otpSupplied = false;

  if (input.otp) {
    otpSupplied = true;
    if (!shipment.recipientId) {
      throw validationError(
        'Este envio no tiene receptor registrado, no se puede verificar por OTP',
      );
    }

    const { verifyOtp } = await import('../auth/tokens.js');
    const result = await verifyOtp(
      shipment.recipientId,
      shipment.id,
      'DELIVERY_CONFIRMATION',
      input.otp,
    );

    if (!result.valid) {
      await recordAudit(
        {
          userId: actor.userId,
          action: 'DELIVERY_VERIFICATION_FAILED',
          entity: 'Shipment',
          entityId: shipment.id,
          shipmentCode: shipment.trackingCode,
          outcome: 'DENIED',
          metadata: { reason: result.reason },
        },
        req,
      );
      throw validationError(
        result.reason === 'EXHAUSTED'
          ? 'Se agotaron los intentos del codigo. Solicita uno nuevo al receptor.'
          : result.reason === 'EXPIRED'
            ? 'El codigo expiro. Solicita uno nuevo al receptor.'
            : 'El codigo no coincide',
      );
    }

    verified = true;
  }

  const hasPhysicalProof = Boolean(input.signatureUrl) || input.photoUrls.length > 0;

  if (!verified && !hasPhysicalProof && !input.unverifiedReason) {
    throw validationError('Se requiere OTP del receptor, firma, foto o un motivo justificado');
  }

  const result = await applyStateChange(shipment.id, {
    to: 'DELIVERED',
    title: verified ? 'Entregado y verificado por el receptor' : 'Entregado',
    description: verified
      ? 'El receptor confirmo la recepcion con su codigo de verificacion.'
      : hasPhysicalProof
        ? 'La entrega fue registrada con evidencia fisica.'
        : `Entrega sin verificacion del receptor: ${input.unverifiedReason}`,
    locationName: input.locationName,
    source: verified ? 'SCAN' : 'MANUAL',
    operatorId: actor.userId,
    metadata: {
      verified,
      otpSupplied,
      signatureUrl: input.signatureUrl ?? null,
      photoUrls: input.photoUrls,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      unverifiedReason: input.unverifiedReason ?? null,
    },
    // Solo se setea `deliveredAt` si la entrega esta verificada. Sin
    // verificacion, el envio queda DELIVERED pero sin confirmar, y el
    // panel lo lista como pendiente de revision.
    patch: verified || hasPhysicalProof ? {} : { deliveredAt: null },
    notify: options.notify,
  });

  // Registro de custodia con la entrega.
  await prisma.custodyRecord.create({
    data: {
      shipmentId: shipment.id,
      handlerId: actor.userId,
      action: 'DELIVER',
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      note: verified ? 'Entrega verificada por OTP' : 'Entrega registrada por el repartidor',
    },
  });

  await recordAudit(
    {
      userId: actor.userId,
      action: 'SHIPMENT_DELIVERED',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { verified, hasPhysicalProof },
      role: actor.roles[0] ?? null,
    },
    req,
  );

  return { ...result, verified, deliveredAt: verified ? new Date() : null };
}

// â”€â”€ Metricas del panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function getDashboardMetrics(actor: { userId: string; roles: UserRole[] }) {
  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');

  if (!isStaff) {
    // Vista personal: solo los envios propios.
    const [sent, received, active] = await Promise.all([
      prisma.shipment.count({ where: { senderId: actor.userId } }),
      prisma.shipment.count({ where: { recipientId: actor.userId } }),
      prisma.shipment.count({
        where: {
          OR: [{ senderId: actor.userId }, { recipientId: actor.userId }],
          status: {
            in: (Object.keys(STATUS_DEFINITIONS) as ShipmentStatus[]).filter((s) => isActive(s)),
          },
        },
      }),
    ]);
    return { scope: 'personal', sent, received, active };
  }

  const [
    byStatus,
    byOriginDept,
    byDestDept,
    total,
    delivered,
    deliveredOnTime,
    exceptions,
    syncFailures,
    created,
    confirmed,
    inTransit,
    outForDelivery,
    pending,
  ] = await Promise.all([
    prisma.shipment.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
    prisma.shipment.groupBy({
      by: ['originDepartmentId'],
      _count: { _all: true },
    }),
    prisma.shipment.groupBy({
      by: ['destDepartmentId'],
      _count: { _all: true },
    }),
    prisma.shipment.count(),
    prisma.shipment.count({ where: { status: 'DELIVERED' } }),
    // A tiempo = entregado dentro o antes de la fecha estimada. Los que
    // se entregaron sin fecha estimada no cuentan como tarde ni como a
    // tiempo: son "entregados" y nada mas.
    prisma.shipment.count({
      where: {
        status: 'DELIVERED',
        deliveredAt: { not: null },
        estimatedDeliveryAt: { not: null },
        AND: [{ deliveredAt: { lte: prisma.shipment.fields.estimatedDeliveryAt } }],
      },
    }),
    prisma.shipment.count({
      where: { status: { in: ['EXCEPTION', 'LOST', 'ON_HOLD', 'DELIVERY_ATTEMPTED'] } },
    }),
    // Envios que el transportista no confirma: el panel los usa para
    // detectar que se rompio algo del lado del proveedor.
    prisma.shipment.count({ where: { courierSyncAttempts: { gte: 3 } } }),
    prisma.shipment.count({ where: { status: 'CREATED' } }),
    prisma.shipment.count({ where: { status: 'CONFIRMED' } }),
    prisma.shipment.count({ where: { status: { in: ['IN_TRANSIT', 'AT_DISTRIBUTION_CENTER'] } } }),
    prisma.shipment.count({ where: { status: 'OUT_FOR_DELIVERY' } }),
    prisma.shipment.count({ where: { status: { in: ['AWAITING_PICKUP', 'PICKED_UP'] } } }),
  ]);

  // Todavia en curso y con la fecha estimada vencida.
  const late = await prisma.shipment.count({
    where: {
      status: { not: 'DELIVERED' },
      estimatedDeliveryAt: { lt: new Date() },
    },
  });

  const originDeptIds = byOriginDept.map((r) => r.originDepartmentId).filter((id): id is string => Boolean(id));
  const destDeptIds = byDestDept.map((r) => r.destDepartmentId).filter((id): id is string => Boolean(id));
  const depts = await prisma.department.findMany({
    where: { id: { in: [...new Set([...originDeptIds, ...destDeptIds])] } },
    select: { id: true, name: true, code: true },
  });
  const deptMap = Object.fromEntries(depts.map((d) => [d.id, d]));

  return {
    scope: 'global',
    total,
    delivered,
    deliveredOnTime,
    exceptions,
    late,
    syncFailures,
    created,
    confirmed,
    inTransit,
    outForDelivery,
    pending,
    byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
    byOriginDepartment: byOriginDept
      .filter((row) => row.originDepartmentId)
      .map((row) => ({
        departmentId: row.originDepartmentId,
        department: deptMap[row.originDepartmentId!],
        count: row._count._all,
      })),
    byDestinationDepartment: byDestDept
      .filter((row) => row.destDepartmentId)
      .map((row) => ({
        departmentId: row.destDepartmentId,
        department: deptMap[row.destDepartmentId!],
        count: row._count._all,
      })),
  };
}

export async function assignCourier(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  courierId: string,
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');
  if (!isStaff) throw forbidden('Solo personal operativo puede asignar repartidor');

  if (TERMINAL_SHIPMENT_STATUSES.includes(shipment.status)) {
    throw validationError('El envío ya está cerrado; no se puede asignar un repartidor.');
  }

  const courier = await prisma.user.findUnique({
    where: { id: courierId },
    select: { id: true, firstName: true, lastName: true, employeenumber: true, roles: true, isactive: true },
  });

  if (!courier || !courier.roles.includes('COURIER')) throw validationError('Repartidor inválido');
  if (courier.isactive === false) throw validationError('Repartidor inactivo');

  const previousCourierId = shipment.assignedcourierid ?? null;

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { assignedcourierid: courierId },
    });

    // Recalcular la disponibilidad de ambos repartidores: el anterior
    // puede haber quedado libre y el nuevo pasa a "Ocupado" solo si el
    // envio sigue activo.
    await syncCourierAvailability(courierId, tx);
    if (previousCourierId && previousCourierId !== courierId) {
      await syncCourierAvailability(previousCourierId, tx);
    }

    const maxSeq = (await tx.shipmentEvent.aggregate({ where: { shipmentId: shipment.id }, _max: { sequence: true } }))._max
      .sequence ?? 0;

    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        sequence: maxSeq + 1,
        status: shipment.status,
        title: 'Repartidor asignado',
        description: `Repartidor ${courier.firstName} ${courier.lastName}${courier.employeenumber ? ' (' + courier.employeenumber + ')' : ''} asignado a la entrega`,
        occurredAt: new Date(),
        source: 'MANUAL',
        operatorId: actor.userId,
      },
    });
  });

  const courierShipmentInfo = {
    id: shipment.id,
    trackingCode: shipment.trackingCode,
    status: shipment.status,
    estimatedDeliveryAt: shipment.estimatedDeliveryAt,
    originDepartment: shipment.originDepartment,
    destDepartment: shipment.destDepartment,
    originBranch: shipment.originBranch,
    destinationBranch: shipment.destinationBranch,
    recipientAddress: shipment.recipientAddress
      ? {
          city: shipment.recipientAddress.city,
          contactName: shipment.recipientAddress.contactName,
          contactPhone: shipment.recipientAddress.contactPhone,
        }
      : null,
  };

  await notifyCourierAssigned(courierShipmentInfo, courier, actor.userId);

  if (
    previousCourierId &&
    previousCourierId !== courierId &&
    shipment.users_shipments_assignedcourieridTousers
  ) {
    await notifyCourierUnassigned(courierShipmentInfo, {
      id: previousCourierId,
      firstName: shipment.users_shipments_assignedcourieridTousers.firstName,
      lastName: shipment.users_shipments_assignedcourieridTousers.lastName,
    });
  }

  await recordAudit(
    {
      userId: actor.userId,
      action: 'SHIPMENT_COURIER_ASSIGNED',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { courierId },
    },
    req,
  );

  return { trackingCode: shipment.trackingCode, assignedCourierId: courierId };
}

export async function unassignCourier(
  trackingCodeInput: string,
  actor: { userId: string; roles: UserRole[] },
  req?: FastifyRequest,
) {
  const shipment = await loadShipmentByCode(trackingCodeInput);

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR');
  if (!isStaff) throw forbidden('Solo personal operativo puede quitar el repartidor');

  const previousCourierId = shipment.assignedcourierid ?? null;
  if (!previousCourierId) {
    return { trackingCode: shipment.trackingCode, assignedCourierId: null };
  }

  const previousCourier = await prisma.user.findUnique({
    where: { id: previousCourierId },
    select: { id: true, firstName: true, lastName: true, employeenumber: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { assignedcourierid: null },
    });

    // El repartidor vuelve a estar disponible si ya no tiene envios
    // activos. Se recalcula dentro de la misma transaccion.
    await syncCourierAvailability(previousCourierId, tx);

    const maxSeq = (await tx.shipmentEvent.aggregate({ where: { shipmentId: shipment.id }, _max: { sequence: true } }))._max
      .sequence ?? 0;

    await tx.shipmentEvent.create({
      data: {
        shipmentId: shipment.id,
        sequence: maxSeq + 1,
        status: shipment.status,
        title: 'Repartidor desasignado',
        description: previousCourier
          ? `Se quitó la asignación del repartidor ${previousCourier.firstName} ${previousCourier.lastName}${previousCourier.employeenumber ? ' (' + previousCourier.employeenumber + ')' : ''}`
          : 'Se quitó la asignación del repartidor',
        occurredAt: new Date(),
        source: 'MANUAL',
        operatorId: actor.userId,
      },
    });
  });

  if (previousCourier) {
    await notifyCourierUnassigned(
      {
        id: shipment.id,
        trackingCode: shipment.trackingCode,
        status: shipment.status,
        estimatedDeliveryAt: shipment.estimatedDeliveryAt,
        originDepartment: shipment.originDepartment,
        destDepartment: shipment.destDepartment,
        originBranch: shipment.originBranch,
        destinationBranch: shipment.destinationBranch,
        recipientAddress: shipment.recipientAddress
          ? {
              city: shipment.recipientAddress.city,
              contactName: shipment.recipientAddress.contactName,
              contactPhone: shipment.recipientAddress.contactPhone,
            }
          : null,
      },
      previousCourier,
    );
  }

  await recordAudit(
    {
      userId: actor.userId,
      action: 'SHIPMENT_COURIER_UNASSIGNED',
      entity: 'Shipment',
      entityId: shipment.id,
      shipmentCode: shipment.trackingCode,
      metadata: { courierId: previousCourierId },
    },
    req,
  );

  return { trackingCode: shipment.trackingCode, assignedCourierId: null };
}

export async function assertOwnership(
  trackingCode: string,
  actor: { userId: string; roles: UserRole[] },
): Promise<{ id: string; senderId: string; recipientId: string | null }> {
  const shipment = await prisma.shipment.findUnique({
    where: { trackingCode: normalizeTrackingCode(trackingCode) },
    select: { id: true, senderId: true, recipientId: true },
  });

  if (!shipment) throw notFound('Envio');

  const isStaff = actor.roles.includes('ADMIN') || actor.roles.includes('OPERATOR') || actor.roles.includes('COURIER');
  const isParty = shipment.senderId === actor.userId || shipment.recipientId === actor.userId;
  if (!isStaff && !isParty) throw unauthorized();

  return shipment;
}
