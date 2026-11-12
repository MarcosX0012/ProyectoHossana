import { Check, PencilLine, RotateCcw, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CourierAvailabilityBadge, RoleBadge, UserStatusBadge, roleLabel } from '../components/badges';
import { Alert, EmptyState, Loading, type Notice } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { Input, Select } from '../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, fullName } from '../lib/utils';
import {
  USER_ROLES,
  USER_STATUSES,
  type PublicUser,
  type UserRole,
  type UserStatus,
} from '../lib/types';
import { useApi } from '../lib/useApi';

const STATUS_LABELS: Record<UserStatus, string> = {
  ACTIVE: 'Activo',
  PENDING_VERIFICATION: 'Sin verificar',
  SUSPENDED: 'Suspendido',
};

/** Etiqueta del filtro "todos". */
const ALL = '';

export function Users() {
  const { profile: me, reloadProfile } = useAuth();

  // Filtros. La búsqueda por texto se "calma" 350 ms para no pedir la
  // lista en cada tecla; los selects aplican de inmediato.
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState(ALL);
  const [status, setStatus] = useState<UserStatus | typeof ALL>(ALL);
  const [role, setRole] = useState<UserRole | typeof ALL>(ALL);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    if (role) params.set('role', role);
    return `/api/auth/users?${params.toString()}`;
  }, [search, status, role]);

  const { data, loading, error, reload } = useApi<{ data: PublicUser[] }>(path);
  const users = data?.data ?? [];

  // La disponibilidad de los repartidores cambia cuando se asigna o se
  // entrega un envío en otra pantalla. Un refresco periódico evita que
  // el panel muestre "Disponible" cuando ya están ocupados.
  useEffect(() => {
    const timer = setInterval(reload, 20000);
    return () => clearInterval(timer);
  }, [reload]);

  const hasFilters = Boolean(search || status || role);
  const clearFilters = () => {
    setSearchInput('');
    setSearch(ALL);
    setStatus(ALL);
    setRole(ALL);
  };

  // ── Editor de roles ──────────────────────────────────────────
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [draftRoles, setDraftRoles] = useState<UserRole[]>([]);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const openDialog = (user: PublicUser) => {
    setEditing(user);
    setDraftRoles(user.roles);
    setDialogError(null);
  };

  const toggleRole = (target: UserRole) => {
    setDraftRoles((previous) =>
      previous.includes(target)
        ? previous.filter((item) => item !== target)
        : [...previous, target],
    );
  };

  const saveRoles = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setDialogError(null);

    if (draftRoles.length === 0) {
      setDialogError('Debe asignarse al menos un rol.');
      return;
    }

    // Misma regla que aplica el backend: un admin no puede quitarse
    // su propio rol ADMIN. Se avisa aquí antes de hacer la llamada.
    const removingOwnAdmin =
      me?.id === editing.id && me.roles.includes('ADMIN') && !draftRoles.includes('ADMIN');
    if (removingOwnAdmin) {
      setDialogError('No puedes quitarte a ti mismo el rol de administrador.');
      return;
    }

    setSaving(true);
    try {
      await api('/api/auth/users/roles', {
        method: 'POST',
        json: { userId: editing.id, roles: draftRoles },
      });
      setNotice({
        kind: 'success',
        message: `Roles actualizados de ${fullName(editing)}.`,
      });
      setEditing(null);
      reload();
      // Si me edité a mí mismo, los permisos pueden haber cambiado.
      if (me?.id === editing.id) void reloadProfile();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : 'No se pudieron guardar los roles.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Usuarios"
        description="Lista de cuentas del sistema y sus roles. La búsqueda cubre correo, nombre y apellido."
        actions={
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Recargar
          </Button>
        }
      />

      {notice ? (
        <Alert notice={notice} className="mb-4" />
      ) : null}
      {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

      {/* Filtros */}
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Buscar por correo, nombre o apellido…"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            aria-label="Buscar usuarios"
          />
        </div>

        <Select
          className="sm:w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value as UserStatus | typeof ALL)}
          aria-label="Filtrar por estado"
        >
          <option value={ALL}>Todos los estados</option>
          {USER_STATUSES.map((item) => (
            <option key={item} value={item}>
              {STATUS_LABELS[item]}
            </option>
          ))}
        </Select>

        <Select
          className="sm:w-48"
          value={role}
          onChange={(event) => setRole(event.target.value as UserRole | typeof ALL)}
          aria-label="Filtrar por rol"
        >
          <option value={ALL}>Todos los roles</option>
          {USER_ROLES.map((item) => (
            <option key={item} value={item}>
              {roleLabel(item)}
            </option>
          ))}
        </Select>

        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpiar
          </Button>
        ) : null}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        {loading && !data ? <Loading label="Cargando usuarios…" /> : null}

        {!loading && !error && users.length === 0 ? (
          <EmptyState
            title="No se encontraron usuarios"
            description={
              hasFilters
                ? 'Prueba con otros filtros o limpia la búsqueda.'
                : 'Aún no hay cuentas registradas en el sistema.'
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

        {!error && users.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Estado / disponibilidad</TableHead>
                  <TableHead className="hidden md:table-cell">Registro</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      <p className="font-medium text-slate-900">{fullName(user)}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {user.roles.map((item) => (
                          <RoleBadge key={item} role={item} />
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.roles.includes('COURIER') && user.courierAvailability ? (
                        <div className="flex flex-col items-start gap-1">
                          <CourierAvailabilityBadge status={user.courierAvailability} />
                          {user.activeShipments ? (
                            <span className="text-xs text-slate-500">
                              {user.activeShipments} envío{user.activeShipments === 1 ? '' : 's'} activo
                              {user.activeShipments === 1 ? '' : 's'}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <UserStatusBadge status={user.status} />
                      )}
                    </TableCell>
                    <TableCell className="hidden text-slate-500 md:table-cell">
                      {formatDate(user.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openDialog(user)}
                        title="Editar roles"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        Roles
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
              {users.length} usuario{users.length === 1 ? '' : 's'} en pantalla
              {users.length === 200 ? ' (máximo por consulta)' : ''}
            </p>
          </>
        ) : null}
      </div>

      {/* Diálogo de edición de roles */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        {editing ? (
          <DialogContent
            title="Editar roles"
            description={`${fullName(editing)} · ${editing.email}`}
          >
            <form onSubmit={saveRoles}>
              {dialogError ? (
                <Alert notice={{ kind: 'error', message: dialogError }} className="mb-4" />
              ) : null}

              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium text-slate-700">
                  Roles asignados
                </legend>
                {USER_ROLES.map((item) => {
                  const checked = draftRoles.includes(item);
                  return (
                    <label
                      key={item}
                      className={`flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                        checked
                          ? 'border-indigo-300 bg-indigo-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-indigo-600"
                        checked={checked}
                        onChange={() => toggleRole(item)}
                      />
                      <span className="flex-1 text-slate-700">{roleLabel(item)}</span>
                      {checked ? <Check className="h-4 w-4 text-indigo-600" /> : null}
                    </label>
                  );
                })}
              </fieldset>

              <div className="mt-6 flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  <X className="h-4 w-4" />
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar roles'}
                </Button>
              </div>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
