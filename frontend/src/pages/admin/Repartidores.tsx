import { History, MapPin, Plus, RotateCcw, UserCheck, UserX } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CourierAvailabilityBadge } from '../../components/badges';
import { Alert, EmptyState, Loading, type Notice } from '../../components/feedback';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fullName } from '../../lib/utils';
import type { CourierListItem } from '../../lib/types';

const EMPTY_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  notificationEmail: '',
  phone: '',
  employeeNumber: '',
  agencyId: '',
  isActive: true,
};

/**
 * Listado compartido de repartidores.
 *
 * El administrador puede crear y activar/desactivar cuentas; el
 * operador solo consulta quién está disponible para asignarle envíos.
 * La disponibilidad se refresca sola: cuando se asigna o se entrega un
 * envío, el estado cambia sin recargar la página.
 */
export function Repartidores() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.roles.includes('ADMIN') ?? false;

  const [couriers, setCouriers] = useState<CourierListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api<{ data: CourierListItem[] }>('/api/couriers');
      setCouriers(res.data ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los repartidores.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), 20000);
    return () => clearInterval(timer);
  }, [load]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ temporaryPassword?: string }>('/api/admin/users/courier', {
        method: 'POST',
        json: form,
      });
      setNotice({
        kind: 'success',
        message: res.temporaryPassword
          ? `Repartidor registrado. Contraseña temporal: ${res.temporaryPassword} — entrégala al repartidor; no se volverá a mostrar.`
          : 'Repartidor registrado.',
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar el repartidor.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (courier: CourierListItem) => {
    try {
      await api(`/api/admin/users/${courier.id}/active`, {
        method: 'PATCH',
        json: { isActive: !courier.isActive },
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.');
    }
  };

  const generateEmployeeNumber = async () => {
    try {
      const res = await api<{ data: { employeeNumber: string } }>(
        '/api/admin/users/courier/next-number',
      );
      setForm((current) => ({ ...current, employeeNumber: res.data.employeeNumber }));
    } catch {
      // Si falla, el administrador puede escribirlo a mano.
    }
  };

  return (
    <div>
      <PageHeader
        title="Repartidores"
        description="Disponibilidad en vivo, datos de contacto y rutas del día."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RotateCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Recargar
            </Button>
            {isAdmin ? (
              <Button onClick={() => setShowForm((open) => !open)}>
                <Plus className="h-4 w-4" />
                Nuevo repartidor
              </Button>
            ) : null}
          </div>
        }
      />

      {notice ? <Alert notice={notice} className="mb-4" /> : null}
      {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

      {isAdmin && showForm ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Registrar repartidor</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Número de empleado</Label>
              <div className="flex gap-2">
                <Input
                  value={form.employeeNumber}
                  onChange={(event) =>
                    setForm({ ...form, employeeNumber: event.target.value })
                  }
                />
                <Button variant="outline" onClick={() => void generateEmployeeNumber()}>
                  Generar
                </Button>
              </div>
            </div>
            <div>
              <Label>Correo electrónico</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
              />
            </div>
            <div>
              <Label>Correo para notificaciones</Label>
              <Input
                type="email"
                placeholder="Opcional; por defecto el correo de acceso"
                value={form.notificationEmail}
                onChange={(event) =>
                  setForm({ ...form, notificationEmail: event.target.value })
                }
              />
            </div>
            <div>
              <Label>Nombre</Label>
              <Input
                value={form.firstName}
                onChange={(event) => setForm({ ...form, firstName: event.target.value })}
              />
            </div>
            <div>
              <Label>Apellido</Label>
              <Input
                value={form.lastName}
                onChange={(event) => setForm({ ...form, lastName: event.target.value })}
              />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input
                value={form.phone}
                onChange={(event) => setForm({ ...form, phone: event.target.value })}
              />
            </div>
            <div>
              <Label>Sucursal / agencia</Label>
              <Input
                value={form.agencyId}
                onChange={(event) => setForm({ ...form, agencyId: event.target.value })}
              />
            </div>
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button onClick={() => void create()} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading && couriers.length === 0 ? (
          <Loading label="Cargando repartidores…" />
        ) : null}

        {!loading && couriers.length === 0 ? (
          <EmptyState
            title="No hay repartidores"
            description="Aún no se ha registrado ningún repartidor en el sistema."
          />
        ) : null}

        {couriers.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° empleado</TableHead>
                <TableHead>Repartidor</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Disponibilidad</TableHead>
                <TableHead className="hidden lg:table-cell">Envío actual</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((courier) => (
                <TableRow key={courier.id}>
                  <TableCell className="font-mono text-xs text-slate-600">
                    {courier.employeeNumber || '—'}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => navigate(`/repartidores/${courier.id}`)}
                    >
                      <p className="font-medium text-slate-900 hover:text-indigo-700 hover:underline">
                        {fullName(courier)}
                      </p>
                      <p className="text-xs text-slate-500">{courier.email}</p>
                      {courier.notificationEmail ? (
                        <p className="text-xs text-slate-400">
                          Avisos: {courier.notificationEmail}
                        </p>
                      ) : null}
                    </button>
                  </TableCell>
                  <TableCell className="text-slate-600">{courier.phone || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <CourierAvailabilityBadge status={courier.courierAvailability} />
                      {courier.activeShipments > 0 ? (
                        <span className="text-xs text-slate-500">
                          {courier.activeShipments} envío
                          {courier.activeShipments === 1 ? '' : 's'} activo
                          {courier.activeShipments === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {courier.currentShipment ? (
                      <button
                        type="button"
                        className="text-left text-sm text-indigo-600 hover:underline"
                        onClick={() =>
                          navigate(`/envios/${courier.currentShipment?.trackingCode}`)
                        }
                      >
                        {courier.currentShipment.trackingCode}
                      </button>
                    ) : (
                      <span className="text-sm text-slate-400">Sin envíos</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/repartidores/${courier.id}`)}
                        title="Ver historial de envíos"
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate(`/repartidores/${courier.id}/ruta`)}
                        title="Ver ruta del día"
                      >
                        <MapPin className="h-4 w-4" />
                      </Button>
                      {isAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void toggleActive(courier)}
                          title={courier.isActive ? 'Desactivar' : 'Activar'}
                        >
                          {courier.isActive ? (
                            <UserX className="h-4 w-4" />
                          ) : (
                            <UserCheck className="h-4 w-4" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </div>
    </div>
  );
}
