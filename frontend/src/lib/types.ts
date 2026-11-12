/**
 * Tipos compartidos de la interfaz.
 *
 * Reproducen (en TypeScript) los contratos que devuelve la API del
 * backend: `src/modules/auth/service.ts`, `src/routes/webhook.routes.ts`
 * y `src/modules/shipments/service.ts`. Si el backend cambia, este es
 * el unico archivo que hay que ajustar.
 */

export type UserRole = 'SENDER' | 'RECIPIENT' | 'OPERATOR' | 'COURIER' | 'ADMIN';

export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED';

export const USER_ROLES: UserRole[] = ['SENDER', 'RECIPIENT', 'OPERATOR', 'COURIER', 'ADMIN'];

export const USER_STATUSES: UserStatus[] = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED'];

/** Usuario tal y como lo devuelve `PUBLIC_USER_SELECT` (sin datos sensibles). */
export interface PublicUser {
  id: string;
  email: string;
  notificationEmail: string | null;
  firstName: string;
  lastName: string;
  roles: UserRole[];
  status: UserStatus;
  locale: string;
  emailVerifiedAt: string | null;
  phoneVerifiedAt: string | null;
  createdAt: string;
  /** Solo presente en el listado de usuarios; nulo si no es repartidor. */
  employeeNumber?: string | null;
  courierAvailability?: CourierAvailability | null;
  activeShipments?: number | null;
  isActive?: boolean;
}

/** Disponibilidad operativa de un repartidor (no su estado de cuenta). */
export type CourierAvailability = 'AVAILABLE' | 'ON_ROUTE' | 'INACTIVE';

export interface CourierCurrentShipment {
  id: string;
  trackingCode: string;
  status: string;
  updatedAt: string;
}

/** Fila de `GET /api/couriers` (paneles de administrador y operador). */
export interface CourierListItem {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  notificationEmail: string | null;
  phone: string | null;
  employeeNumber: string | null;
  isActive: boolean;
  courierAvailability: CourierAvailability;
  activeShipments: number;
  currentShipment: CourierCurrentShipment | null;
}

/** Contadores de `GET /api/couriers/:id`. */
export interface CourierShipmentSummary {
  totalShipments: number;
  activeShipments: number;
  deliveredShipments: number;
  closedShipments: number;
}

export interface CourierDetail extends CourierListItem {
  summary: CourierShipmentSummary;
}

/** Permisos derivados que calcula el backend en `GET /api/users/me`. */
export interface UserPermissions {
  canCreateShipments: boolean;
  canOperate: boolean;
  canAdminister: boolean;
  emailVerified: boolean;
}

export interface Profile extends PublicUser {
  permissions: UserPermissions;
}

// ── Catálogo de tarifas ────────────────────────────────────────
//
// El costo de un envío se calcula con: departamento de origen,
// departamento de destino y peso en libras. `RateBreakdown` es la
// respuesta de `POST /api/shipping-rates/calculate`.

export type RouteType = 'LOCAL' | 'SHORT' | 'MEDIUM' | 'LONG';

export interface DepartmentRef {
  id: string;
  code: string;
  name: string;
}

export interface Department extends DepartmentRef {
  countryCode: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ShippingRateCatalogItem {
  id: string;
  routeType: RouteType;
  routeTypeLabel: string;
  originDepartment: DepartmentRef;
  destDepartment: DepartmentRef;
  baseAmountCents: number;
  baseAmountUsdCents: number;
  includedLbs: number;
  extraPerLbCents: number;
  extraPerLbUsdCents: number;
  deliveryCents: number;
  deliveryUsdCents: number;
  currency: string;
  exchangeRateNioPerUsd: number;
}

export interface RateBreakdown {
  shippingRateId: string;
  originDepartmentId: string;
  destDepartmentId: string;
  routeType: RouteType;
  routeTypeLabel: string;
  /** Peso que ingresó el cliente. */
  weightLbs: number;
  /** Peso usado para cobrar (mínimo 2 lb). */
  weightUsedForCalc: number;
  includedLbs: number;
  /** Libras adicionales ya redondeadas hacia arriba. */
  extraLbsCharged: number;
  extraPerLbCents: number;
  extraPerLbUsdCents: number;
  baseAmountCents: number;
  baseAmountUsdCents: number;
  deliveryCents: number;
  deliveryUsdCents: number;
  totalCents: number;
  totalUsdCents: number;
  exchangeRateNioPerUsd: number;
  currency: string;
  minWeightNote: string;
}

export const ROUTE_TYPES: RouteType[] = ['LOCAL', 'SHORT', 'MEDIUM', 'LONG'];

export const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  LOCAL: 'Local',
  SHORT: 'Corta',
  MEDIUM: 'Media',
  LONG: 'Larga',
};

export type WebhookStatus =
  | 'RECEIVED'
  | 'PROCESSED'
  | 'REJECTED'
  | 'DUPLICATE'
  | 'FAILED'
  | 'IGNORED';

export const WEBHOOK_STATUSES: WebhookStatus[] = [
  'RECEIVED',
  'PROCESSED',
  'REJECTED',
  'DUPLICATE',
  'FAILED',
  'IGNORED',
];

/** Fila de `GET /api/webhooks/courier/inbox`. */
export interface WebhookInboxItem {
  id: string;
  provider: string;
  externalId: string | null;
  eventType: string | null;
  status: WebhookStatus;
  signatureValid: boolean;
  error: string | null;
  attempts: number;
  receivedAt: string;
  processedAt: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
}

/** `GET /api/shipments/metrics` con rol ADMIN -> scope "global". */
export interface DashboardMetrics {
  scope: 'personal' | 'global';
  total?: number;
  delivered?: number;
  deliveredOnTime?: number;
  exceptions?: number;
  late?: number;
  syncFailures?: number;
  created?: number;
  confirmed?: number;
  inTransit?: number;
  outForDelivery?: number;
  pending?: number;
  byStatus?: Record<string, number>;
  byOriginDepartment?: Array<{ departmentId: string; department?: any; count: number }>;
  byDestinationDepartment?: Array<{ departmentId: string; department?: any; count: number }>;
  sent?: number;
  received?: number;
  active?: number;
}

/** `GET /api/webhooks/courier/providers`. */
export interface CourierProviders {
  active: { code: string; displayName: string };
  providers: Array<{ code: string; active: boolean }>;
}

/** Forma estandar de error del backend: `{error:{code,message,details}}`. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

// ── Envios ──────────────────────────────────────────────────────

export type ShipmentStatus =
  | 'CREATED'
  | 'CONFIRMED'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_PICKUP'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'AT_DISTRIBUTION_CENTER'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_ATTEMPTED'
  | 'ON_HOLD'
  | 'EXCEPTION'
  | 'RETURNING'
  | 'RETURNED'
  | 'LOST'
  | 'CANCELLED';

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  'CREATED',
  'CONFIRMED',
  'AWAITING_PAYMENT',
  'AWAITING_PICKUP',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_DISTRIBUTION_CENTER',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERY_ATTEMPTED',
  'ON_HOLD',
  'EXCEPTION',
  'RETURNING',
  'RETURNED',
  'LOST',
  'CANCELLED',
];

/** Tonos de la máquina de estados tal y como los etiqueta el backend. */
export type StatusTone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export type Visibility = 'PUBLIC' | 'RESTRICTED' | 'FULL';

export type PaymentMethod = 'ON_DELIVERY' | 'BANK_TRANSFER';
export type PaymentStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'PENDING_REVIEW'
  | 'PAID'
  | 'REJECTED'
  | 'FAILED'
  | 'REFUNDED';
export type PaymentCurrency = 'NIO' | 'USD';
export type PaymentSubmissionStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface BankAccount {
  id: string;
  currency: PaymentCurrency;
  bankName: string;
  accountName: string;
  accountNumber: string;
  accountType: string;
  notes?: string | null;
}

export interface PaymentSubmission {
  id: string;
  shipmentId: string;
  status: PaymentSubmissionStatus;
  currency: PaymentCurrency;
  amountCents: number;
  amountNioCents: number;
  exchangeRateNioPerUsd: number | null;
  reference: string | null;
  senderName: string | null;
  note: string | null;
  proofMimeType: string;
  proofOriginalName: string | null;
  proofSizeBytes: number;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  bankAccount: BankAccount;
  submittedBy: { id: string; firstName: string; lastName: string; email: string };
  reviewedBy: { id: string; firstName: string; lastName: string; email: string } | null;
  shipment?: {
    id: string;
    trackingCode: string;
    status: ShipmentStatus;
    paymentStatus: PaymentStatus;
    paymentCurrency: PaymentCurrency;
    amountCents: number;
    amountUsdCents: number | null;
    senderId: string;
    recipientId: string | null;
  };
}

export interface ShipmentPaymentInfo {
  id: string;
  trackingCode: string;
  senderId: string;
  recipientId: string | null;
  status: ShipmentStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  amountCents: number;
  amountUsdCents: number;
  paymentCurrency: PaymentCurrency;
  exchangeRateNioPerUsd: number;
  currency: string;
  paidAt: string | null;
  amountUsdFormatted: string;
  amountFormatted: string;
  amountPaymentFormatted: string;
  expectedAmountCents: number;
  canManage: boolean;
  bankAccounts: BankAccount[];
  submissions: PaymentSubmission[];
}

export interface BranchRef {
  id: string;
  name: string;
  city: string;
}

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

/** Fila de `GET /api/shipments` (lista paginada, con campos decorados). */
export interface ShipmentListItem {
  id: string;
  trackingCode: string;
  status: ShipmentStatus;
  statusChangedAt: string;
  createdAt: string;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  itemCount: number;
  weightGrams: number | null;
  weightLbs: number | null;
  weightUnit: 'KG' | 'LB' | null;
  routeType: RouteType | null;
  originDepartment: DepartmentRef | null;
  destDepartment: DepartmentRef | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  amountCents: number;
  paymentCurrency: PaymentCurrency;
  amountUsdCents: number | null;
  exchangeRateNioPerUsd: number | null;
  currency: string;
  courierCode: string | null;
  courierTrackingNumber: string | null;
  senderId: string;
  recipientId: string | null;
  originBranch: BranchRef | null;
  destinationBranch: BranchRef | null;
  recipientAddress: {
    city: string;
    region: string | null;
    countryCode: string;
    contactName: string;
  };
  sender: PersonRef;
  recipient: PersonRef | null;
  // Campos decorados por el backend (STATUS_DEFINITIONS + visibility).
  statusLabel: string;
  statusDescription: string | null;
  statusIcon: string;
  statusTone: StatusTone;
  statusPhase: string;
  isActive: boolean;
  visibility: Visibility;
  assignedCourier?: { id: string; name: string; phone: string | null } | null;
}

export interface ShipmentListResponse {
  data: ShipmentListItem[];
  pagination: Pagination & { totalPages: number };
}

export interface AddressShape {
  id: string;
  contactName: string;
  contactPhone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  countryCode: string;
  instructions: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface ShipmentItemDetail {
  id: string;
  shipmentId: string;
  lineCode: string;
  sku: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unitValueCents: number;
  weightGrams: number | null;
  isFragile: boolean;
  isHazmat: boolean;
  createdAt: string;
}

export interface AssignedCourier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

/** `GET /api/shipments/:code` — detalle con campos decorados. */
export interface ShipmentDetail
  extends Omit<ShipmentListItem, 'recipientAddress' | 'sender' | 'recipient'> {
  updatedAt: string;
  declaredValueCents: number;
  notes: string | null;
  cancelReason: string | null;
  version: number;
  senderAddress: AddressShape | null;
  recipientAddress: AddressShape;
  originAddressVisible: boolean;
  amountFormatted: string;
  amountUsdFormatted: string;
  amountPaymentFormatted: string;
  exchangeRateNioPerUsd: number;
  // Snapshot de la tarifa aplicada al crear el envío: conserva lo que
  // realmente se cobró aunque el tarifario cambie después.
  baseAmountCents: number | null;
  extraPerLbCents: number | null;
  deliveryCents: number | null;
  extraLbsCharged: number | null;
  lbsChargedMin: number | null;
  weightUsedForCalc: number | null;
  items: ShipmentItemDetail[];
  courier: {
    code: string | null;
    shipmentId: string | null;
    trackingNumber: string | null;
    syncedAt: string | null;
  };
  assignedCourier?: AssignedCourier | null;
}

/** Elemento de `GET /api/shipments/:code/timeline`. */
export interface TimelineEntry {
  id: string;
  sequence: number;
  status: ShipmentStatus;
  statusLabel: string;
  statusIcon: string;
  statusTone: StatusTone;
  title: string;
  description: string | null;
  locationName: string | null;
  occurredAt: string;
  source: 'SYSTEM' | 'MANUAL' | 'SCAN' | 'COURIER_API' | 'WEBHOOK';
  operatorName: string | null;
  metadata: unknown;
}

export interface CustodyRecord {
  id: string;
  action: CustodyAction;
  branchId: string | null;
  scanCode: string | null;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  occurredAt: string;
  handler: { firstName: string; lastName: string; roles: UserRole[] };
  branch: { name: string; city: string } | null;
}

export type CustodyAction =
  | 'PICKUP'
  | 'SCAN_IN'
  | 'SCAN_OUT'
  | 'HANDOFF'
  | 'SORT'
  | 'LOAD_VEHICLE'
  | 'DELIVER'
  | 'ATTEMPT_DELIVERY'
  | 'RETURN';

export const CUSTODY_ACTIONS: CustodyAction[] = [
  'PICKUP',
  'SCAN_IN',
  'SCAN_OUT',
  'HANDOFF',
  'SORT',
  'LOAD_VEHICLE',
  'DELIVER',
  'ATTEMPT_DELIVERY',
  'RETURN',
];

/** Inputs de creación de envío (espejo de los schemas Zod del backend). */
export interface AddressInput {
  contactName: string;
  contactPhone: string;
  line1: string;
  line2?: string | null;
  city: string;
  region?: string | null;
  postalCode?: string | null;
  countryCode?: string;
  instructions?: string | null;
}

export interface ItemInput {
  sku?: string | null;
  name: string;
  description?: string | null;
  quantity: number;
  unitValueCents: number;
  weightGrams?: number | null;
  isFragile?: boolean;
  isHazmat?: boolean;
}

export interface CreateShipmentInput {
  recipientEmail?: string | null;
  senderAddress: AddressInput;
  recipientAddress: AddressInput;
  items: ItemInput[];
  /** Peso total en gramos (informativo para el detalle del paquete). */
  weightGrams?: number | null;
  /** Datos del cálculo automático de tarifa (obligatorios). */
  originDepartmentId: string;
  destDepartmentId: string;
  weightLbs: number;
  declaredValueCents?: number | null;
  paymentMethod: PaymentMethod;
  paymentCurrency?: PaymentCurrency;
  notes?: string | null;
}

export interface CreateShipmentResult {
  trackingCode: string;
  shipmentId: string;
  status: ShipmentStatus;
  statusLabel?: string;
  /** El QR se genera en el backend: PNG (dataUrl), SVG y URL pública. */
  qr: {
    dataUrl: string;
    svg: string;
    trackingUrl: string;
  };
  estimatedDeliveryAt: string;
}

export interface DispatchResult {
  trackingNumber: string;
  providerShipmentId: string;
  labelUrl: string | null;
  estimatedDays: number | null;
}

// ── Rastreo publico ────────────────────────────────────────────

export interface PublicTimelineEntry {
  sequence: number;
  status: string;
  statusLabel: string;
  statusIcon: string;
  statusTone: StatusTone;
  title: string;
  description: string | null;
  locationName: string | null;
  occurredAt: string;
  sourceLabel: string;
}

export interface PublicTrackingResult {
  trackingCode: string;
  status: string;
  statusLabel: string;
  statusDescription: string;
  statusIcon: string;
  statusTone: StatusTone;
  statusPhase: string;
  isActive: boolean;
  isDelivered: boolean;
  deliveryVerified: boolean;
  city: string;
  countryCode: string;
  itemCount: number;
  createdAt: string;
  estimatedDeliveryAt: string | null;
  deliveredAt: string | null;
  supportHint: string;
  timeline: PublicTimelineEntry[];
}

// ── Notificaciones ─────────────────────────────────────────────

export type NotificationChannel = 'WHATSAPP' | 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
export type NotificationStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'SKIPPED';

/** Fila de `GET /api/users/me/notifications`. */
export interface NotificationItem {
  id: string;
  channel: NotificationChannel;
  template: string;
  payload: unknown;
  status: NotificationStatus;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  shipmentId: string | null;
  error: string | null;
}

// ── Tiempo real (Socket.IO) ─────────────────────────────────────

export interface RealtimeShipmentEvent {
  type: 'shipment.event';
  trackingCode: string;
  event: {
    id: string;
    sequence: number;
    status: string;
    title: string | null;
    occurredAt: string;
  };
}

export interface RealtimeShipmentStatus {
  type: 'shipment.status';
  trackingCode: string;
  status: string;
  at: string;
}
