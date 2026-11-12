import { Calculator, Info, PackageOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/utils';
import type { Department, ShippingRateCatalogItem } from '../lib/types';

/**
 * TARIFARIO PUBLICO
 *
 * Tabla de precios por departamento de origen y destino. El cliente
 * puede verla antes de registrarse; el mismo componente se usa desde el
 * panel (link "Tarifas").
 */
export function Tarifas() {
  const { status, profile } = useAuth();
  const navigate = useNavigate();

  const [catalog, setCatalog] = useState<ShippingRateCatalogItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [originId, setOriginId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [rates, depts] = await Promise.all([
          api<{ data: ShippingRateCatalogItem[] }>('/api/shipping-rates/catalog'),
          api<{ data: Department[] }>('/api/departments'),
        ]);
        if (cancelled) return;
        setCatalog(rates.data);
        setDepartments(depts.data);
        setOriginId(depts.data[0]?.id ?? '');
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las tarifas');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(
    () =>
      catalog
        .filter((rate) => rate.originDepartment.id === originId)
        .sort((a, b) => a.destDepartment.name.localeCompare(b.destDepartment.name)),
    [catalog, originId],
  );

  /** Total de ejemplo: base + libras adicionales (redondeadas) + delivery. */
  const sampleTotal = (rate: ShippingRateCatalogItem, lbs: number): number => {
    const extra = Math.max(0, Math.ceil(lbs - rate.includedLbs));
    return rate.baseAmountCents + extra * rate.extraPerLbCents + rate.deliveryCents;
  };

  /** Equivalente en dólares con el mismo tipo de cambio del backend. */
  const toUsdCents = (nioCents: number, rate: ShippingRateCatalogItem): number =>
    Math.round(nioCents / rate.exchangeRateNioPerUsd);

  /** `formatMoney` puede devolver "USD 2.47"; aquí forzamos "US$ 2.47". */
  const formatUsd = (cents: number): string =>
    formatMoney(cents, 'USD').replace(/^USD\s*/i, 'US$ ');

  const DualMoney = ({
    nioCents,
    rate,
    usdCents,
    className,
  }: {
    nioCents: number;
    rate: ShippingRateCatalogItem;
    usdCents?: number;
    className?: string;
  }) => (
    <div className={className}>
      <div>{formatMoney(nioCents, 'NIO')}</div>
      <div className="mt-0.5 text-xs font-semibold text-slate-700">
        {formatUsd(usdCents ?? toUsdCents(nioCents, rate))}
      </div>
    </div>
  );

  const authenticated = status === 'authenticated' && profile !== null;
  const exchangeRate = catalog[0]?.exchangeRateNioPerUsd;

  return (
    <ClientShell>
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Tarifas de envío</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              El costo se calcula con el <strong>departamento de origen</strong>, el{' '}
              <strong>departamento de destino</strong> y el <strong>peso en libras</strong>. Sin
              sorpresas: lo que ves aquí es lo que se cobra.
            </p>
          </div>
          <Button onClick={() => navigate(authenticated ? '/envios/nuevo' : '/cliente/registro')}>
            <PackageOpen className="h-4 w-4" />
            {authenticated ? 'Registrar un envío' : 'Crear cuenta para enviar'}
          </Button>
        </div>

        {/* Cómo se calcula */}
        <Card className="mt-6 border-indigo-100 bg-indigo-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Calculator className="h-4 w-4 text-indigo-600" />
              ¿Cómo se calcula el costo?
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
            <div>
              <p className="font-medium text-slate-800">1. Tarifa base</p>
              <p className="mt-1 text-xs">
                Depende de la ruta (origen → destino) e incluye las primeras{' '}
                <strong>2 libras</strong>.
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800">2. Libras adicionales</p>
              <p className="mt-1 text-xs">
                Cada libra extra se cobra según la ruta. Los decimales se redondean hacia
                arriba: 4.5 lb se cobran como 5 lb.
              </p>
            </div>
            <div>
              <p className="font-medium text-slate-800">3. Delivery</p>
              <p className="mt-1 text-xs">
                Cargo fijo de entrega según la ruta. En la ruta local (mismo departamento) el
                delivery ya está incluido.
              </p>
            </div>
          </CardContent>
        </Card>

        <Alert
          notice={{
            kind: 'info',
            message:
              'Importante: los paquetes de menos de 2 lb se cobran como 2 lb, los decimales ' +
              'se redondean hacia arriba (4.5 lb se cobran como 5 lb) y el peso máximo aceptado ' +
              'es de 50 lb.',
          }}
          className="mt-4"
        />

        {error ? <Alert notice={{ kind: 'error', message: error }} className="mt-4" /> : null}

        {/* Tabla por origen */}
        <Card className="mt-6">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-base">Consulta por departamento de origen</CardTitle>
              <CardDescription>
                Precios en córdobas (C$) y su equivalente en dólares (US$).
              </CardDescription>
              {exchangeRate ? (
                <p className="mt-1 text-xs font-semibold text-indigo-700">
                  Tipo de cambio aplicado: C$ {exchangeRate.toFixed(2)} = US$ 1.00
                </p>
              ) : null}
            </div>
            <div className="w-full sm:w-64">
              <Label htmlFor="origin-department">Origen</Label>
              <Select
                id="origin-department"
                value={originId}
                onChange={(event) => setOriginId(event.target.value)}
                disabled={loading || departments.length === 0}
              >
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Destino</th>
                  <th className="px-4 py-2.5 font-medium">Ruta</th>
                  <th className="px-4 py-2.5 font-medium text-right">Base (2 lb incl.)<br /><span className="font-normal normal-case text-slate-400">C$ / US$</span></th>
                  <th className="px-4 py-2.5 font-medium text-right">Libra adicional<br /><span className="font-normal normal-case text-slate-400">C$ / US$</span></th>
                  <th className="px-4 py-2.5 font-medium text-right">Delivery<br /><span className="font-normal normal-case text-slate-400">C$ / US$</span></th>
                  <th className="px-4 py-2.5 font-medium text-right">Total 2 lb<br /><span className="font-normal normal-case text-slate-400">C$ / US$</span></th>
                  <th className="px-4 py-2.5 font-medium text-right">Total 10 lb<br /><span className="font-normal normal-case text-slate-400">C$ / US$</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((rate) => (
                  <tr key={rate.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {rate.destDepartment.name}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {rate.routeTypeLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      <DualMoney nioCents={rate.baseAmountCents} rate={rate} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      <DualMoney nioCents={rate.extraPerLbCents} rate={rate} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {rate.deliveryCents === 0 ? (
                        'Incluido'
                      ) : (
                        <DualMoney nioCents={rate.deliveryCents} rate={rate} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      <DualMoney nioCents={sampleTotal(rate, 2)} rate={rate} />
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-indigo-700">
                      <DualMoney nioCents={sampleTotal(rate, 10)} rate={rate} />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      No hay tarifas disponibles para este origen.
                    </td>
                  </tr>
                ) : null}
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                      Cargando tarifas…
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          El total final se calcula automáticamente al registrar el envío con el peso exacto.
          Estas tablas muestran ejemplos para 2 lb y 10 lb. El equivalente en dólares usa el
          tipo de cambio de referencia de Hossana; el precio oficial se cobra en córdobas.
        </p>
      </div>
    </ClientShell>
  );
}