import { ArrowLeft, CreditCard, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/**
 * PAGO EN LINEA
 *
 * Página informativa a la que apunta `paymentUrl` del backend
 * (`PUBLIC_WEB_URL/pagar/<paymentIntentId>`). La pasarela está
 * deshabilitada por defecto (webhooks apagados), así que aquí NO se
 * cobra: se espera la confirmación del proveedor. El estado final
 * siempre lo decide el webhook de pago.
 */
export function Pagar() {
  const { paymentIntentId } = useParams();
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader className="flex flex-col items-center text-center">
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50">
              <CreditCard className="h-6 w-6 text-indigo-600" />
            </div>
            <CardTitle className="text-base">Preparando tu pago…</CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              Referencia:{' '}
              <code className="font-mono text-xs">{paymentIntentId ?? '—'}</code>
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                <p className="font-medium text-slate-800">¿Qué pasa ahora?</p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-slate-500">
                  <li>Nada se cobra en esta página.</li>
                  <li>La confirmación la registra el proveedor de pago automáticamente.</li>
                  <li>El envío se actualiza en cuanto el pago sea confirmado.</li>
                </ul>
              </div>

              {checked ? (
                <Alert
                  notice={{
                    kind: 'info',
                    message:
                      'Si ya realizaste el pago, el envío cambiará a «confirmado» en cuanto el proveedor lo notifique.',
                  }}
                />
              ) : null}

              <div className="flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setChecked(true)}>
                  <RefreshCw className="h-4 w-4" />
                  Ya pagué, ¿cómo sigue?
                </Button>
                <Button size="sm" onClick={() => navigate('/envios')}>
                  <ArrowLeft className="h-4 w-4" />
                  Ir a mis envíos
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}