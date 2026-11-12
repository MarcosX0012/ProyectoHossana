import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { api } from '../../lib/api';

export function RutaRepartidor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api<{ data: any[] }>(`/api/courier/route/${id}/today`);
        setAssignments(res.data || []);
      } catch {}
    };
    load();
  }, [id]);

  return (
    <div>
      <PageHeader title="Ruta del día - Repartidor" description="Asignaciones del repartidor para hoy" actions={<Button variant="ghost" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" />Volver</Button>} />
      <div className="space-y-4">
        {assignments.length === 0 && <Card><CardContent className="py-8 text-center text-slate-500">Sin asignaciones para hoy</CardContent></Card>}
        {assignments.map((a: any) => (
          <Card key={a.id}>
            <CardHeader><CardTitle className="flex items-center justify-between"><span className="font-mono">{a.trackingCode}</span><span className={`rounded-full px-2 py-1 text-xs ${a.status === 'DELIVERED' ? 'bg-green-100 text-green-700' : a.status === 'OUT_FOR_DELIVERY' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>{a.status}</span></CardTitle></CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div><p className="font-medium">Destinatario</p><p>{a.recipientAddress?.contactName}</p><p>{a.recipientAddress?.contactPhone}</p></div>
                <div><p className="font-medium">Dirección</p><p className="flex items-start gap-1"><MapPin className="h-4 w-4 mt-0.5" />{a.recipientAddress?.line1}, {a.recipientAddress?.city}</p></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
