import { useCallback, useEffect, useState } from 'react';
import { Truck } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select } from '../ui/input';
import { api } from '../../lib/api';
import { courierAvailabilityLabel } from '../badges';
import type { CourierListItem } from '../../lib/types';

export function CourierAssignment({ shipment, onAssigned }: { shipment: any; onAssigned: () => void }) {
  const assignedCourierId = shipment.assignedCourier?.id || shipment.assignedCourierId || '';
  const [couriers, setCouriers] = useState<CourierListItem[]>([]);
  const [courierId, setCourierId] = useState(assignedCourierId);
  const [loading, setLoading] = useState(false);

  const loadCouriers = useCallback(async () => {
    try {
      const res = await api<{ data: CourierListItem[] }>('/api/couriers');
      setCouriers(res.data || []);
    } catch {}
  }, []);

  useEffect(() => {
    void loadCouriers();
  }, [loadCouriers]);

  useEffect(() => {
    setCourierId(assignedCourierId);
  }, [assignedCourierId]);

  const assign = async () => {
    if (!courierId) return;
    setLoading(true);
    try {
      await api(`/api/shipments/${shipment.trackingCode}/assign`, { method: 'POST', json: { courierId } });
      await loadCouriers();
      onAssigned();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  const unassign = async () => {
    if (!assignedCourierId) return;
    if (!window.confirm('¿Quitar la asignación de este repartidor?')) return;
    setLoading(true);
    try {
      await api(`/api/shipments/${shipment.trackingCode}/assign`, { method: 'DELETE' });
      setCourierId('');
      await loadCouriers();
      onAssigned();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4" />Asignar repartidor</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        <Select value={courierId} onChange={(e: any) => setCourierId(e.target.value)}>
          <option value="">Seleccionar repartidor</option>
          {couriers
            .filter((courier) => courier.isActive)
            .map((courier) => (
              <option key={courier.id} value={courier.id}>
                {courier.employeeNumber ? `${courier.employeeNumber} - ` : ''}
                {courier.firstName} {courier.lastName} — {courierAvailabilityLabel(courier.courierAvailability)}
              </option>
            ))}
        </Select>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={assign} disabled={loading || !courierId}>{loading ? 'Asignando...' : assignedCourierId ? 'Reasignar' : 'Asignar'}</Button>
          {assignedCourierId ? (
            <Button size="sm" variant="outline" onClick={unassign} disabled={loading}>Quitar asignación</Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
