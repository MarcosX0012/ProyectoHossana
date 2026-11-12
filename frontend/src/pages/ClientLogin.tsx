import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useAuth } from '../lib/auth';

/**
 * INICIO DE SESION DEL CLIENTE
 *
 * Ruta propia (/cliente/login), separada del acceso del personal
 * (/login). Tras entrar, cada rol cae a su pantalla natural mediante
 * `HomeRedirect`: los clientes (SENDER) van a /envios.
 */
export function ClientLogin() {
  const { status, profile, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated' && profile) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ClientShell>
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Inicia sesión como cliente</CardTitle>
            <CardDescription>
              Consulta y registra tus envíos desde tu panel personal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {location.state &&
            typeof location.state === 'object' &&
            'notice' in location.state &&
            typeof (location.state as { notice?: unknown }).notice === 'string' ? (
              <Alert
                notice={{ kind: 'info', message: String((location.state as { notice: string }).notice) }}
                className="mb-4"
              />
            ) : null}
            {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="client-email">Correo electrónico</Label>
                <Input
                  id="client-email"
                  type="email"
                  autoComplete="username"
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <Label htmlFor="client-password">Contraseña</Label>
                <Input
                  id="client-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              {error ? null : (
                <p className="text-xs text-slate-500">
                  Mínimo 8 caracteres, con mayúscula, minúscula, número y un carácter especial.
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                <LockKeyhole className="h-4 w-4" />
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-slate-600">
              ¿No tienes cuenta?{' '}
              <Link to="/cliente/registro" className="font-medium text-indigo-700 hover:underline">
                Regístrate gratis
              </Link>
            </p>
          </CardContent>
        </Card>

        <div className="mt-6 flex flex-col items-center gap-1.5 text-center text-xs text-slate-500">
          <Link to="/cliente" className="hover:text-slate-700 hover:underline">
            ← Volver a la página principal
          </Link>
          <span>
            ¿Eres del personal?{' '}
            <Link to="/login" className="font-medium text-slate-600 hover:text-slate-800 hover:underline">
              Acceso interno
            </Link>
          </span>
        </div>
      </div>
    </ClientShell>
  );
}