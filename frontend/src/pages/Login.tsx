import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { useAuth } from '../lib/auth';

interface LocationState {
  from?: string;
  notice?: string;
}

/**
 * Pantalla de inicio de sesión.
 *
 * Si ya hay sesión, redirige al panel. La contraseña viaja en claro
 * solo hacia el proxy local (HTTPS lo pone el despliegue, no el dev).
 */
export function Login() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status === 'authenticated') {
    return <Navigate to={state.from ?? '/'} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      // El redirect por rol lo decide `HomeRedirect` en `/`.
      navigate(state.from ?? '/', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            H
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-900">Hossana</p>
            <p className="text-sm text-slate-500">Rastreo de envíos y logística</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Iniciar sesión</CardTitle>
            <CardDescription>
              Ingresa con tu cuenta para operar envíos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {state.notice ? <Alert notice={{ kind: 'info', message: state.notice }} className="mb-4" /> : null}
            {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="identifier">Correo electrónico</Label>
                <Input
                  id="identifier"
                  type="email"
                  autoComplete="username"
                  placeholder="admin@demo.hossana.local"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                <LockKeyhole className="h-4 w-4" />
                {loading ? 'Entrando…' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}