import { Facebook, LogOut, Mail, MapPin, Menu, PackageSearch, Phone, X } from 'lucide-react';
import { useEffect, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from './ui/button';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/utils';

/**
 * MARCO PUBLICO DEL PORTAL DE CLIENTES
 *
 * Envuelve las paginas que se ven ANTES de iniciar sesion (portada,
 * tarifas, login y registro). Mantiene separada la cara publica del
 * panel interno: el personal entra por /login y el cliente por
 * /cliente/login.
 *
 * El navbar es fijo (sticky) y sus enlaces son anclas a las secciones
 * de la portada: desde cualquier pagina publica llevan a la portada y
 * desplazan suavemente hasta la seccion pedida.
 *
 * Si ya hay sesion, el encabezado ofrece volver al panel en vez de
 * pedir credenciales otra vez.
 */

const CONTACT = {
  email: 'hossanaimportaciones@gmail.com',
  phoneLabel: '+505 8431-8384',
  phoneHref: 'tel:+50584318384',
  address: 'Del tanque de agua 1/2 Norte, Colonia Vista Hermosa, San Judas, Managua',
  facebook: 'https://www.facebook.com/share/1J5uHpMXKc/',
};

const SECTIONS = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'servicios', label: 'Servicios' },
  { id: 'cobertura', label: 'Cobertura' },
  { id: 'nosotros', label: 'Nosotros' },
  { id: 'contacto', label: 'Contactos' },
];

export function ClientShell({ children }: { children: ReactNode }) {
  const { status, profile, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);
  const authenticated = status === 'authenticated' && profile !== null;

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setIsHidden(true);
        setMenuOpen(false);
      } else {
        setIsHidden(false);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  const handleLogout = async () => {
    await logout();
    navigate('/cliente', { replace: true });
  };

  /** Ir a una seccion de la portada. Si ya estamos en ella, el
   *  desplazamiento se hace aqui; si no, React Router navega y la
   *  portada se encarga del scroll al recibir el hash. */
  const goToSection = (event: ReactMouseEvent, id: string) => {
    setMenuOpen(false);
    if (pathname !== '/cliente') return;
    event.preventDefault();
    window.history.replaceState(null, '', `/cliente#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const sectionLinks = (className: string) =>
    SECTIONS.map((section) => (
      <Link
        key={section.id}
        to={`/cliente#${section.id}`}
        className={className}
        onClick={(event) => goToSection(event, section.id)}
      >
        {section.label}
      </Link>
    ));

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* ── Navbar ─────────────────────────────────────────── */}
      <header
        className={cn(
          'fixed left-0 right-0 top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-md transition-transform duration-300 ease-in-out',
          isHidden && '-translate-y-full',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/cliente" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-base font-bold text-white">
              H
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-slate-900">Hossana</span>
              <span className="block text-xs text-slate-500">Envíos y logística</span>
            </span>
          </Link>

          <nav className="hidden items-center gap-4 md:flex lg:gap-6">
            {sectionLinks(
              'rounded-md px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100 hover:text-black',
            )}
            <Link
              to="/rastreo"
              className="rounded-md px-3 py-2 text-sm font-bold text-slate-900 transition hover:bg-slate-100 hover:text-black"
            >
              Rastrear
            </Link>
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            {authenticated ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
                  <PackageSearch className="h-4 w-4" />
                  Mi panel
                </Button>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" />
                  Salir
                </Button>
              </>
            ) : (
              <Button size="sm" className="text-black" onClick={() => navigate('/cliente/login')}>
                Mi cuenta
              </Button>
            )}
          </div>

          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 md:hidden"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {menuOpen ? (
          <div className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
            <div className="flex flex-col gap-3">
              {sectionLinks(
                'rounded-md px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100 hover:text-black',
              )}
              <Link
                to="/rastreo"
                className="rounded-md px-3 py-2 text-sm font-bold text-slate-900 hover:bg-slate-100 hover:text-black"
                onClick={() => setMenuOpen(false)}
              >
                Rastrear un paquete
              </Link>
              <div className="mt-2 flex gap-2">
                {authenticated ? (
                  <>
                    <Button size="sm" className="flex-1" onClick={() => navigate('/')}>
                      Mi panel
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={handleLogout}>
                      Salir
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    className="flex-1 text-black"
                    onClick={() => navigate('/cliente/login')}
                  >
                    Mi cuenta
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </header>

      <main className="flex-1 pt-16">{children}</main>

      {/* ── Footer con contacto ────────────────────────────── */}
      <footer id="contacto" className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-base font-bold text-white">
                H
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold text-slate-900">Hossana S.A.</span>
                <span className="block text-xs text-slate-500">Envíos y logística · Nicaragua</span>
              </span>
            </div>
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-slate-500">
              Recibimos, registramos, organizamos, transportamos y entregamos paquetes en
              Nicaragua, con seguimiento en tiempo real.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
              Contacto
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>
                <a
                  href={`mailto:${CONTACT.email}`}
                  className="flex items-start gap-2 hover:text-indigo-700 hover:underline"
                >
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                  <span className="break-all">{CONTACT.email}</span>
                </a>
              </li>
              <li>
                <a
                  href={CONTACT.phoneHref}
                  className="flex items-start gap-2 hover:text-indigo-700 hover:underline"
                >
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                  {CONTACT.phoneLabel}
                </a>
              </li>
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span>{CONTACT.address}</span>
              </li>
              <li>
                <a
                  href={CONTACT.facebook}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 hover:text-indigo-700 hover:underline"
                >
                  <Facebook className="h-4 w-4 shrink-0 text-indigo-500" />
                  Hossana en Facebook
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-900">
              Enlaces
            </h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-500">
              <li>
                <Link to="/rastreo" className="hover:text-slate-700 hover:underline">
                  Rastrear un paquete
                </Link>
              </li>
              <li>
                <Link to="/cliente#servicios" className="hover:text-slate-700 hover:underline">
                  Servicios
                </Link>
              </li>
              <li>
                <Link to="/cliente#cobertura" className="hover:text-slate-700 hover:underline">
                  Cobertura
                </Link>
              </li>
              <li>
                <Link to="/cliente#adquirir" className="hover:text-slate-700 hover:underline">
                  Adquirir el servicio
                </Link>
              </li>
              <li>
                <Link to="/login" className="hover:text-slate-700 hover:underline">
                  Acceso del personal
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-200">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-slate-500">
            © {new Date().getFullYear()} Hossana S.A. · Managua, Nicaragua
          </p>
        </div>
      </footer>
    </div>
  );
}
