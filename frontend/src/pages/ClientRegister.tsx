import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { StepIndicator } from '../components/ClientSteps';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { setClientRegEmail } from '../lib/clientRegistration';

/**
 * REGISTRO DE CLIENTE · PASO 1 (correo)
 *
 * Solo se pide el correo. El backend genera un código numérico de 6
 * dígitos y lo envía a esa dirección; la cuenta NO se crea hasta
 * verificarlo. Así nadie registra correos que no controla.
 */
export function ClientRegister() {
  const { status, profile } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
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
      const response = await api<{
        email: string;
        expiresAt: string;
        message: string;
        devCode?: string;
      }>('/api/auth/client/register', { method: 'POST', json: { email: email.trim() } });

      setClientRegEmail(response.email);
      navigate('/cliente/registro/verificar', {
        replace: true,
        state: { devCode: response.devCode ?? null },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar el registro');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ClientShell>
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <StepIndicator current={1} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Crea tu cuenta</CardTitle>
            <CardDescription>
              Paso 1 de 3 · Ingresa tu correo electrónico. Te enviaremos un código de
              verificación para confirmar que es tuyo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="register-email">Correo electrónico</Label>
                <Input
                  id="register-email"
                  type="email"
                  autoComplete="email"
                  placeholder="tucorreo@ejemplo.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                <MailCheck className="h-4 w-4" />
                {loading ? 'Enviando código…' : 'Enviar código de verificación'}
              </Button>
            </form>

            <p className="mt-5 text-center text-sm text-slate-600">
              ¿Ya tienes cuenta?{' '}
              <Link to="/cliente/login" className="font-medium text-indigo-700 hover:underline">
                Inicia sesión
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}