import {
  Bell,
  Bike,
  Calculator,
  LayoutDashboard,
  LogOut,
  Menu,
  PackageOpen,
  PlusCircle,
  UserCircle,
  Users as UsersIcon,
  Wallet,
  Webhook,
} from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { roleLabel } from './badges';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { UserRole } from '../lib/types';
import { cn } from '../lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  roles?: UserRole[];
}

/** Items de navegación. `roles` vacío = cualquier cuenta autenticada. */
const NAV_ITEMS: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/envios', label: 'Envíos', icon: PackageOpen },
  {
    to: '/envios/nuevo',
    label: 'Nuevo envío',
    icon: PlusCircle,
    roles: ['SENDER', 'OPERATOR', 'ADMIN'],
  },
  { to: '/reparto', label: 'Reparto', icon: Bike, roles: ['COURIER', 'OPERATOR', 'ADMIN'] },
  { to: '/tarifas', label: 'Tarifas', icon: Calculator },
  { to: '/notificaciones', label: 'Notificaciones', icon: Bell },
  { to: '/usuarios', label: 'Usuarios', icon: UsersIcon, roles: ['ADMIN'] },
  { to: '/pagos', label: 'Pagos', icon: Wallet, roles: ['ADMIN'] },
  { to: '/repartidores', label: 'Repartidores', icon: Bike, roles: ['ADMIN', 'OPERATOR'] },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook, roles: ['OPERATOR', 'ADMIN'] },
  { to: '/cuenta', label: 'Mi cuenta', icon: UserCircle },
];

function SidebarContent({
  onNavigate,
  unreadCount,
}: {
  onNavigate?: () => void;
  unreadCount: number;
}) {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    const isStaff = profile?.roles.some((role) =>
      ['OPERATOR', 'COURIER', 'ADMIN'].includes(role),
    );
    await logout();
    // El cliente vuelve a su portada pública; el personal, a su login.
    navigate(isStaff ? '/login' : '/cliente', { replace: true });
  };

  const items = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.some((role) => profile?.roles.includes(role)),
  );

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">
          H
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold text-slate-900">Hossana</p>
          <p className="text-xs text-slate-500">Rastreo de envíos</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-slate-900',
                isActive ? 'bg-indigo-50 text-indigo-700' : '',
              )
            }
          >
            <Icon className="h-4 w-4" />
            {label}
            {to === '/notificaciones' && unreadCount > 0 ? (
              <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-sm font-medium text-slate-900">
          {profile ? `${profile.firstName} ${profile.lastName}` : ''}
        </p>
        <p className="truncate text-xs text-slate-500">{profile?.email}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {profile?.roles.map((role) => (
            <Badge key={role} variant="muted">
              {roleLabel(role)}
            </Badge>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={handleLogout}>
          <LogOut className="h-3.5 w-3.5" />
          Cerrar sesión
        </Button>
      </div>
    </div>
  );
}

/**
 * Estructura general del panel: sidebar fijo (escritorio), cajón
 * deslizante (móvil) y un `<Outlet/>` donde se renderiza la pantalla.
 * La navegación se filtra por los roles de la cuenta.
 */
export function Layout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const location = useLocation();

  // Al cambiar de pantalla en móvil, el menú se cierra solo.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // El contador se refresca al navegar, cada 30 s y cuando la página de
  // notificaciones marca algo como leído.
  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await api<{ data: { count: number } }>(
          '/api/users/me/notifications/unread-count',
        );
        if (active) setUnreadCount(response.data.count);
      } catch {
        // Un fallo del contador no debe romper la navegación.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 30000);
    const onChange = () => void load();
    window.addEventListener('notifications:changed', onChange);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('notifications:changed', onChange);
    };
  }, [location.pathname]);

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <SidebarContent unreadCount={unreadCount} />
      </aside>

      {mobileOpen ? (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-64 animate-fade-in shadow-2xl lg:hidden">
            <SidebarContent
              onNavigate={() => setMobileOpen(false)}
              unreadCount={unreadCount}
            />
          </aside>
        </>
      ) : null}

      <div className="lg:pl-64">
        <header className="fixed left-0 right-0 top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:left-64">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <p className="text-sm text-slate-500">
            Sistema de rastreo de envíos en tiempo real
          </p>
        </header>

        <main className="mx-auto w-full max-w-[1600px] px-3 pt-20 pb-6 sm:px-4 lg:px-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}