import { KeyRound, RefreshCw } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { StepIndicator } from '../components/ClientSteps';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { getClientRegEmail, setClientRegToken } from '../lib/clientRegistration';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * REGISTRO DE CLIENTE · PASO 2 (código OTP)
 *
 * El código tiene 6 dígitos, vence a los 10 minutos y admite 5
 * intentos. El reenvío espera 60 segundos para no convertir el correo
 * del usuario en spam.
 */
export function ClientVerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = getClientRegEmail();

  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const devCode =
    location.state && typeof location.state === 'object' && 'devCode' in location.state
      ? ((location.state as { devCode?: string | null }).devCode ?? null)
      : null;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (!email) {
    return <Navigate to="/cliente/registro" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const result = await api<{ verified: boolean; registrationToken: string }>(
        '/api/auth/client/verify-email',
        {
          method: 'POST',
          json: { email, otp: otp.trim() },
        },
      );
      // El backend solo entrega este token a quien presentó el código
      // correcto: se necesita para crear la cuenta en el paso final.
      if (result.registrationToken) setClientRegToken(result.registrationToken);
      navigate('/cliente/registro/completar', { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo verificar el código');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setNotice(null);
    try {
      const response = await api<{ message: string; devCode?: string }>(
        '/api/auth/client/resend-otp',
        { method: 'POST', json: { email } },
      );
      setNotice(response.message);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reenviar el código');
    }
  };

  const masked = email.replace(/^(.).*@/, '$1•••@');

  return (
    <ClientShell>
      <div className="mx-auto flex max-w-md flex-col px-4 py-12">
        <StepIndicator current={2} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verifica tu correo</CardTitle>
            <CardDescription>
              Enviamos un código de 6 dígitos a <strong>{masked}</strong>. Escríbelo aquí para
              confirmar que el correo es tuyo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {devCode ? (
              <Alert
                notice={{
                  kind: 'info',
                  message:
                    `Modo desarrollo: no hay proveedor de correo configurado. ` +
                    `Tu código es ${devCode}.`,
                }}
                className="mb-4"
              />
            ) : null}
            {notice ? <Alert notice={{ kind: 'success', message: notice }} className="mb-4" /> : null}
            {error ? <Alert notice={{ kind: 'error', message: error }} className="mb-4" /> : null}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="otp">Código de verificación</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                  autoFocus
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  El código vence en 10 minutos. Máximo 5 intentos.
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={loading || otp.length !== 6}>
                <KeyRound className="h-4 w-4" />
                {loading ? 'Verificando…' : 'Verificar código'}
              </Button>
            </form>

            <div className="mt-4 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={handleResend}
                disabled={cooldown > 0}
                className="inline-flex items-center gap-1.5 font-medium text-indigo-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Reenviar código'}
              </button>
              <button
                type="button"
                onClick={() => navigate('/cliente/registro')}
                className="text-slate-500 hover:text-slate-700 hover:underline"
              >
                Cambiar correo
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientShell>
  );
}