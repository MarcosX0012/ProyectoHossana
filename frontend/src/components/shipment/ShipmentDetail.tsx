import { Download, MapPin, QrCode, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useTrackRealtime, type LiveTimelineItem } from '../../lib/realtime';
import type { CustodyRecord, ShipmentDetail as ShipmentDetailData, TimelineEntry } from '../../lib/types';
import { ROUTE_TYPE_LABELS } from '../../lib/types';
import { formatDateTime, formatMoney, formatWeight, fullName } from '../../lib/utils';
import { useApi } from '../../lib/useApi';
import { Alert, EmptyState, Loading } from '../feedback';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent } from '../ui/dialog';
import { ShipmentActions } from './actions';
import { SHIPMENT_STATUS_LABELS, ShipmentStatusBadge, statusMetaOf } from './status';
import { Timeline, type TimelineItemInput } from './Timeline';
import { CourierAssignment } from './CourierAssignment';
import { ShipmentPaymentCard } from './ShipmentPaymentCard';

/**
 * DETALLE DE ENVIO
 *
 * Pantalla compartida por todos los roles autenticados. Lo que cada
 * cuenta ve lo decide el backend (visibleidad PUBLIC/RESTRICTED/FULL);
 * aquí se pinta lo que llegó y se ofrecen las acciones que el rol
 * permite.
 */

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  ONLINE: 'En línea',
  ON_DELIVERY: 'Contra entrega',
  BANK_TRANSFER: 'Transferencia bancaria',
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-800">{value}</dd>
    </div>
  );
}

function mergeTimeline(apiItems: TimelineEntry[] | undefined, liveItems: LiveTimelineItem[]): TimelineItemInput[] {
  const map = new Map<string, TimelineItemInput>();
  (apiItems ?? []).forEach((item) => {
    map.set(item.id, {
      id: item.id,
      sequence: item.sequence,
      statusLabel: item.statusLabel,
      statusIcon: item.statusIcon,
      statusTone: item.statusTone,
      title: item.title,
      description: item.description,
      locationName: item.locationName,
      occurredAt: item.occurredAt,
      operatorName: item.operatorName,
      source: item.source,
    });
  });
  liveItems.forEach((item) => {
    if (map.has(item.id)) return;
    const meta = statusMetaOf(item.status);
    map.set(item.id, {
      id: item.id,
      sequence: item.sequence,
      statusLabel: SHIPMENT_STATUS_LABELS[item.status] ?? item.status,
      statusIcon: meta.icon,
      statusTone: meta.tone,
      title: item.title ?? '',
      occurredAt: item.occurredAt,
    });
  });
  return [...map.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
}

export function ShipmentDetail({ code }: { code: string }) {
  const { profile } = useAuth();
  const roles = profile?.roles ?? [];
  const isStaff = roles.some((role) => role === 'OPERATOR' || role === 'COURIER' || role === 'ADMIN');

  const [showQr, setShowQr] = useState(false);
  const [labelBusy, setLabelBusy] = useState(false);

  const detailApi = useApi<{ data: ShipmentDetailData }>(`/api/shipments/${code}`);
  const timelineApi = useApi<{ data: TimelineEntry[] }>(`/api/shipments/${code}/timeline`);
  const custodyApi = useApi<{ data: CustodyRecord[] }>(isStaff ? `/api/shipments/${code}/custody` : null);
  const qrApi = useApi<string>(`/api/shipments/${code}/qr?format=png`);

  const liveItems = useTrackRealtime(code, { authenticated: true });

  const detail = detailApi.data?.data;
  const timeline = timelineApi.data?.data;

  const timelineItems = useMemo(() => mergeTimeline(timeline, liveItems), [timeline, liveItems]);

  const reloadAll = () => {
    detailApi.reload();
    timelineApi.reload();
    custodyApi.reload();
    qrApi.reload();
  };

  const downloadLabel = async () => {
    if (!detail) return;
    setLabelBusy(true);
    try {
      const svg = await api<string>(`/api/shipments/${code}/label`);
      const blob = new Blob([svg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `etiqueta-${detail.trackingCode}.svg`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      // El aviso global de la página cubre el fallo.
    } finally {
      setLabelBusy(false);
    }
  };

  if (detailApi.error) {
    return (
      <div className="py-10">
        <EmptyState
          title="No se pudo cargar el envío"
          description={detailApi.error}
          action={
            <Button variant="outline" size="sm" onClick={reloadAll}>
              Reintentar
            </Button>
          }
        />
      </div>
    );
  }

  if (!detail) {
    return <Loading label="Cargando envío…" />;
  }

  return (
    <div className="space-y-5">
      {/* ── Cabecera ── */}
      <Card>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted">Envío</Badge>
                <code className="font-mono text-sm font-semibold text-slate-900">{detail.trackingCode}</code>
                <ShipmentStatusBadge label={detail.statusLabel} tone={detail.statusTone} />
                {detail.isActive ? null : <Badge variant="muted">Cerrado</Badge>}
              </div>
              <p className="mt-2 text-sm text-slate-600">
                {detail.statusDescription ?? 'Sin descripción de estado.'}
              </p>
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <DetailItem label="Creado" value={formatDateTime(detail.createdAt)} />
                <DetailItem label="Entrega estimada" value={formatDateTime(detail.estimatedDeliveryAt)} />
                <DetailItem label="Última actualización" value={formatDateTime(detail.statusChangedAt)} />
                <DetailItem
                  label="Ruta"
                  value={
                    detail.originDepartment && detail.destDepartment
                      ? `${detail.originDepartment.name} → ${detail.destDepartment.name}`
                      : '—'
                  }
                />
                <DetailItem
                  label="Peso facturable"
                  value={
                    detail.weightLbs !== null
                      ? `${detail.weightLbs} lb`
                      : formatWeight(detail.weightGrams)
                  }
                />
                {detail.routeType ? (
                  <DetailItem
                    label="Tipo de ruta"
                    value={ROUTE_TYPE_LABELS[detail.routeType] ?? detail.routeType}
                  />
                ) : null}
                <DetailItem
                  label="Importe"
                  value={`${formatMoney(detail.amountCents, detail.currency)} · ${formatMoney(detail.amountUsdCents, 'USD')}`}
                />
                <DetailItem
                  label="Pago"
                  value={`${PAYMENT_METHOD_LABELS[detail.paymentMethod] ?? detail.paymentMethod} · ${detail.paymentStatus === 'PAID' ? 'pagado' : detail.paymentStatus === 'PENDING_REVIEW' ? 'en revisión' : detail.paymentStatus === 'REJECTED' ? 'rechazado' : 'pendiente'}`}
                />
              </dl>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowQr(true)}>
                <QrCode className="h-4 w-4" />
                Ver QR
              </Button>
              <Button variant="outline" size="sm" onClick={downloadLabel} disabled={labelBusy}>
                <Download className="h-4 w-4" />
                {labelBusy ? 'Generando…' : 'Etiqueta'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Acciones según rol y estado ── */}
      <ShipmentActions code={code} detail={detail} onChanged={reloadAll} />

      {detail.paymentMethod === 'BANK_TRANSFER' ? (
        <ShipmentPaymentCard code={code} onChanged={reloadAll} />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_300px]">
        {/* Línea de tiempo */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Línea de tiempo</CardTitle>
          </CardHeader>
          <CardContent>
            {timelineItems.length === 0 ? (
              <p className="text-sm text-slate-500">Todavía no hay hitos registrados.</p>
            ) : (
              <Timeline items={timelineItems} />
            )}
          </CardContent>
        </Card>

        {/* Columna lateral */}
        <div className="space-y-5">
          {detail.assignedCourier ? (
            <Card>
              <CardHeader>
                <CardTitle>Repartidor asignado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-medium text-slate-900">{detail.assignedCourier.name}</p>
                {detail.assignedCourier.phone ? (
                  <p className="text-slate-600">
                    <a className="text-primary hover:underline" href={`tel:${detail.assignedCourier.phone}`}>{detail.assignedCourier.phone}</a>
                  </p>
                ) : null}
                {detail.assignedCourier.email ? <p className="text-slate-600">{detail.assignedCourier.email}</p> : null}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Productos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.items.map((item) => (
                <div key={item.id} className="rounded-md border border-slate-100 px-3 py-2 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium text-slate-800">
                      {item.quantity} × {item.name}
                    </p>
                    {item.isFragile ? <Badge variant="warning">frágil</Badge> : null}
                    {item.isHazmat ? <Badge variant="danger">peligroso</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {item.lineCode}
                    {item.sku ? ` · SKU ${item.sku}` : ''}
                    {item.unitValueCents ? ` · ${formatMoney(item.unitValueCents, detail.currency)}` : ''}
                  </p>
                </div>
              ))}
              {detail.items.length === 0 ? <p className="text-sm text-slate-500">Sin productos registrados.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recorrido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {detail.originBranch ? (
                <div>
                  <p className="text-xs text-slate-400">Origen (sede)</p>
                  <p className="font-medium text-slate-800">{detail.originBranch.name}</p>
                  <p className="text-slate-500">{detail.originBranch.city}</p>
                </div>
              ) : null}
              {detail.originAddressVisible && detail.senderAddress ? (
                <AddressBlock title="Dirección de origen" address={detail.senderAddress} />
              ) : detail.originBranch ? null : (
                <p className="text-xs text-slate-400">
                  La dirección del remitente no se muestra en esta vista.
                </p>
              )}
              <hr className="my-2 border-slate-100" />
              {detail.destinationBranch ? (
                <div>
                  <p className="text-xs text-slate-400">Destino (sede)</p>
                  <p className="font-medium text-slate-800">{detail.destinationBranch.name}</p>
                  <p className="text-slate-500">{detail.destinationBranch.city}</p>
                </div>
              ) : null}
              <AddressBlock title="Destino" address={detail.recipientAddress} />
            </CardContent>
          </Card>

          {(roles.includes('ADMIN') || roles.includes('OPERATOR')) && (
            <CourierAssignment shipment={detail as any} onAssigned={reloadAll} />
          )}

          {detail.courier.trackingNumber ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-slate-400" />
                  Transportista
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-slate-800">
                  <span className="text-slate-400">Código:</span> {detail.courier.code ?? '—'}
                </p>
                <p className="text-slate-800">
                  <span className="text-slate-400">Seguimiento:</span>{' '}
                  <code className="font-mono">{detail.courier.trackingNumber}</code>
                </p>
                {detail.courier.syncedAt ? (
                  <p className="text-xs text-slate-400">Sincronizado {formatDateTime(detail.courier.syncedAt)}</p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {isStaff ? (
            <Card>
              <CardHeader>
                <CardTitle>Cadena de custodia</CardTitle>
              </CardHeader>
              <CardContent>
                {custodyApi.loading ? <p className="text-sm text-slate-500">Cargando…</p> : null}
                {custodyApi.error ? (
                  <Alert notice={{ kind: 'error', message: custodyApi.error }} />
                ) : null}
                {!custodyApi.loading && !custodyApi.error && (custodyApi.data?.data ?? []).length === 0 ? (
                  <p className="text-sm text-slate-500">Sin movimientos de custodia registrados.</p>
                ) : null}
                {(custodyApi.data?.data ?? []).length > 0 ? (
                  <ol className="space-y-3">
                    {(custodyApi.data?.data ?? []).map((record) => (
                      <li key={record.id} className="border-l-2 border-slate-200 pl-3 text-sm">
                        <p className="font-medium text-slate-800">
                          <MapPin className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                          {record.action}
                        </p>
                        <p className="text-xs text-slate-500">
                          {record.branch ? `${record.branch.name} (${record.branch.city})` : formatDateTime(record.occurredAt)} ·{' '}
                          {fullName(record.handler)}
                        </p>
                        {record.note ? <p className="text-xs text-slate-400">{record.note}</p> : null}
                      </li>
                    ))}
                  </ol>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        <Link to="/envios" className="underline-offset-2 hover:underline">
          Volver a mis envíos
        </Link>
      </p>

      {/* QR modal */}
      <Dialog open={showQr} onOpenChange={setShowQr}>
        {showQr ? (
          <DialogContent title="Código QR del envío" description="Los clientes escanean el QR para rastrear el paquete.">
            <div className="flex flex-col items-center gap-3">
              {qrApi.loading ? <p className="text-sm text-slate-500">Generando…</p> : null}
              {qrApi.error ? <Alert notice={{ kind: 'error', message: qrApi.error }} /> : null}
              {qrApi.data ? (
                <>
                  <img
                    src={qrApi.data}
                    alt={`QR de ${detail.trackingCode}`}
                    className="h-52 w-52 rounded-md border border-slate-200"
                  />
                  <code className="font-mono text-sm text-slate-700">{detail.trackingCode}</code>
                  <p className="text-center text-xs text-slate-500">
                    {detail.originBranch ? `${detail.originBranch.city} → ` : ''}
                    {detail.recipientAddress.city}
                  </p>
                </>
              ) : null}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => window.open(`/rastreo/${code}`, '_blank')}>
                  <QrCode className="h-4 w-4" />
                  Abrir rastreo
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function AddressBlock({ title, address }: { title: string; address: { line1: string; line2?: string | null; contactName: string; contactPhone?: string | null; city: string; region?: string | null } }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{title}</p>
      <p className="font-medium text-slate-800">{address.contactName}</p>
      <p className="text-slate-600">
        {address.line1}
        {address.line2 ? `, ${address.line2}` : ''}
      </p>
      <p className="text-slate-500">
        {[address.city, address.region, address.contactPhone].filter(Boolean).join(' · ')}
      </p>
    </div>
  );
}