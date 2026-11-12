import { ArrowRight, Clock, MapPin, PackageCheck, QrCode, Search } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, Loading } from '../components/feedback';
import { ShipmentStatusBadge } from '../components/shipment/status';
import { Timeline, type TimelineItemInput } from '../components/shipment/Timeline';
import { SHIPMENT_STATUS_LABELS } from '../components/shipment/status';
import { useTrackRealtime } from '../lib/realtime';
import type { PublicTimelineEntry, PublicTrackingResult } from '../lib/types';
import { formatDateTime, resolveTrackingParam } from '../lib/utils';
import { useApi } from '../lib/useApi';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

/**
 * RASTREO PUBLICO
 *
 * Sin login. El QR del paquete apunta aquí con la forma
 * `/track/<token>` o `/rastreo/<codigo>`. El backend que está
 * desplegado solo resuelve códigos planos en `/api/public/track/:code`
 * (su rama de tokens exige puntos literales que el formato base64url
 * nunca produce), así que el token del QR se decodifica en el cliente
 * con `resolveTrackingParam` para extraer el código. La línea de tiempo
 * se actualiza en tiempo real vía Socket.IO.
 */
export function PublicTrack() {
  const { code: rawParam } = useParams();
  const navigate = useNavigate();

  const code = rawParam ? resolveTrackingParam(rawParam) : '';

  const [manual, setManual] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const trackApi = useApi<{ data: PublicTrackingResult }>(
    code ? `/api/public/track/${encodeURIComponent(code)}` : null,
  );
  const liveItems = useTrackRealtime(code, { authenticated: false });

  const info = trackApi.data?.data;

  const timelineItems = useMemo(() => {
    const map = new Map<number, TimelineItemInput>();
    (info?.timeline ?? []).forEach((entry: PublicTimelineEntry) => {
      map.set(entry.sequence, {
        id: `t${entry.sequence}`,
        sequence: entry.sequence,
        statusLabel: entry.statusLabel,
        statusIcon: entry.statusIcon,
        statusTone: entry.statusTone,
        title: entry.title,
        description: entry.description,
        locationName: entry.locationName,
        occurredAt: entry.occurredAt,
        sourceLabel: entry.sourceLabel,
      });
    });
    liveItems.forEach((item) => {
      if (map.has(item.sequence)) return;
      map.set(item.sequence, {
        id: item.id,
        sequence: item.sequence,
        statusLabel: SHIPMENT_STATUS_LABELS[item.status] ?? item.status,
        title: item.title ?? '',
        occurredAt: item.occurredAt,
      });
    });
    return [...map.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }, [info, liveItems]);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const next = manual.trim().toUpperCase();
    if (!next) return;
    setNotice(null);
    navigate(`/rastreo/${encodeURIComponent(next)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Barra de marca */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
              H
            </div>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-slate-900">Hossana</p>
              <p className="text-xs text-slate-500">Rastreo de envíos</p>
            </div>
          </div>
          <form onSubmit={submitManual} className="flex gap-2">
            <Input
              className="h-9 w-48 sm:w-64"
              placeholder="Otro código…"
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              aria-label="Código de rastreo"
            />
            <Button type="submit" size="sm" disabled={!manual.trim()}>
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Rastrear</span>
            </Button>
          </form>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {/* Campo de búsqueda cuando no hay código */}
        {!code ? (
          <Card className="py-10">
            <CardContent className="flex flex-col items-center gap-3 text-center">
              <QrCode className="h-8 w-8 text-indigo-500" />
              <h1 className="text-lg font-semibold text-slate-900">¿Dónde está mi paquete?</h1>
              <p className="max-w-sm text-sm text-slate-500">
                Ingresa el código que aparece en tu QR o en el correo de confirmación.
              </p>
              <form onSubmit={submitManual} className="flex w-full max-w-sm gap-2">
                <Input
                  placeholder="HOS-2026-000123"
                  value={manual}
                  onChange={(event) => setManual(event.target.value)}
                  autoFocus
                />
                <Button type="submit" disabled={!manual.trim()}>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {/* Errores */}
        {trackApi.error ? (
          <Alert notice={{ kind: 'error', message: trackApi.error }} className="mb-4" />
        ) : null}
        {notice ? <Alert notice={{ kind: 'info', message: notice }} className="mb-4" /> : null}

        {code && trackApi.loading && !info ? <Loading label="Consultando el envío…" /> : null}

        {info ? (
          <div className="space-y-5">
            {/* Tarjeta de estado */}
            <Card>
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">Estado del paquete</p>
                    <div className="mt-1 flex items-center gap-2">
                      <ShipmentStatusBadge label={info.statusLabel} tone={info.statusTone} />
                      <code className="font-mono text-xs text-slate-500">{info.trackingCode}</code>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {info.statusDescription || 'Sin descripción.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {info.deliveryVerified ? <Badge variant="success">Entrega verificada</Badge> : null}
                    {info.isDelivered ? <Badge variant="success">Entregado</Badge> : null}
                    {!info.isActive && !info.isDelivered ? <Badge variant="muted">Proceso cerrado</Badge> : null}
                  </div>
                </div>

                <dl className="mt-5 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-slate-400">
                      <MapPin className="h-3.5 w-3.5" /> Destino
                    </dt>
                    <dd className="mt-0.5 text-slate-800">{info.city}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-slate-400">
                      <PackageCheck className="h-3.5 w-3.5" /> Artículos
                    </dt>
                    <dd className="mt-0.5 text-slate-800">
                      {info.itemCount} {info.itemCount === 1 ? 'producto' : 'productos'}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="h-3.5 w-3.5" /> Entrega estimada
                    </dt>
                    <dd className="mt-0.5 text-slate-800">{formatDateTime(info.estimatedDeliveryAt)}</dd>
                  </div>
                </dl>

                {(info.estimatedDeliveryAt || info.deliveredAt) && !info.isDelivered ? (
                  <p className="mt-4 text-center text-xs text-slate-400">
                    Este rastreo se actualiza en tiempo real.
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {/* Línea de tiempo */}
            <Card>
              <CardHeader>
                <CardTitle>Línea de tiempo</CardTitle>
              </CardHeader>
              <CardContent>
                {timelineItems.length === 0 ? (
                  <p className="text-sm text-slate-500">Aún no hay movimientos registrados.</p>
                ) : (
                  <Timeline items={timelineItems} />
                )}
              </CardContent>
            </Card>

            <p className="text-center text-xs text-slate-400">
              {info.supportHint ? `Ayuda: ${info.supportHint}` : '¿Dudas? Contacta al remitente.'}
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}