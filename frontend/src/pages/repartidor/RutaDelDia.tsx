import { useEffect, useState } from 'react';
import { Bike, CheckCircle, MapPin } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { api } from '../../lib/api';

export function RutaDelDia() {
  const [assignments, setAssignments] = useState<any[]>([]);

  const load = async () => {
    try {
      const res = await api<{ data: any[] }>('/api/courier/my-shipments');
      setAssignments(res.data || []);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const markInRoute = async (code: string) => {
    try {
      await api('/api/shipments/' + code + '/events', { method: 'POST', json: { status: 'OUT_FOR_DELIVERY', title: 'En ruta de entrega', description: 'El repartidor se encuentra en ruta' } });
      load();
    } catch (e: any) { alert(e.message); }
  };

  const markDelivered = async (code: string) => {
    try {
      // Sin OTP ni evidencia física, la entrega se registra como no
      // verificada y exige un motivo (mínimo 10 caracteres).
      await api('/api/shipments/' + code + '/deliver', {
        method: 'POST',
        json: { unverifiedReason: 'Entrega registrada por el repartidor en la ruta del día' },
      });
      load();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader title="Mis envíos" description="Historial de envíos asignados o transportados" />
      <div className="space-y-4">
        {assignments.length === 0 && <Card><CardContent className="py-8 text-center text-slate-500">No hay envíos asignados</CardContent></Card>}
        {assignments.map((a: any) => (
          <Card key={a.id}>
            <CardHeader><CardTitle className="flex items-center justify-between"><span className="font-mono">{a.trackingCode}</span><span className={a.status === 'OUT_FOR_DELIVERY' ? 'rounded-full px-3 py-1 text-xs bg-blue-100 text-blue-700' : a.status === 'DELIVERED' ? 'rounded-full px-3 py-1 text-xs bg-emerald-100 text-emerald-700' : 'rounded-full px-3 py-1 text-xs bg-amber-100 text-amber-700'}>{a.status}</span></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div><p className="text-sm font-medium text-slate-500">Destinatario</p><p className="font-medium">{a.recipientAddress?.contactName}</p><p className="text-sm">{a.recipientAddress?.contactPhone}</p></div>
                <div><p className="text-sm font-medium text-slate-500">Dirección</p><p className="text-sm flex items-start gap-1"><MapPin className="h-4 w-4 mt-0.5" />{a.recipientAddress?.line1}, {a.recipientAddress?.city}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">
                {a.status !== 'OUT_FOR_DELIVERY' && a.status !== 'DELIVERED' && <Button onClick={() => markInRoute(a.trackingCode)}><Bike className="h-4 w-4" />Marcar en ruta</Button>}
                {a.status !== 'DELIVERED' && <Button onClick={() => markDelivered(a.trackingCode)}><CheckCircle className="h-4 w-4" />Marcar entregado</Button>}
                <Button variant="outline" onClick={() => window.location.href = `/envios/${a.trackingCode}`}>Ver detalle</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
