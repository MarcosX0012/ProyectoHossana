import {
  ArrowDown,
  Building2,
  CheckCircle2,
  FileText,
  Mailbox,
  MapPin,
  PackageCheck,
  PackageSearch,
  Phone,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ClientShell } from '../components/ClientShell';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Department } from '../lib/types';

/**
 * PORTADA PUBLICA DEL CLIENTE
 *
 * Es lo primero que ve quien llega al portal. Esta pensada como un
 * LIBRO: cada seccion ocupa una pantalla completa y el scroll se
 * engancha a ella (el marco activa `data-snap` en <html>), de modo que
 * quien baja pasa de una "hoja" a la siguiente sin quedar a medias.
 *
 * Orden de lectura, deliberado: primero se ofrece y explica el
 * servicio (hero, servicios, proceso), despues la confianza
 * (cobertura con mapa y quienes somos) y solo al final, cuando el
 * visitante ya tiene la informacion, se le invita a adquirir el
 * servicio. Por eso los botones de crear cuenta / iniciar sesion
 * estan unicamente en la ultima seccion y en el navbar ("Mi cuenta").
 *
 * No se muestran tarifas aqui: el tarifario vive dentro del panel, al
 * momento de registrar un envio. Deliberadamente NO muestra nada del
 * panel interno: eso vive detras del login.
 */

const CONTACT = {
  email: 'hossanaimportaciones@gmail.com',
  phoneLabel: '+505 8431-8384',
  phoneHref: 'tel:+50584318384',
  address: 'Del tanque de agua 1/2 Norte, Colonia Vista Hermosa, San Judas, Managua',
  facebook: 'https://www.facebook.com/share/1J5uHpMXKc/',
};

const FALLBACK_DEPARTMENTS = ['Managua', 'León', 'Estelí', 'Granada', 'Chinandega'];

/** Mapa embebido de la sucursal de Managua (sin API key). */
const MAP_EMBED =
  'https://www.google.com/maps?q=4P75%2B32Q+TRANSPORTES+HOSSANA,+Managua&hl=es&z=17&output=embed';

/**
 * Imagen con respaldo. Si el archivo no existe o no carga se muestra
 * un panel con degradado e icono: nunca queda un cuadro roto.
 */
function Photo({
  src,
  alt,
  icon: Icon,
  className = '',
}: {
  src: string;
  alt: string;
  icon: typeof Truck;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-indigo-500 via-indigo-600 to-slate-800 ${className}`}
        aria-label={alt}
        role="img"
      >
        <Icon className="h-12 w-12 text-white/70" />
      </div>
    );
  }

  return (
    <div className={`overflow-hidden bg-slate-200 ${className}`}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
    </div>
  );
}

/**
 * Fondo de seccion con foto: capa absoluta + velo blanco encima.
 * El velo mantiene el texto oscuro 100% legible sobre cualquier foto.
 * Si la imagen no carga, la capa no se pinta y queda el fondo liso.
 */
function Backdrop({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-white/[0.6]" />
    </div>
  );
}

export function ClientLanding() {
  const { status, profile } = useAuth();
  const navigate = useNavigate();
  const { hash } = useLocation();

  const [departments, setDepartments] = useState<Department[]>([]);

  const authenticated = status === 'authenticated' && profile !== null;

  // La portada es la unica pagina con snap tipo libro. Ademas se mide
  // si TODAS las secciones caben en la ventana: solo entonces se pasa
  // a `mandatory` (enganche fuerte). Si alguna se pasa, se queda en
  // `proximity` y el scroll nunca queda atrapado.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.snap = 'on';

    const applyFit = () => {
      const pages = Array.from(document.querySelectorAll<HTMLElement>('.snap-page'));
      const fits =
        pages.length > 0 && pages.every((page) => page.scrollHeight <= window.innerHeight + 2);
      root.dataset.snapFit = fits ? 'yes' : 'no';
    };

    applyFit();
    // Fuentes e imagenes pueden cambiar la altura de las secciones.
    const delayed = window.setTimeout(applyFit, 500);
    window.addEventListener('resize', applyFit);
    if (document.fonts) void document.fonts.ready.then(applyFit);

    return () => {
      window.clearTimeout(delayed);
      window.removeEventListener('resize', applyFit);
      delete root.dataset.snap;
      delete root.dataset.snapFit;
    };
  }, []);

  // Enlaces con #seccion: al llegar desde otra pagina hay que hacer el
  // desplazamiento a mano, porque el router no scrollea solo.
  useEffect(() => {
    const id = hash ? decodeURIComponent(hash.replace('#', '')) : '';
    if (!id) {
      window.scrollTo({ top: 0 });
      return;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [hash]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const depts = await api<{ data: Department[] }>('/api/departments');
        if (!cancelled) setDepartments(depts.data);
      } catch {
        // La portada no depende de la API: si falla, se muestran los
        // departamentos de referencia.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Bajar a una seccion de la misma pagina dejando el hash en la URL. */
  const scrollTo = (id: string) => {
    window.history.replaceState(null, '', `/cliente#${id}`);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const departmentNames =
    departments.length > 0 ? departments.map((d) => d.name) : FALLBACK_DEPARTMENTS;

  return (
    <ClientShell>
      {/* ── 1. Hero ─────────────────────────────────────────── */}
      <section
        id="inicio"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible bg-slate-950"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(60% 55% at 15% 15%, rgba(99,102,241,0.45), transparent 70%), radial-gradient(55% 45% at 85% 85%, rgba(14,165,233,0.30), transparent 70%)',
          }}
        />

        <div className="relative mx-auto grid w-full max-w-7xl gap-10 px-5 py-20 sm:py-24 lg:grid-cols-2 lg:items-center lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-semibold text-indigo-200">
              <MapPin className="h-4 w-4" />
              Cobertura nacional · Nicaragua
            </span>

            <h1 className="mt-5 text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
              Envía tus paquetes y síguelos
              <span className="block text-indigo-300">en tiempo real</span>
            </h1>

            <p className="mt-5 max-w-xl text-base text-slate-200 sm:text-lg">
              <strong className="text-white">Hossana S.A.</strong> recibe, registra, organiza, transporta y entrega tus paquetes en todo el
              país. Con tu cuenta consultas el estado de cada envío en segundos, sin llamadas
              ni filas.
            </p>

            <ul className="mt-6 grid gap-2.5 text-sm text-slate-200 sm:grid-cols-2">
              {[
                'Rastreo con código de seguimiento',
                'Estado pendiente, en tránsito y entregado',
                'Atención a personas y empresas',
                'Entrega verificada con código',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                  <span className="font-medium">{item}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-white px-6 py-5 text-base text-slate-900 hover:bg-indigo-50"
                onClick={() => scrollTo('servicios')}
              >
                Ver servicios
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-white/40 bg-transparent px-6 py-5 text-base text-white hover:bg-white/10 hover:text-white"
                onClick={() => scrollTo('adquirir')}
              >
                Quiero enviar un paquete
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="h-[20rem] w-full overflow-hidden rounded-3xl ring-2 ring-white/20 sm:h-[24rem] lg:h-[28rem]">
              <video
                src="/videos/hero.mp4"
                autoPlay
                muted
                loop
                playsInline
                className="h-full w-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLVideoElement;
                  target.style.display = 'none';
                  target.parentElement?.querySelector('.hero-fallback')?.classList.remove('hidden');
                }}
              />
              <Photo
                src="/images/hero-panel.jpg"
                alt="Servicio de envíos Hossana"
                icon={PackageCheck}
                className="hero-fallback hidden h-full w-full"
              />
            </div>
            <div className="absolute -bottom-6 left-6 right-6 flex items-center gap-4 rounded-2xl border border-white/20 bg-slate-950/90 px-6 py-4 shadow-2xl backdrop-blur sm:left-8 sm:right-auto sm:max-w-sm">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
                <ShieldCheck className="h-6 w-6 text-emerald-400" />
              </span>
              <p className="text-sm leading-snug text-slate-100">
                <strong className="block text-lg text-white">Entrega verificada</strong>
                El receptor confirma la recepción con un código de 6 dígitos.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Servicios (lo principal) ─────────────────────── */}
      <section
        id="servicios"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible bg-white"
      >
        <Backdrop src="/images/08fbdc01-3e09-4176-bc5d-deeeabd6352a.png?v=1" />

        <div className="relative mx-auto w-full max-w-7xl px-5 py-14 sm:py-16 lg:py-20">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-widest text-indigo-600">
              Qué hacemos
            </p>
            <h2 className="mt-3 bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl lg:text-5xl">
              Nuestros servicios
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800 sm:text-lg">
              Courier y paquetería para personas y empresas: productos, documentos y
              encomiendas, con <strong className="text-indigo-700">cobertura nacional</strong> y
              seguimiento de cada etapa del envío.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Mailbox,
                title: 'Encomiendas',
                text: 'Paquetes de todo tipo, registrados y resguardados en cada etapa.',
                tone: 'bg-indigo-100 text-indigo-700',
                accent: 'text-indigo-700',
              },
              {
                icon: FileText,
                title: 'Documentos',
                text: 'Envíos legales y corporativos con entrega al destinatario indicado.',
                tone: 'bg-emerald-100 text-emerald-700',
                accent: 'text-emerald-700',
              },
              {
                icon: Truck,
                title: 'Paquetería y courier',
                text: 'Transporte nacional entre los departamentos cubiertos.',
                tone: 'bg-amber-100 text-amber-700',
                accent: 'text-amber-700',
              },
              {
                icon: Building2,
                title: 'Empresas',
                text: 'Atención a negocios con envíos frecuentes y seguimiento centralizado.',
                tone: 'bg-sky-100 text-sky-700',
                accent: 'text-sky-700',
              },
            ].map((service) => (
              <Card key={service.title} className="border-slate-200 transition hover:-translate-y-1 hover:shadow-xl">
                <CardContent className="pt-6">
                  <span
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${service.tone}`}
                  >
                    <service.icon className="h-5 w-5" />
                  </span>
                  <p className={`mt-4 text-base font-bold ${service.accent}`}>{service.title}</p>
                  <p className="mt-1.5 text-sm font-semibold leading-relaxed text-slate-700">{service.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-6 rounded-3xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50 to-sky-50 p-6 shadow-lg">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-xl font-bold text-indigo-900">
                  ¿Necesitas contactar con nosotros?
                </h3>
                <p className="mt-1.5 text-base text-slate-700">
                  Estamos listos para ayudarte con tu envío o cualquier consulta
                </p>
              </div>
              <Button
                size="lg"
                className="bg-indigo-600 px-6 py-5 text-base hover:bg-indigo-700"
                onClick={() => scrollTo('cobertura')}
              >
                <Phone className="h-5 w-5" />
                Contáctanos
              </Button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-700">
                ¿Qué puedes hacer con tu cuenta?
              </h3>
              <ul className="mt-3 grid gap-2 text-sm text-slate-700">
                {[
                  'Consultar el estado de tus paquetes',
                  'Ver cuáles están pendientes, en tránsito o entregados',
                  'Rastrear con el código de seguimiento',
                  'Registrar nuevos envíos en minutos',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-900">
                Cómo cuidamos tu envío
              </h3>
              <ul className="mt-3 grid gap-2 text-sm text-slate-700">
                {[
                  'Código único de seguimiento desde el primer momento',
                  'Historial de cada movimiento con fecha y hora',
                  'Entrega solo con firma, foto o código del receptor',
                  'Avisos por correo y WhatsApp en cada etapa',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Cómo funciona ────────────────────────────────── */}
      <section
        id="proceso"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible border-y border-slate-200 bg-slate-50"
      >
        <Backdrop src="/images/08fbdc01-3e09-4176-bc5d-deeeabd6352a.png?v=1" />

        <div className="relative mx-auto w-full max-w-7xl px-5 py-12 sm:py-14 lg:py-18">
          <div className="max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-widest text-sky-600">
              Del origen al destino
            </p>
            <h2 className="mt-3 bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl lg:text-5xl">
              Así viaja tu paquete
            </h2>
            <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800 sm:text-lg">
              Un solo vistazo: origen → Almacén/Sucursal → En camino → Entregado. Cada movimiento queda registrado con{' '}
              <strong className="text-indigo-700">fecha, hora y responsable</strong>.
            </p>
          </div>

          <div className="relative mt-10">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-0 right-0 top-12 hidden h-1 bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 lg:block"
            />
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: PackageCheck,
                  title: 'Recibimos',
                  text: 'Tu paquete entra al sistema con un código único y se registra en nuestra sucursal.',
                  color: 'bg-indigo-600',
                },
                {
                  icon: Building2,
                  title: 'Organizamos',
                  text: 'Clasificamos, verificamos y resguardamos en nuestros centros de distribución.',
                  color: 'bg-sky-600',
                },
                {
                  icon: Truck,
                  title: 'Transportamos',
                  text: 'Asignamos ruta con repartidor y seguimiento en tiempo real de cada hito.',
                  color: 'bg-amber-600',
                },
                {
                  icon: Mailbox,
                  title: 'Entregamos',
                  text: 'Entrega verificada en el destino con código/firma, a nivel nacional.',
                  color: 'bg-emerald-600',
                },
              ].map((step, index) => (
                <div key={step.title} className="relative">
                  <div className="relative z-10 flex items-center gap-4">
                    <span className={`flex h-20 w-20 items-center justify-center rounded-full ${step.color} shadow-xl`}>
                      <step.icon className="h-10 w-10 text-white" />
                    </span>
                    <span className="rounded-full bg-white px-3.5 py-1.5 text-base font-bold text-slate-900 shadow-lg">
                      0{index + 1}
                    </span>
                  </div>
                  <div className="mt-4 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-lg">
                    <p className="text-lg font-bold text-slate-900">{step.title}</p>
                    <p className="mt-1.5 text-sm font-semibold leading-relaxed text-slate-800">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3 rounded-2xl border border-indigo-100 bg-white px-4 py-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-600" />
            <p className="text-sm text-slate-700">
              <strong className="text-slate-900">Entrega protegida:</strong> el receptor
              presenta un código de 6 dígitos enviado a su teléfono, o firma y foto en el
              lugar. Sin prueba, el envío queda marcado como <em>por verificar</em>.
            </p>
          </div>
        </div>
      </section>

      {/* ── 4. Cobertura con mapa ───────────────────────────── */}
      <section
        id="cobertura"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible bg-white"
      >
        <Backdrop src="/images/08fbdc01-3e09-4176-bc5d-deeeabd6352a.png?v=1" />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:py-12 lg:py-14">
          <div className="flex flex-col gap-8">
            <div className="mx-auto max-w-4xl text-center">
              <p className="text-sm font-bold uppercase tracking-widest text-emerald-600 sm:text-base">
                Dónde estamos
              </p>
              <h2 className="mt-2 bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl">
                Cobertura nacional
              </h2>
              <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-800 sm:text-base">
                Operamos entre los departamentos de Nicaragua con tarifas por{' '}
                <strong className="text-emerald-700">origen, destino y peso</strong>.
                Atendemos personas y empresas, y si tu destino está en otra zona,{' '}
                <strong className="text-indigo-700">escríbenos</strong> y te confirmamos la
                disponibilidad.
              </p>

              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {departmentNames.map((name) => (
                  <span
                    key={name}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    <MapPin className="h-3 w-3 text-indigo-500" />
                    {name}
                  </span>
                ))}
              </div>

              <div className="mt-6" />
            </div>

            <div>
              <div className="overflow-hidden rounded-3xl border border-slate-200 shadow-lg">
                <iframe
                  title="Ubicación de la sucursal de Managua (Transportes Hossana)"
                  src={MAP_EMBED}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  className="h-[18rem] w-full border-0 sm:h-[22rem] lg:h-[26rem] xl:h-[28rem]"
                />
              </div>
              <p className="mt-4 flex items-start justify-center gap-2 text-sm text-slate-600">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
                <span className="text-center">
                  <strong className="text-slate-700">Sucursal Managua:</strong>{' '}
                  {CONTACT.address}
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 5. Quiénes somos (una sola pantalla) ────────────── */}
      <section
        id="nosotros"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible border-y border-slate-200 bg-slate-50"
      >
        <Backdrop src="/images/08fbdc01-3e09-4176-bc5d-deeeabd6352a.png?v=1" />

        <div className="relative mx-auto w-full max-w-6xl px-5 py-12 text-center sm:py-14 lg:py-18">
          <p className="text-sm font-bold uppercase tracking-widest text-amber-700">
            Quiénes somos
          </p>
          <h2 className="mt-3 bg-gradient-to-r from-indigo-700 via-indigo-600 to-sky-600 bg-clip-text text-3xl font-extrabold text-transparent sm:text-4xl lg:text-5xl">
            Hossana S.A.
          </h2>
          <p className="mx-auto mt-4 max-w-4xl text-base font-semibold leading-relaxed text-slate-800 sm:text-lg">
            <strong className="text-indigo-700">Empresa nicaragüense</strong> dedicada al
            envío y distribución de paquetes a nivel nacional. Recibimos, registramos, organizamos,
            transportamos y entregamos encomiendas, documentos y productos, con atención tanto a
            personas como a empresas.
          </p>

          <div className="mx-auto mt-8 grid max-w-5xl gap-5 text-left lg:grid-cols-2">
            <Card className="border-2 border-indigo-200 shadow-xl">
              <CardContent className="p-6">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100">
                  <ShieldCheck className="h-7 w-7 text-indigo-700" />
                </span>
                <h3 className="mt-4 text-xl font-bold uppercase tracking-wide text-slate-900">
                  Misión
                </h3>
                <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800">
                  Brindar un servicio de envío nacional seguro, eficiente y confiable,
                  garantizando la satisfacción de nuestros clientes con responsabilidad
                  en cada entrega. Nos comprometemos a mantener la integridad de cada paquete
                  y a ofrecer un servicio ágil, transparente y accesible para todas las personas
                  y empresas que confían en nosotros.
                </p>
              </CardContent>
            </Card>

            <Card className="border-2 border-amber-200 shadow-xl">
              <CardContent className="p-6">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100">
                  <Truck className="h-7 w-7 text-amber-700" />
                </span>
                <h3 className="mt-4 text-xl font-bold uppercase tracking-wide text-slate-900">
                  Visión
                </h3>
                <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800">
                  Ser la empresa líder de courier y paquetería en Nicaragua, reconocida por
                  su seguridad, eficiencia, calidad en el servicio y compromiso con cada cliente.
                  Aspiramos a expandir y fortalecer nuestra cobertura nacional, innovando en
                  tecnología de rastreo y garantizando siempre una experiencia confiable en
                  cada envío.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* ── 6. Adquirir el servicio (único punto de conversión) ── */}
      <section
        id="adquirir"
        className="snap-page relative flex min-h-[100svh] items-center overflow-visible bg-slate-950"
      >
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-700 via-indigo-800 to-slate-950" />
        <div className="relative mx-auto w-full max-w-3xl px-4 py-14 text-center sm:py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-indigo-200">
            <PackageSearch className="h-3.5 w-3.5" />
            ¿Listo para enviar?
          </span>
          <h2 className="mt-5 text-3xl font-bold text-white sm:text-4xl">
            ¿Quieres adquirir el servicio?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-indigo-100 sm:text-base">
            Crea tu cuenta con tu correo electrónico: te enviaremos un código de verificación
            para confirmar que es tuyo. En cuanto entres puedes registrar tu primer envío y
            ver su recorrido paso a paso.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {authenticated ? (
              <Button
                size="lg"
                className="bg-white text-slate-900 hover:bg-indigo-50"
                onClick={() => navigate('/')}
              >
                <PackageSearch className="h-4 w-4" />
                Ir a mi panel
              </Button>
            ) : (
              <>
                <Button
                  size="lg"
                  className="bg-white text-slate-900 hover:bg-indigo-50"
                  onClick={() => navigate('/cliente/login')}
                >
                  ¿Quieres adquirir nuestros servicios?
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  onClick={() => navigate('/cliente/registro')}
                >
                  Crear una cuenta
                </Button>
              </>
            )}
          </div>

          <p className="mt-6 text-sm text-indigo-200">
            ¿Solo quieres ver dónde está un paquete?{' '}
            <button
              type="button"
              className="underline underline-offset-4 hover:text-white"
              onClick={() => navigate('/rastreo')}
            >
              Rastrea sin crear cuenta
            </button>
          </p>
        </div>
      </section>
    </ClientShell>
  );
}
