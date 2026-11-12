import { Badge, type BadgeVariant } from './ui/badge';
import type {
  CourierAvailability,
  UserRole,
  UserStatus,
  WebhookStatus,
} from '../lib/types';

/**
 * Badges de dominio: traducen los enums del backend a texto en
 * español y a un color, para que una tabla se lea de un vistazo.
 */

const ROLE_LABELS: Record<UserRole, string> = {
  SENDER: 'Emisor',
  RECIPIENT: 'Receptor',
  OPERATOR: 'Operador',
  COURIER: 'Repartidor',
  ADMIN: 'Administrador',
};

const ROLE_VARIANTS: Record<UserRole, BadgeVariant> = {
  SENDER: 'default',
  RECIPIENT: 'muted',
  OPERATOR: 'warning',
  COURIER: 'success',
  ADMIN: 'danger',
};

export function roleLabel(role: UserRole): string {
  return ROLE_LABELS[role] ?? role;
}

export function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge variant={ROLE_VARIANTS[role] ?? 'muted'}>{roleLabel(role)}</Badge>
  );
}

const USER_STATUS_META: Record<UserStatus, { label: string; variant: BadgeVariant }> = {
  ACTIVE: { label: 'Activo', variant: 'success' },
  PENDING_VERIFICATION: { label: 'Sin verificar', variant: 'warning' },
  SUSPENDED: { label: 'Suspendido', variant: 'danger' },
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const meta = USER_STATUS_META[status] ?? { label: status, variant: 'muted' as BadgeVariant };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/**
 * Disponibilidad de un repartidor. Se muestra en lugar del estado de
 * la cuenta: "Ocupado" significa que tiene al menos un envio activo.
 */
const COURIER_AVAILABILITY_META: Record<
  CourierAvailability,
  { label: string; variant: BadgeVariant }
> = {
  AVAILABLE: { label: 'Disponible', variant: 'success' },
  ON_ROUTE: { label: 'Ocupado', variant: 'warning' },
  INACTIVE: { label: 'Inactivo', variant: 'muted' },
};

export function courierAvailabilityLabel(status: CourierAvailability): string {
  return COURIER_AVAILABILITY_META[status]?.label ?? status;
}

export function CourierAvailabilityBadge({ status }: { status: CourierAvailability }) {
  const meta = COURIER_AVAILABILITY_META[status] ?? {
    label: status,
    variant: 'muted' as BadgeVariant,
  };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

const WEBHOOK_STATUS_META: Record<WebhookStatus, { label: string; variant: BadgeVariant }> = {
  RECEIVED: { label: 'Recibido', variant: 'default' },
  PROCESSED: { label: 'Procesado', variant: 'success' },
  REJECTED: { label: 'Rechazado', variant: 'warning' },
  DUPLICATE: { label: 'Duplicado', variant: 'muted' },
  FAILED: { label: 'Fallido', variant: 'danger' },
  IGNORED: { label: 'Ignorado', variant: 'muted' },
};

export function WebhookStatusBadge({ status }: { status: WebhookStatus }) {
  const meta = WEBHOOK_STATUS_META[status] ?? { label: status, variant: 'muted' as BadgeVariant };
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

/**
 * Estados de `ShipmentStatus` (enum de Prisma) traducidos al español.
 * Se usa en el dashboard para leer el desglose `byStatus`.
 */
const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Creado',
  CONFIRMED: 'Confirmado',
  AWAITING_PAYMENT: 'Esperando pago',
  AWAITING_PICKUP: 'Esperando recolección',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En tránsito',
  AT_DISTRIBUTION_CENTER: 'En centro de distribución',
  OUT_FOR_DELIVERY: 'En reparto',
  DELIVERED: 'Entregado',
  DELIVERY_ATTEMPTED: 'Entrega fallida',
  ON_HOLD: 'En espera',
  EXCEPTION: 'Incidencia',
  RETURNING: 'En devolución',
  RETURNED: 'Devuelto',
  LOST: 'Perdido',
  CANCELLED: 'Cancelado',
};

export function shipmentStatusLabel(status: string): string {
  return SHIPMENT_STATUS_LABELS[status] ?? status;
}
