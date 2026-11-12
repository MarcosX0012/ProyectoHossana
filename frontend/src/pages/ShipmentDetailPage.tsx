import { useParams } from 'react-router-dom';
import { ShipmentDetail } from '../components/shipment/ShipmentDetail';
import { PageHeader } from '../components/PageHeader';
import { Link } from 'react-router-dom';

/**
 * PAGINA DE DETALLE
 *
 * Ruta `/envios/:code`. El código puede ser el visible
 * (`HOS-2026-000123`) o el token firmado del QR; el backend resuelve
 * ambos. Aquí solo se cuelga el componente compartido por todas las
 * pantallas de envíos.
 */
export function ShipmentDetailPage() {
  const { code } = useParams();

  if (!code) {
    return (
      <div className="py-10 text-center text-sm text-slate-500">
        Falta el código del envío.{' '}
        <Link to="/envios" className="text-indigo-600 underline-offset-2 hover:underline">
          Volver a la lista
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Detalle del envío"
        description="Opera el paquete y sigue su recorrido en tiempo real."
      />
      <ShipmentDetail code={code} />
    </div>
  );
}