import { ChevronLeft, ChevronRight, Plus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { shipmentStatusLabel } from '../components/badges';
import { Alert, EmptyState, Loading } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { ShipmentStatusBadge } from '../components/shipment/status';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { useAuth } from '../lib/auth';
import type { Department, ShipmentListResponse, ShipmentStatus } from '../lib/types';
import { SHIPMENT_STATUSES } from '../lib/types';
import { formatDate, formatMoney } from '../lib/utils';
import { useApi } from '../lib/useApi';
import { api } from '../lib/api';

const PAGE_SIZE = 10;
const ALL = '';

/**
 * LISTA DE ENVIOS
 *
 * Una sola pantalla para todos los roles: el backend filtra por
 * identidad (emisor/receptor solo ven lo suyo) y además acepta
 * filtros de staff que mostramos solo a OPERATOR/ADMIN.
 */
export function ShipmentsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const roles = profile?.roles ?? [];
  const isStaff = roles.includes('OPERATOR') || roles.includes('ADMIN');
  const canCreate = roles.includes('SENDER') || isStaff;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<ShipmentStatus | typeof ALL>(ALL);
  const [scope, setScope] = useState<'' | 'active' | 'closed'>('');
  const [page, setPage] = useState(1);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [originDepartmentId, setOriginDepartmentId] = useState('');
  const [destDepartmentId, setDestDepartmentId] = useState('');
  const [monthFilter, setMonthFilter] = useState('');

  // Debounce la búsqueda para no pegarle al backend en cada tecla.
  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api<{ data: Department[] }>('/api/departments');
        if (!cancelled) setDepartments(res.data || []);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Volver a la primera página al cambiar filtros.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, status, scope, originDepartmentId, destDepartmentId, monthFilter]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(PAGE_SIZE));
    if (debouncedSearch) params.set('search', debouncedSearch);
    if (status) params.set('status', status);
    if (scope) params.set('scope', scope);
    if (originDepartmentId) params.set('originDepartmentId', originDepartmentId);
    if (destDepartmentId) params.set('destDepartmentId', destDepartmentId);
    if (monthFilter) {
      const [year, month] = monthFilter.split('-');
      if (year) params.set('year', year);
      if (month) params.set('month', month);
    }
    return `/api/shipments?${params.toString()}`;
  }, [page, debouncedSearch, status, scope, originDepartmentId, destDepartmentId, monthFilter]);

  const { data, loading, error, reload } = useApi<ShipmentListResponse>(path);
  const rows = data?.data ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  return (
    <div>
      <PageHeader
        title="Envíos"
        description={
          isStaff
            ? 'Toda la operación. Usa los filtros para encontrar un paquete.'
            : roles.includes('COURIER')
              ? 'Historial de envíos asignados para transporte o entrega.'
              : 'Tus envíos enviados y recibidos.'
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Recargar
            </Button>
            {canCreate ? (
              <Button size="sm" onClick={() => navigate('/envios/nuevo')}>
                <Plus className="h-4 w-4" />
                Nuevo envío
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

      {/* Filtros */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por código, artículo o destinatario…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar envío"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Select
              className="sm:w-56"
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
              aria-label="Filtrar por etapa"
            >
              <option value="">Todos</option>
              <option value="active">Activos</option>
              <option value="closed">Cerrados</option>
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Select
            className="sm:w-56"
            value={originDepartmentId}
            onChange={(event) => setOriginDepartmentId(event.target.value)}
            aria-label="Filtrar por departamento de origen"
          >
            <option value="">Origen: Todos</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </Select>
          <Select
            className="sm:w-56"
            value={destDepartmentId}
            onChange={(event) => setDestDepartmentId(event.target.value)}
            aria-label="Filtrar por departamento de destino"
          >
            <option value="">Destino: Todos</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </Select>
          <Input
            type="month"
            className="sm:w-48"
            value={monthFilter}
            onChange={(event) => setMonthFilter(event.target.value)}
            aria-label="Filtrar por mes"
          />
        </div>
      </div>

      <Card>
        {loading && !rows.length ? <Loading label="Cargando envíos…" /> : null}

        {!loading && !error && rows.length === 0 ? (
          <EmptyState
            title="No hay envíos con esos criterios"
            description="Ajusta los filtros o crea un envío nuevo."
            action={
              canCreate ? (
                <Button size="sm" onClick={() => navigate('/envios/nuevo')}>
                  <Plus className="h-4 w-4" />
                  Nuevo envío
                </Button>
              ) : null
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
                  <TableHead className="hidden md:table-cell">Destino</TableHead>
                  <TableHead className="hidden lg:table-cell">Repartidor</TableHead>
                  <TableHead className="hidden sm:table-cell">Artículos</TableHead>
                  <TableHead className="hidden lg:table-cell">Importe</TableHead>
                  <TableHead className="hidden sm:table-cell">Entrega est.</TableHead>
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
                      <ShipmentStatusBadge label={shipment.statusLabel} tone={shipment.statusTone} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-slate-600">
                      {[shipment.recipientAddress.city, shipment.recipientAddress.contactName]
                        .filter(Boolean)
                        .join(' · ')}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 lg:table-cell">
                      {shipment.assignedCourier?.name || '—'}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">
                      {shipment.itemCount}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 lg:table-cell">
                      {formatMoney(shipment.amountCents, shipment.currency)}
                    </TableCell>
                    <TableCell className="hidden text-slate-600 sm:table-cell">
                      {formatDate(shipment.estimatedDeliveryAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-3 py-2.5">
              <p className="text-xs text-slate-500">
                Página {pagination?.page ?? page} de {totalPages} · {pagination?.total ?? 0} envíos
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
      </Card>
    </div>
  );
}