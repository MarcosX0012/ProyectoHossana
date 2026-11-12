import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  Package,
  RefreshCw,
  Truck,
  XCircle,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useState } from 'react';
import { shipmentStatusLabel } from '../components/badges';
import { Alert, EmptyState, Loading } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import type { DashboardMetrics } from '../lib/types';
import { useApi } from '../lib/useApi';

interface Stat {
  label: string;
  value: number;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  tone: 'slate' | 'emerald' | 'indigo' | 'amber' | 'rose';
}

const TONES: Record<Stat['tone'], string> = {
  slate: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
};

function StatCard({ stat }: { stat: Stat }) {
  const Icon = stat.icon;
  return (
    <Card>
      <CardContent className="flex items-start gap-4 p-5">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${TONES[stat.tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm text-slate-500">{stat.label}</p>
          <p className="text-2xl font-semibold tracking-tight text-slate-900">{stat.value}</p>
          <p className="truncate text-xs text-slate-400">{stat.hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Dashboard: cifras globales de la operación.
 * `GET /api/shipments/metrics` devuelve scope "global" cuando la
 * cuenta es ADMIN u OPERATOR.
 */
export function Dashboard() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  if (month) query.set('month', month);
  if (year && month) query.set('year', year);

  const url = query.toString() ? `/api/shipments/metrics?${query.toString()}` : '/api/shipments/metrics';

  const { data, loading, error, reload } = useApi<{ data: DashboardMetrics }>(url);

  const metrics = data?.data;

  const stats: Stat[] = metrics
    ? metrics.scope === 'global'
      ? [
          {
            label: 'Envíos totales',
            value: metrics.total ?? 0,
            hint: 'Histórico filtrado',
            icon: Package,
            tone: 'indigo',
          },
          {
            label: 'Creados / Confirmados',
            value: (metrics.created ?? 0) + (metrics.confirmed ?? 0),
            hint: `Creados: ${metrics.created ?? 0} · Confirmados: ${metrics.confirmed ?? 0}`,
            icon: Clock,
            tone: 'slate',
          },
          {
            label: 'En tránsito / Centro',
            value: metrics.inTransit ?? 0,
            hint: 'En ruta o en centro de distribución',
            icon: Truck,
            tone: 'amber',
          },
          {
            label: 'Fuera para entrega',
            value: metrics.outForDelivery ?? 0,
            hint: 'En reparto',
            icon: MapPin,
            tone: 'indigo',
          },
          {
            label: 'Entregados',
            value: metrics.delivered ?? 0,
            hint: `${metrics.deliveredOnTime ?? 0} dentro del plazo`,
            icon: CheckCircle2,
            tone: 'emerald',
          },
          {
            label: 'Pendientes / Recogidos',
            value: metrics.pending ?? 0,
            hint: 'Por recoger o recogidos',
            icon: Clock,
            tone: 'slate',
          },
          {
            label: 'Con retraso',
            value: metrics.late ?? 0,
            hint: 'Fuera de la fecha estimada',
            icon: Clock,
            tone: 'amber',
          },
          {
            label: 'Incidencias',
            value: metrics.exceptions ?? 0,
            hint: 'EXCEPTION, LOST, ON_HOLD…',
            icon: AlertTriangle,
            tone: 'amber',
          },
          {
            label: 'Fallos de sincronización',
            value: metrics.syncFailures ?? 0,
            hint: '3+ intentos con el transportista',
            icon: XCircle,
            tone: 'rose',
          },
        ]
      : [
          {
            label: 'Enviados',
            value: (metrics as { sent?: number }).sent ?? 0,
            hint: 'Por esta cuenta',
            icon: Package,
            tone: 'indigo',
          },
          {
            label: 'Recibidos',
            value: (metrics as { received?: number }).received ?? 0,
            hint: 'Hacia esta cuenta',
            icon: CheckCircle2,
            tone: 'emerald',
          },
          {
            label: 'Activos',
            value: (metrics as { active?: number }).active ?? 0,
            hint: 'Aún en curso',
            icon: Clock,
            tone: 'amber',
          },
        ]
    : [];

  const byStatus = Object.entries(metrics?.byStatus ?? {})
    .sort((a, b) => b[1] - a[1]);
  const maxCount = byStatus[0]?.[1] ?? 1;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Visión general de la operación de envíos."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        }
      />

      {metrics?.scope === 'global' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Filtros</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Desde</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Hasta</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Mes</Label>
              <Select value={month} onChange={(e: any) => setMonth(e.target.value)}>
                <option value="">Todos</option>
                <option value="1">Enero</option>
                <option value="2">Febrero</option>
                <option value="3">Marzo</option>
                <option value="4">Abril</option>
                <option value="5">Mayo</option>
                <option value="6">Junio</option>
                <option value="7">Julio</option>
                <option value="8">Agosto</option>
                <option value="9">Septiembre</option>
                <option value="10">Octubre</option>
                <option value="11">Noviembre</option>
                <option value="12">Diciembre</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Año</Label>
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Alert
          notice={{ kind: 'error', message: error }}
          className="mb-4"
        />
      ) : null}

      {loading && !metrics ? <Loading label="Cargando métricas…" /> : null}

      {!loading && !error && !metrics ? (
        <EmptyState
          title="No hay métricas disponibles"
          description="El servidor no devolvió información del panel."
          action={<Button variant="outline" size="sm" onClick={reload}>Reintentar</Button>}
        />
      ) : null}

      {metrics ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {stats.map((stat) => (
              <StatCard key={stat.label} stat={stat} />
            ))}
          </div>

          {byStatus.length > 0 ? (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Envíos por estado</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {byStatus.map(([status, count]) => (
                  <div key={status}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="text-slate-600">{shipmentStatusLabel(status)}</span>
                      <span className="font-medium text-slate-900">{count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-2 rounded-full bg-indigo-500 transition-all"
                        style={{ width: `${Math.max(4, (count / maxCount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {metrics.scope === 'global' ? (
            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Envíos por departamento de origen</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(metrics.byOriginDepartment ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">Sin datos para el periodo seleccionado</p>
                  ) : (
                    metrics.byOriginDepartment?.map((item: any) => (
                      <div key={item.departmentId} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{item.department?.name ?? 'Sin origen'}</span>
                        <span className="font-medium text-slate-900">{item.count}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Envíos por departamento de destino</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(metrics.byDestinationDepartment ?? []).length === 0 ? (
                    <p className="text-sm text-slate-500">Sin datos para el periodo seleccionado</p>
                  ) : (
                    metrics.byDestinationDepartment?.map((item: any) => (
                      <div key={item.departmentId} className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">{item.department?.name ?? 'Sin destino'}</span>
                        <span className="font-medium text-slate-900">{item.count}</span>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
