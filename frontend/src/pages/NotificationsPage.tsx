import {
  Bell,
  CheckCheck,
  Mail,
  MailX,
  MessageSquare,
  RefreshCw,
  Smartphone,
  Zap,
} from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { Link } from 'react-router-dom';
import { Alert, EmptyState, Loading, type Notice } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { Badge, type BadgeVariant } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import type { NotificationChannel, NotificationItem, NotificationStatus } from '../lib/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/utils';
import { useApi } from '../lib/useApi';

/** Traduce el nombre de la plantilla a algo que la gente lee. */
const TEMPLATE_LABELS: Record<string, string> = {
  shipment_status_update: 'Actualización del envío',
  shipment_out_for_delivery: 'Tu envío está en reparto',
  shipment_delivered: 'Envío entregado',
  shipment_exception: 'Incidencia con el envío',
  shipment_cancelled: 'Envío cancelado',
  courier_shipment_assigned: 'Nuevo envío asignado',
  courier_shipment_unassigned: 'Envío desasignado',
  courier_shipment_update: 'Actualización de un envío asignado',
  courier_shipment_cancelled: 'Envío asignado cancelado',
  delivery_otp: 'Código de verificación de entrega',
};

function templateLabel(template: string): string {
  return TEMPLATE_LABELS[template] ?? template;
}

const CHANNEL_META: Record<NotificationChannel, { label: string; Icon: ComponentType<{ className?: string }> }> = {
  WHATSAPP: { label: 'WhatsApp', Icon: MessageSquare },
  EMAIL: { label: 'Correo', Icon: Mail },
  SMS: { label: 'SMS', Icon: Smartphone },
  PUSH: { label: 'Push', Icon: Zap },
  IN_APP: { label: 'En la app', Icon: Bell },
};

const STATUS_META: Record<NotificationStatus, { label: string; variant: BadgeVariant }> = {
  QUEUED: { label: 'En cola', variant: 'muted' },
  SENDING: { label: 'Enviando', variant: 'default' },
  SENT: { label: 'Enviado', variant: 'default' },
  DELIVERED: { label: 'Entregado', variant: 'success' },
  FAILED: { label: 'Fallido', variant: 'danger' },
  SKIPPED: { label: 'Omitido', variant: 'muted' },
};

function payloadOf(item: NotificationItem): Record<string, unknown> {
  return item.payload && typeof item.payload === 'object'
    ? (item.payload as Record<string, unknown>)
    : {};
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export function NotificationsPage() {
  const [showAllChannels, setShowAllChannels] = useState(false);
  const path = `/api/users/me/notifications?limit=50${showAllChannels ? '' : '&channel=IN_APP'}`;
  const { data, loading, error, reload } = useApi<{ data: NotificationItem[] }>(path);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const items = data?.data ?? [];
  const unread = items.filter((item) => item.channel === 'IN_APP' && !item.readAt).length;

  const syncBadge = () => window.dispatchEvent(new Event('notifications:changed'));

  const markAllRead = async () => {
    setMarkingAll(true);
    setNotice(null);
    try {
      const response = await api<{ data: { updated: number } }>(
        '/api/users/me/notifications/read-all',
        { method: 'POST', json: {} },
      );
      setNotice({
        kind: 'success',
        message:
          response.data.updated > 0
            ? `Se marcaron ${response.data.updated} notificación(es) como leídas.`
            : 'No había notificaciones pendientes.',
      });
      await reload();
      syncBadge();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudieron marcar como leídas.',
      });
    } finally {
      setMarkingAll(false);
    }
  };

  const markRead = async (id: string) => {
    setMarkingId(id);
    setNotice(null);
    try {
      await api(`/api/users/me/notifications/${id}/read`, { method: 'PATCH' });
      await reload();
      syncBadge();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo marcar como leída.',
      });
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Notificaciones"
        description="Avisos dentro del sistema. Los mismos eventos también se envían por correo."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllChannels((value) => !value)}
            >
              {showAllChannels ? 'Ver solo en la app' : 'Ver correo y WhatsApp'}
            </Button>
            {unread > 0 ? (
              <Button variant="outline" size="sm" onClick={() => void markAllRead()} disabled={markingAll}>
                <CheckCheck className="h-4 w-4" />
                {markingAll ? 'Marcando…' : `Marcar leídas (${unread})`}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Recargar
            </Button>
          </div>
        }
      />

      {notice ? <Alert notice={notice} className="mb-4" /> : null}
      {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

      {loading && !items.length ? <Loading label="Cargando notificaciones…" /> : null}

      {!loading && !error && items.length === 0 ? (
        <EmptyState
          title="Sin notificaciones todavía"
          description="Los avisos aparecen aquí cuando el sistema te notifique (recolección, reparto, entrega…)."
          action={<Button variant="outline" size="sm" onClick={reload}>Reintentar</Button>}
        />
      ) : null}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => {
            const channel = CHANNEL_META[item.channel] ?? { label: item.channel, Icon: MailX };
            const { label: channelLabel, Icon: ChannelIcon } = channel;
            const status = STATUS_META[item.status] ?? { label: item.status, variant: 'muted' as BadgeVariant };
            const payload = payloadOf(item);
            const title = textOf(payload.title) ?? templateLabel(item.template);
            const message = textOf(payload.message) ?? textOf(payload.description);
            const trackingCode = textOf(payload.trackingCode);
            const actionUrl = textOf(payload.actionUrl);
            const isUnread = !item.readAt;

            return (
              <Card
                key={item.id}
                className={isUnread ? 'border-indigo-200 bg-indigo-50/30 p-4' : 'p-4'}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <ChannelIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {isUnread ? (
                        <span
                          className="h-2 w-2 rounded-full bg-indigo-600"
                          aria-label="Sin leer"
                        />
                      ) : null}
                      <p className="text-sm font-medium text-slate-900">{title}</p>
                      <Badge variant="muted">{channelLabel}</Badge>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>

                    {message ? <p className="mt-1 text-sm text-slate-600">{message}</p> : null}

                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(item.sentAt ?? item.queuedAt)}
                      {item.status === 'DELIVERED' && item.deliveredAt
                        ? ` · confirmado ${formatDateTime(item.deliveredAt)}`
                        : ''}
                      {trackingCode ? ` · envío ${trackingCode}` : ''}
                    </p>

                    {item.error ? (
                      <p className="mt-1 text-xs text-amber-600">{item.error}</p>
                    ) : null}

                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {trackingCode && actionUrl ? (
                        <Link
                          to={actionUrl}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Ver envío
                        </Link>
                      ) : null}
                      {isUnread ? (
                        <button
                          type="button"
                          className="text-xs font-medium text-slate-500 hover:text-slate-800"
                          onClick={() => void markRead(item.id)}
                          disabled={markingId === item.id}
                        >
                          {markingId === item.id ? 'Marcando…' : 'Marcar como leída'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
