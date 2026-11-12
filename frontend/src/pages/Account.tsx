import { KeyRound, LogOut, Save, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { RoleBadge, UserStatusBadge } from '../components/badges';
import { Alert, Loading, type Notice } from '../components/feedback';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/utils';

/**
 * Mi cuenta: perfil, contraseña y sesiones.
 *
 * `GET/PATCH /api/users/me` para el perfil, `POST /api/auth/change-password`
 * y `DELETE /api/users/me/sessions`. Tras cambiar la contraseña o cerrar
 * todas las sesiones el backend revoca los refresh tokens, así que la
 * interfaz corta la sesión local y manda al login con un aviso.
 */
export function Account() {
  const { profile, reloadProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [profileForm, setProfileForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    notificationEmail: '',
    locale: 'es',
  });
  const [profileNotice, setProfileNotice] = useState<Notice | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setProfileForm({
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: '',
      notificationEmail: profile.notificationEmail ?? '',
      locale: profile.locale,
    });
  }, [profile]);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setProfileNotice(null);
    setSavingProfile(true);
    try {
      const body: Record<string, string | null> = {
        firstName: profileForm.firstName.trim(),
        lastName: profileForm.lastName.trim(),
        locale: profileForm.locale,
        // Vaciar el campo vuelve a usar el correo principal de la cuenta.
        notificationEmail: profileForm.notificationEmail.trim() || null,
      };
      if (profileForm.phone.trim()) body.phone = profileForm.phone.trim();

      await api('/api/users/me', { method: 'PATCH', json: body });
      await reloadProfile();
      setProfileNotice({ kind: 'success', message: 'Perfil actualizado.' });
    } catch (cause) {
      setProfileNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo actualizar el perfil.',
      });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Contraseña ───────────────────────────────────────────────
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordNotice, setPasswordNotice] = useState<Notice | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordNotice(null);

    if (passwords.next !== passwords.confirm) {
      setPasswordNotice({ kind: 'error', message: 'La confirmación no coincide.' });
      return;
    }
    if (passwords.next.length < 10) {
      setPasswordNotice({
        kind: 'error',
        message: 'La nueva contraseña debe tener al menos 10 caracteres.',
      });
      return;
    }

    setChangingPassword(true);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        json: { currentPassword: passwords.current, newPassword: passwords.next },
      });
      // El backend revoca la familia de refresh tokens: toca entrar
      // de nuevo. La sesión local se corta sin llamar a /logout.
      await logout(false);
      navigate('/login', {
        replace: true,
        state: { notice: 'Contraseña actualizada. Inicia sesión nuevamente.' },
      });
    } catch (cause) {
      setPasswordNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo cambiar la contraseña.',
      });
      setChangingPassword(false);
    }
  };

  // ── Sesiones ─────────────────────────────────────────────────
  const [sessionsBusy, setSessionsBusy] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<Notice | null>(null);

  const closeAllSessions = async () => {
    setSessionsBusy(true);
    setSessionNotice(null);
    try {
      const response = await api<{ data: { revoked: number } }>('/api/users/me/sessions', {
        method: 'DELETE',
      });
      await logout(false);
      navigate('/login', {
        replace: true,
        state: {
          notice: `Se cerraron ${response.data.revoked} sesión(es). Vuelve a iniciar sesión.`,
        },
      });
    } catch (cause) {
      setSessionNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudieron cerrar las sesiones.',
      });
      setSessionsBusy(false);
    }
  };

  // Guardia DESPUÉS de todos los hooks (reglas de hooks de React):
  // RequireAuth ya garantiza que hay perfil, pero si llegara a faltar
  // mostramos un cargando en lugar de romper la pantalla.
  if (!profile) {
    return <Loading label="Cargando tu perfil…" />;
  }

  return (
    <div>
      <PageHeader
        title="Mi cuenta"
        description="Datos personales, contraseña y sesiones activas de tu usuario."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Perfil */}
        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Nombre, teléfono e idioma de la interfaz.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {profile.roles.map((role) => (
                <RoleBadge key={role} role={role} />
              ))}
              <UserStatusBadge status={profile.status} />
            </div>

            {profileNotice ? <Alert notice={profileNotice} className="mb-4" /> : null}

            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="firstName">Nombre</Label>
                  <Input
                    id="firstName"
                    value={profileForm.firstName}
                    onChange={(event) =>
                      setProfileForm((prev) => ({ ...prev, firstName: event.target.value }))
                    }
                    required
                    maxLength={80}
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Apellido</Label>
                  <Input
                    id="lastName"
                    value={profileForm.lastName}
                    onChange={(event) =>
                      setProfileForm((prev) => ({ ...prev, lastName: event.target.value }))
                    }
                    required
                    maxLength={80}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="phone">Teléfono</Label>
                  <Input
                    id="phone"
                    inputMode="numeric"
                    placeholder="+505 80000000"
                    value={profileForm.phone}
                    onChange={(event) =>
                      setProfileForm((prev) => ({ ...prev, phone: event.target.value }))
                    }
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    {profile.phoneVerifiedAt
                      ? 'Verificado. Deja vacío para no modificarlo.'
                      : 'Deja vacío para no modificarlo.'}
                  </p>
                </div>
                <div>
                  <Label htmlFor="locale">Idioma</Label>
                  <Select
                    id="locale"
                    value={profileForm.locale}
                    onChange={(event) =>
                      setProfileForm((prev) => ({ ...prev, locale: event.target.value }))
                    }
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="pt">Português</option>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="notificationEmail">Correo para notificaciones</Label>
                <Input
                  id="notificationEmail"
                  type="email"
                  placeholder={profile.email}
                  value={profileForm.notificationEmail}
                  onChange={(event) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      notificationEmail: event.target.value,
                    }))
                  }
                />
                <p className="mt-1 text-xs text-slate-400">
                  Aquí llegarán los avisos de envíos y asignaciones. Si lo dejas vacío se usa{' '}
                  {profile.email}.
                </p>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={savingProfile}>
                  <Save className="h-4 w-4" />
                  {savingProfile ? 'Guardando…' : 'Guardar cambios'}
                </Button>
              </div>
            </form>

            <dl className="mt-6 space-y-1 border-t border-slate-100 pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Correo</dt>
                <dd className="text-slate-800">{profile.email}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Correo verificado</dt>
                <dd className="text-slate-800">
                  {profile.permissions.emailVerified ? 'Sí' : 'Pendiente'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Miembro desde</dt>
                <dd className="text-slate-800">{formatDate(profile.createdAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Contraseña */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-slate-400" />
                Cambiar contraseña
              </CardTitle>
              <CardDescription>
                Al cambiarla se cierran todas las sesiones abiertas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {passwordNotice ? <Alert notice={passwordNotice} className="mb-4" /> : null}
              <form onSubmit={changePassword} className="space-y-4">
                <div>
                  <Label htmlFor="currentPassword">Contraseña actual</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={passwords.current}
                    onChange={(event) =>
                      setPasswords((prev) => ({ ...prev, current: event.target.value }))
                    }
                    required
                  />
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="newPassword">Nueva contraseña</Label>
                    <Input
                      id="newPassword"
                      type="password"
                      autoComplete="new-password"
                      value={passwords.next}
                      onChange={(event) =>
                        setPasswords((prev) => ({ ...prev, next: event.target.value }))
                      }
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={passwords.confirm}
                      onChange={(event) =>
                        setPasswords((prev) => ({ ...prev, confirm: event.target.value }))
                      }
                      required
                    />
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  Mínimo 10 caracteres, con mayúscula, minúscula y número.
                </p>
                <div className="flex justify-end">
                  <Button type="submit" disabled={changingPassword}>
                    <KeyRound className="h-4 w-4" />
                    {changingPassword ? 'Cambiando…' : 'Cambiar contraseña'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Sesiones */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-slate-400" />
                Seguridad
              </CardTitle>
              <CardDescription>
                Cierra todas las sesiones abiertas en otros dispositivos (incluida esta).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sessionNotice ? <Alert notice={sessionNotice} className="mb-4" /> : null}
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  disabled={sessionsBusy}
                  onClick={closeAllSessions}
                >
                  <LogOut className="h-4 w-4" />
                  {sessionsBusy ? 'Cerrando…' : 'Cerrar todas las sesiones'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
