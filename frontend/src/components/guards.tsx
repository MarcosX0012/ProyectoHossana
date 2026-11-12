import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Loading } from './feedback';
import { Button } from './ui/button';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/types';

/**
 * GUARDAS DE RUTAS
 *
 * Separación en dos piezas:
 *
 *  - `RequireAuth`   versión de Outlet: espera a que se resuelva la
 *                    sesión y exige un usuario logueado.
 *  - `RequireRole`   versión de envoltorio: exige que la cuenta tenga
 *                    uno de los roles dados.
 *
 * La seguridad real está en el backend (responde 403 a quien no
 * puede). Esto es UX: no tiene sentido mostrar una pantalla a quien
 * no puede usarla.
 */

export function RequireAuth() {
  const { status, profile } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="Verificando la sesión…" />
      </div>
    );
  }

  if (!profile) {
    // Un visitante anónimo entra por la portada pública del cliente
    // (/cliente), que explica la empresa y ofrece iniciar sesión o
    // registrarse. El personal llega a /login desde el pie de página.
    return <Navigate to="/cliente" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function AccessDenied({ roles }: { roles: UserRole[] }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const roleNames: Record<UserRole, string> = {
    SENDER: 'Emisor',
    RECIPIENT: 'Receptor',
    OPERATOR: 'Operador',
    COURIER: 'Repartidor',
    ADMIN: 'Administrador',
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-amber-500" />
        <h1 className="text-lg font-semibold text-slate-900">Esta cuenta no tiene acceso aquí</h1>
        <p className="mt-2 text-sm text-slate-500">
          Esta sección está reservada para usuarios con el rol{' '}
          <strong>{roles.map((role) => roleNames[role]).join(' o ')}</strong>. Tu cuenta actual no
          lo tiene.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate('/login', { replace: true })}>
            Otra cuenta
          </Button>
          <Button
            onClick={async () => {
              await logout();
              navigate('/login', { replace: true });
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { profile } = useAuth();

  if (!profile) return <Navigate to="/login" replace />;

  const allowed = roles.some((role) => profile.roles.includes(role));
  if (!allowed) return <AccessDenied roles={roles} />;

  return <>{children}</>;
}