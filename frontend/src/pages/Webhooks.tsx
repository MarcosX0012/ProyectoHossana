import { ChevronLeft, ChevronRight, Eye, Mailbox, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { WebhookStatusBadge } from '../components/badges';
import { Alert, EmptyState, Loading, type Notice } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Select } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { CourierProviders, Pagination, WebhookInboxItem, WebhookStatus } from '../lib/types';
import { WEBHOOK_STATUSES } from '../lib/types';
import { formatDateTime } from '../lib/utils';
import { useApi } from '../lib/useApi';

const PAGE_SIZE = 10;
const ALL = '';

/**
 * Estados que tiene sentido reprocesar: si ya fue procesado o aún
 * está en cola, reintentar solo añade ruido.
 */
const REPROCESSABLE: WebhookStatus[] = ['FAILED', 'REJECTED', 'IGNORED', 'DUPLICATE'];

const STATUS_LABELS: Record<WebhookStatus, string> = {
  RECEIVED: 'Recibido',
  PROCESSED: 'Procesado',
  REJECTED: 'Rechazado',
  DUPLICATE: 'Duplicado',
  FAILED: 'Fallido',
  IGNORED: 'Ignorado',
};

interface InboxResponse {
  data: WebhookInboxItem[];
  pagination: Pagination;
}

function ProvidersCard() {
  const { data, loading, error } = useApi<{ data: CourierProviders }>(
    '/api/webhooks/courier/providers',
  );
  const info = data?.data;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mailbox className="h-4 w-4 text-slate-400" />
          Transportistas
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-sm text-slate-500">Consultando…</p> : null}
        {error ? <Alert notice={{ kind: 'error', message: error }} /> : null}
        {info ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Activo:</span>
            <Badge variant="success">{info.active.displayName}</Badge>
            <span className="mx-2 text-slate-300">|</span>
            <span className="text-slate-500">Disponibles:</span>
            {info.providers.map((provider) => (
              <Badge key={provider.code} variant={provider.active ? 'default' : 'muted'}>
                {provider.code}
                {provider.active ? ' · activo' : ''}
              </Badge>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function Webhooks() {
  const { profile } = useAuth();
  const isAdmin = profile?.roles.includes('ADMIN') ?? false;
  const [providerFilter, setProviderFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<WebhookStatus | typeof ALL>(ALL);
  const [page, setPage] = useState(1);

  // Al cambiar un filtro, volver a la primera página.
  useEffect(() => {
    setPage(1);
  }, [providerFilter, statusFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (providerFilter) params.set('provider', providerFilter);
    if (statusFilter) params.set('status', statusFilter);
    return `/api/webhooks/courier/inbox?${params.toString()}`;
  }, [page, providerFilter, statusFilter]);

  const { data, loading, error, reload } = useApi<InboxResponse>(path);
  const items = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WebhookInboxItem | null>(null);

  const reprocess = async (item: WebhookInboxItem) => {
    setBusyId(item.id);
    try {
      await api(`/api/webhooks/courier/inbox/${item.id}/reprocess`, { method: 'POST' });
      setNotice({
        kind: 'success',
        message: `Webhook ${item.externalId ?? item.id} reenviado a reproceso.`,
      });
      setDetail(null);
      reload();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo reprocesar el webhook.',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Webhooks"
        description="Bandeja de eventos entrantes de los transportistas. Permite inspeccionar cada entrega y reprocesar las que fallaron."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Recargar
          </Button>
        }
      />

      {notice ? <Alert notice={notice} className="mb-4" /> : null}
      {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

      <ProvidersCard />

      {/* Filtros */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <Select
          className="sm:w-56"
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
          aria-label="Filtrar por transportista"
        >
          <option value={ALL}>Todos los transportistas</option>
          <option value="mock">mock</option>
          <option value="shippingdo">shippingdo</option>
          <option value="guia">guia</option>
          <option value="starken">starken</option>
        </Select>

        <Select
          className="sm:w-56"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as WebhookStatus | typeof ALL)}
          aria-label="Filtrar por estado"
        >
          <option value={ALL}>Todos los estados</option>
          {WEBHOOK_STATUSES.map((item) => (
            <option key={item} value={item}>
              {STATUS_LABELS[item]}
            </option>
          ))}
        </Select>

        {pagination ? (
          <p className="text-sm text-slate-500 sm:ml-auto">
            {pagination.total} evento{pagination.total === 1 ? '' : 's'}
          </p>
        ) : null}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading ? <Loading label="Cargando webhooks…" /> : null}

        {!loading && !error && items.length === 0 ? (
          <EmptyState
            title="No hay webhooks con esos filtros"
            description="Los eventos aparecen aquí cuando los transportistas envían notificaciones al backend."
          />
        ) : null}

        {!loading && items.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Recibido</TableHead>
                  <TableHead>Transportista</TableHead>
                  <TableHead className="hidden md:table-cell">Evento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden sm:table-cell">Intentos</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      {formatDateTime(item.receivedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{item.provider}</span>
                        {item.signatureValid ? (
                          <Badge variant="success">firma ok</Badge>
                        ) : (
                          <Badge variant="danger">firma inválida</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden max-w-56 truncate font-mono text-xs text-slate-500 md:table-cell">
                      {item.eventType ?? '—'}
                    </TableCell>
                    <TableCell>
                      <WebhookStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">
                      {item.attempts}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="inline-flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(item)}>
                          <Eye className="h-3.5 w-3.5" />
                          Ver
                        </Button>
                        {REPROCESSABLE.includes(item.status) && isAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === item.id}
                            onClick={() => reprocess(item)}
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${busyId === item.id ? 'animate-spin' : ''}`}
                            />
                            Reprocesar
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Paginación */}
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5">
              <p className="text-xs text-slate-500">
                Página {pagination?.page ?? page} de {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Diálogo de detalle */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        {detail ? (
          <DialogContent
            title="Detalle del webhook"
            description={`${detail.provider} · ${detail.eventType ?? 'evento sin tipo'}`}
            className="max-w-xl"
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">ID interno</dt>
                <dd className="break-all font-mono text-xs text-slate-800">{detail.id}</dd>
              </div>
              <div>
                <dt className="text-slate-500">ID externo</dt>
                <dd className="break-all font-mono text-xs text-slate-800">
                  {detail.externalId ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Estado</dt>
                <dd>
                  <WebhookStatusBadge status={detail.status} />
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Firma</dt>
                <dd>{detail.signatureValid ? 'Válida' : 'Inválida'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Intentos</dt>
                <dd>{detail.attempts}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Recibido</dt>
                <dd>{formatDateTime(detail.receivedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Procesado</dt>
                <dd>{formatDateTime(detail.processedAt)}</dd>
              </div>
            </dl>

            {detail.error ? (
              <div className="mt-4">
                <p className="mb-1 text-sm font-medium text-slate-700">Error registrado</p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-rose-50 p-3 text-xs text-rose-800">
                  {detail.error}
                </pre>
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDetail(null)}>
                Cerrar
              </Button>
              {REPROCESSABLE.includes(detail.status) && isAdmin ? (
                <Button
                  disabled={busyId === detail.id}
                  onClick={() => reprocess(detail)}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${busyId === detail.id ? 'animate-spin' : ''}`}
                  />
                  {busyId === detail.id ? 'Reprocesando…' : 'Reprocesar'}
                </Button>
              ) : null}
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
