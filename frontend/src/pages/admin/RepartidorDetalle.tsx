import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPin,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CourierAvailabilityBadge, shipmentStatusLabel } from '../../components/badges';
import { Alert, EmptyState, Loading } from '../../components/feedback';
import { PageHeader } from '../../components/PageHeader';
import { ShipmentStatusBadge } from '../../components/shipment/status';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Input, Select } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import type {
  CourierDetail,
  ShipmentListResponse,
  ShipmentStatus,
} from '../../lib/types';
import { SHIPMENT_STATUSES } from '../../lib/types';
import { useApi } from '../../lib/useApi';
import { formatDate, formatMoney, fullName } from '../../lib/utils';

const PAGE_SIZE = 10;
const ALL = '';

/**
 * Detalle de un repartidor.
 *
 * Muestra su disponibilidad actual y el historial de todos los envios
 * que lo tienen como repartidor asignado, incluidos los ya entregados
 * o cerrados. El historial se apoya en el listado general de envios
 * con el filtro `assignedCourierId`.
 */
export function RepartidorDetalle() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [status, setStatus] = useState<ShipmentStatus | typeof ALL>(ALL);
  const [scope, setScope] = useState<'' | 'active' | 'closed'>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  // La búsqueda se calma para no pedir el historial en cada tecla.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, status, scope]);

  const detailPath = id ? `/api/couriers/${id}` : null;
  const {
    data: detailData,
    loading: detailLoading,
    error: detailError,
    reload: reloadDetail,
  } = useApi<{ data: CourierDetail }>(detailPath);
  const courier = detailData?.data;

  const historyPath = useMemo(() => {
    if (!id) return null;
    const params = new URLSearchParams();
    params.set('assignedCourierId', id);
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (status) params.set('status', status);
    if (scope) params.set('scope', scope);
    if (search) params.set('search', search);
    return `/api/shipments?${params.toString()}`;
  }, [id, page, status, scope, search]);

  const {
    data: historyData,
    loading: historyLoading,
    error: historyError,
    reload: reloadHistory,
  } = useApi<ShipmentListResponse>(historyPath);

  const rows = historyData?.data ?? [];
  const pagination = historyData?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  // La disponibilidad cambia al asignar o entregar envios en otra
  // pantalla; el historial se refresca con ella.
  useEffect(() => {
    const timer = setInterval(() => {
      reloadDetail();
      reloadHistory();
    }, 20000);
    return () => clearInterval(timer);
  }, [reloadDetail, reloadHistory]);

  const refreshAll = () => {
    reloadDetail();
    reloadHistory();
  };

  const hasFilters = Boolean(search || status || scope);
  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStatus(ALL);
    setScope('');
  };

  return (
    <div>
      <PageHeader
        title={courier ? fullName(courier) : 'Repartidor'}
        description={
          courier
            ? `Historial de envíos asignados · ${courier.employeeNumber || 'Sin número de empleado'}`
            : 'Historial de envíos asignados'
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate('/repartidores')}>
              <ArrowLeft className="h-4 w-4" />
              Volver
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/repartidores/${id}/ruta`)}
            >
              <MapPin className="h-4 w-4" />
              Ruta del día
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={refreshAll}
              disabled={detailLoading || historyLoading}
            >
              <RefreshCw className={`h-4 w-4 ${detailLoading || historyLoading ? 'animate-spin' : ''}`} />
              Recargar
            </Button>
          </div>
        }
      />

      {detailError ? (
        <Alert notice={{ kind: 'error', message: detailError }} className="mb-4" />
      ) : null}

      {detailLoading && !courier ? <Loading label="Cargando repartidor…" /> : null}

      {courier ? (
        <>
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-900">
                    {fullName(courier)}
                  </p>
                  <CourierAvailabilityBadge status={courier.courierAvailability} />
                </div>
                <p className="mt-1 truncate text-sm text-slate-500">
                  {courier.email} · {courier.phone || 'Sin teléfono'}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Avisos: {courier.notificationEmail || courier.email}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  N° empleado: {courier.employeeNumber || '—'}
                </p>
              </div>

              <div className="shrink-0 text-sm text-slate-600">
                {courier.currentShipment ? (
                  <button
                    type="button"
                    className="text-left text-indigo-600 hover:underline"
                    onClick={() =>
                      navigate(`/envios/${courier.currentShipment?.trackingCode}`)
                    }
                  >
                    Envío actual:{' '}
                    <code className="font-mono text-xs font-semibold">
                      {courier.currentShipment.trackingCode}
                    </code>
                  </button>
                ) : (
                  <span className="text-slate-400">Sin envío activo</span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Total asignados" value={courier.summary.totalShipments} />
            <SummaryCard label="Activos" value={courier.summary.activeShipments} />
            <SummaryCard label="Entregados" value={courier.summary.deliveredShipments} />
            <SummaryCard label="Cerrados" value={courier.summary.closedShipments} />
          </div>
        </>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por código, destinatario o producto…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Buscar en el historial"
          />
        </div>

        <Select
          className="sm:w-52"
          value={status}
          onChange={(event) => setStatus(event.target.value as ShipmentStatus | typeof ALL)}
          aria-label="Filtrar por estado"
        >
          <option value={ALL}>Todos los estados</option>
          {SHIPMENT_STATUSES.map((item) => (
            <option key={item} value={item}>
              {shipmentStatusLabel(item)}
            </option>
          ))}
        </Select>

        <Select
          className="sm:w-44"
          value={scope}
          onChange={(event) => setScope(event.target.value as '' | 'active' | 'closed')}
          aria-label="Filtrar por alcance"
        >
          <option value="">Todos</option>
          <option value="active">Solo activos</option>
          <option value="closed">Solo cerrados</option>
        </Select>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar
          </Button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {historyLoading && rows.length === 0 ? (
          <Loading label="Cargando historial…" />
        ) : null}

        {historyError ? (
          <div className="p-3">
            <Alert notice={{ kind: 'error', message: historyError }} />
          </div>
        ) : null}

        {!historyLoading && !historyError && rows.length === 0 ? (
          <EmptyState
            title="Sin envíos asignados"
            description={
              hasFilters
                ? 'No hay envíos que coincidan con los filtros.'
                : 'Este repartidor todavía no tiene envíos en su historial.'
            }
            action={
              hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="hidden md:table-cell">Destinatario</TableHead>
                  <TableHead className="hidden sm:table-cell">Creado</TableHead>
                  <TableHead className="hidden lg:table-cell">Entregado</TableHead>
                  <TableHead className="hidden lg:table-cell">Importe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((shipment) => (
                  <TableRow
                    key={shipment.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/envios/${shipment.trackingCode}`)}
                  >
                    <TableCell>
                      <code className="font-mono text-xs font-semibold text-indigo-700">
                        {shipment.trackingCode}
                      </code>
                    </TableCell>
                    <TableCell>
                      <ShipmentStatusBadge
                        label={shipment.statusLabel}
                        tone={shipment.statusTone}
                      />
                    </TableCell>
                    <TableCell className="hidden text-slate-600 md:table-cell">
                      {[shipment.recipientAddress.contactName, shipment.recipientAddress.city]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    <TableCell className="hidden text-slate-500 sm:table-cell">
                      {formatDate(shipment.createdAt)}
                    </TableCell>
                    <TableCell className="hidden text-slate-500 lg:table-cell">
                      {formatDate(shipment.deliveredAt)}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 lg:table-cell">
                      {formatMoney(shipment.amountCents, shipment.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5">
              <p className="text-xs text-slate-500">
                Página {pagination?.page ?? page} de {totalPages} ·{' '}
                {pagination?.total ?? 0} envíos
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || historyLoading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || historyLoading}
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
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      </CardContent>
    </Card>
  );
}
