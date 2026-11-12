import { Check, UserRoundPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { StepIndicator } from '../components/ClientSteps';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { clearClientRegEmail, getClientRegEmail, getClientRegToken } from '../lib/clientRegistration';

/**
 * REGISTRO DE CLIENTE · PASO 3 (datos y contraseña)
 *
 * El correo ya está verificado con el OTP. Aquí se completan los datos,
 * se aplica la política de contraseñas (mínimo 8 caracteres con
 * mayúscula, minúscula, número y carácter especial) y el backend crea
 * la cuenta y devuelve la sesión ya iniciada.
 */
export function ClientCompleteRegistration() {
  const navigate = useNavigate();
  const { establishSession } = useAuth();
  const email = getClientRegEmail();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!email) {
    return <Navigate to="/cliente/registro" replace />;
  }

  // Sin el token entregado al verificar el OTP no se puede completar:
  // el paso 3 solo es válido tras el paso 2 en esta misma pestaña.
  const registrationToken = getClientRegToken();
  if (!registrationToken) {
    return <Navigate to="/cliente/registro/verificar" replace />;
  }

  const rules = [
    { label: 'Al menos 8 caracteres', ok: password.length >= 8 },
    { label: 'Una letra mayúscula', ok: /[A-Z]/.test(password) },
    { label: 'Una letra minúscula', ok: /[a-z]/.test(password) },
    { label: 'Un número', ok: /[0-9]/.test(password) },
    { label: 'Un carácter especial (! @ # $ %…)', ok: /[^A-Za-z0-9]/.test(password) },
    { label: 'Las contraseñas coinciden', ok: password.length > 0 && password === confirmPassword },
  ];
  const passwordReady = rules.every((rule) => rule.ok);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!passwordReady) {
      setError('La contraseña aún no cumple todos los requisitos');
      return;
    }

    setLoading(true);
    try {
      const session = await api<{
        accessToken: string;
        refreshToken?: string;
        user: { firstName: string };
      }>('/api/auth/client/complete', {
        method: 'POST',
        json: {
          email,
          registrationToken,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: phone.trim() || undefined,
          password,
          confirmPassword,
        },
      });

      clearClientRegEmail();
      await establishSession(session.accessToken, session.refreshToken);
      navigate('/', { replace: true, state: { notice: '¡Cuenta creada! Bienvenido a Hossana.' } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la cuenta');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ClientShell>
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <StepIndicator current={3} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tus datos</CardTitle>
            <CardDescription>
              Último paso: completa tu perfil y define tu contraseña. Estás registrando{' '}
              <strong>{email}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="first-name">Nombre</Label>
                  <Input
                    id="first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="last-name">Apellido</Label>
                  <Input
                    id="last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="phone">Teléfono (opcional)</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="70012345"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Sirve para contactarte sobre tus entregas.
                </p>
              </div>

              <div>
                <Label htmlFor="new-password">Contraseña</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <div>
                <Label htmlFor="confirm-password">Confirmar contraseña</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </div>

              <ul className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs">
                {rules.map((rule) => (
                  <li
                    key={rule.label}
                    className={rule.ok ? 'flex items-center gap-1.5 text-emerald-700' : 'flex items-center gap-1.5 text-slate-500'}
                  >
                    {rule.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {rule.label}
                  </li>
                ))}
              </ul>

              <Button type="submit" className="w-full" disabled={loading || !passwordReady}>
                <UserRoundPlus className="h-4 w-4" />
                {loading ? 'Creando cuenta…' : 'Crear mi cuenta'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}