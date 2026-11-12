import { Bike, QrCode, ScanLine } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';

/**
 * CONSOLA DEL REPARTIDOR
 *
 * El backend no asigna "cola de reparto": el repartidor trabaja sobre
 * el paquete físico escaneando o tecleando su código HOS-XXXX-XXXXXX.
 * Este es el punto de entrada para abrir el workbench de ese envío.
 */
export function CourierConsole() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const openShipment = (raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) {
      setError('Ingresa el código del paquete.');
      return;
    }
    setError(null);
    navigate(`/envios/${code}`);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    openShipment(value);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Consola de reparto"
        description="Introduce o escanea el código del paquete para operar ese envío."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-indigo-500" />
            Buscar envío por código
          </CardTitle>
          <CardDescription>
            El formato es <code className="font-mono text-xs">HOS-2026-000123</code>. Aparece en el
            QR impreso en el paquete.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row">
            <Input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="HOS-2026-000123"
              autoFocus
              aria-label="Código del envío"
            />
            <Button type="submit" disabled={!value.trim()}>
              <Bike className="h-4 w-4" />
              Abrir envío
            </Button>
          </form>
          {error ? <p className="mt-2 text-sm text-rose-600">{error}</p> : null}

          <div className="mt-5 space-y-3">
            <p className="text-sm text-slate-500 ml-1">Desde aquí podrás:</p>
            <ul className="space-y-2 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <QrCode className="mt-0.5 h-4 w-4 text-slate-400" />
                Registrar custodia y escaneos del paquete
              </li>
              <li className="flex items-start gap-2">
                <Bike className="mt-0.5 h-4 w-4 text-slate-400" />
                Enviar el OTP al receptor y confirmar la entrega
              </li>
              <li className="flex items-start gap-2">
                <QrCode className="mt-0.5 h-4 w-4 text-slate-400" />
                Ver la línea de tiempo y la cadena de custodia
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}