import {
  Bike,
  CheckCheck,
  CheckCircle2,
  CircleHelp,
  CirclePause,
  CornerUpLeft,
  CreditCard,
  FilePlus2,
  OctagonAlert,
  Package,
  Route,
  TriangleAlert,
  Truck,
  Undo2,
  Warehouse,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { Badge, type BadgeVariant } from '../ui/badge';
import type { StatusTone } from '../../lib/types';

/**
 * MAPA DE ESTADOS DE ENVIO
 *
 * El backend envía en cada fila/hito `statusIcon` + `statusTone`
 * derivados de la máquina de estados. Aquí solo se traducen a
 * componentes e iconos: el frontend NO conoce la máquina.
 */

const ICON_OF: Record<string, LucideIcon> = {
  'file-plus': FilePlus2,
  'check-circle': CheckCircle2,
  'credit-card': CreditCard,
  package: Package,
  truck: Truck,
  route: Route,
  warehouse: Warehouse,
  bike: Bike,
  'alert-triangle': TriangleAlert,
  'check-check': CheckCheck,
  'pause-circle': CirclePause,
  'alert-octagon': OctagonAlert,
  undo: Undo2,
  'corner-up-left': CornerUpLeft,
  'help-circle': CircleHelp,
  'x-circle': XCircle,
};

/** Devuelve el ícono de lucide para un `statusIcon` del backend. */
export function statusIconOf(name: string | undefined | null): LucideIcon {
  return ICON_OF[name ?? ''] ?? Package;
}

/** Mapa de estados espejo del backend (para pintar hitos en vivo). */
const STATUS_META: Record<string, { icon: string; tone: StatusTone }> = {
  CREATED: { icon: 'file-plus', tone: 'neutral' },
  CONFIRMED: { icon: 'check-circle', tone: 'info' },
  AWAITING_PAYMENT: { icon: 'credit-card', tone: 'warn' },
  AWAITING_PICKUP: { icon: 'package', tone: 'info' },
  PICKED_UP: { icon: 'truck', tone: 'info' },
  IN_TRANSIT: { icon: 'route', tone: 'info' },
  AT_DISTRIBUTION_CENTER: { icon: 'warehouse', tone: 'info' },
  OUT_FOR_DELIVERY: { icon: 'bike', tone: 'info' },
  DELIVERY_ATTEMPTED: { icon: 'alert-triangle', tone: 'warn' },
  DELIVERED: { icon: 'check-check', tone: 'ok' },
  ON_HOLD: { icon: 'pause-circle', tone: 'warn' },
  EXCEPTION: { icon: 'alert-octagon', tone: 'danger' },
  RETURNING: { icon: 'undo', tone: 'warn' },
  RETURNED: { icon: 'corner-up-left', tone: 'neutral' },
  LOST: { icon: 'help-circle', tone: 'danger' },
  CANCELLED: { icon: 'x-circle', tone: 'neutral' },
};

/** Metadatos (icono/tono) para un estado del backend, con respaldo. */
export function statusMetaOf(status: string | undefined): { icon: string; tone: StatusTone } {
  return STATUS_META[status ?? ''] ?? { icon: 'package', tone: 'neutral' };
}

// Re-uso por Timeline y por los diálogos.
export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  CREATED: 'Envío creado',
  CONFIRMED: 'Envío confirmado',
  AWAITING_PAYMENT: 'Esperando pago',
  AWAITING_PICKUP: 'En espera de recolección',
  PICKED_UP: 'Recolectado',
  IN_TRANSIT: 'En tránsito',
  AT_DISTRIBUTION_CENTER: 'En centro de distribución',
  OUT_FOR_DELIVERY: 'En reparto',
  DELIVERED: 'Entregado',
  DELIVERY_ATTEMPTED: 'Intento de entrega sin éxito',
  ON_HOLD: 'En espera',
  EXCEPTION: 'Incidencia',
  RETURNING: 'En devolución',
  RETURNED: 'Devuelto',
  LOST: 'Extraviado',
  CANCELLED: 'Cancelado',
};

/** Convierte el tono de la máquina de estados a variante de Badge. */
export function toneToBadge(tone: StatusTone | string | undefined | null): BadgeVariant {
  switch (tone) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'danger':
      return 'danger';
    case 'info':
      return 'default';
    default:
      return 'muted';
  }
}

/** Clases Tailwind de relleno para círculos/avatares según el tono. */
export function toneFill(tone: StatusTone | string | undefined | null): string {
  switch (tone) {
    case 'ok':
      return 'bg-emerald-50 text-emerald-600';
    case 'warn':
      return 'bg-amber-50 text-amber-600';
    case 'danger':
      return 'bg-rose-50 text-rose-600';
    case 'info':
      return 'bg-indigo-50 text-indigo-600';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

/** Badge de estado de un envío: color + etiqueta. */
export function ShipmentStatusBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone?: StatusTone | string | null;
  className?: string;
}) {
  return (
    <Badge variant={toneToBadge(tone)} className={className}>
      {label}
    </Badge>
  );
}