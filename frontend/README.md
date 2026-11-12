# Hossana · Panel de administración (frontend)

Interfaz web del sistema **Hossana** para el rol **Administrador**:
gestión de usuarios y roles, bandeja de webhooks y métricas del panel.

## Stack

- **React 18 + TypeScript + Vite 6**
- **Tailwind CSS** con componentes **shadcn/ui** (`src/components/ui/`)
- **React Router 6** para las rutas
- Sin librerías de estado pesadas: un cliente `fetch` propio con
  renovación automática de sesión (`src/lib/api.ts`)

## Requisitos

- El backend corriendo en `http://localhost:3000`
  (ver raíz del repo: `npm run db:start`, `prisma:migrate`,
  `db:seed`, `npm run dev`).
- Node 20+

## Puesta en marcha

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. El proxy de Vite (ver `vite.config.ts`)
reenvía `/api` y `/ws` al backend, de modo que no hay CORS ni
problemas de cookies en desarrollo.

### Cuenta de prueba (seed)

```
admin@demo.hossana.local
Demo1234!
```

## Arquitectura

```
src/
├─ lib/
│  ├─ api.ts      → cliente HTTP: Bearer token, renova con /api/auth/refresh
│  │                y reintenta en 401; traduce errores del backend.
│  ├─ auth.tsx    → contexto de sesión (quién soy, permisos, login/logout)
│  ├─ useApi.ts   → hook para cargar un GET con loading/error/reload
│  ├─ types.ts    → contratos de la API (PublicUser, WebhookInboxItem…)
│  └─ utils.ts    → cn(), formato de fechas, fullName()
├─ components/
│  ├─ ui/         → button, badge, input, card, table, dialog (shadcn)
│  ├─ Layout.tsx  → sidebar + barra superior + <Outlet/>
│  ├─ RequireAdmin.tsx → guardia que exige sesión y canAdminister
│  ├─ badges.tsx  → etiquetas traducidas (roles, estados, envíos)
│  └─ feedback.tsx → Alert, Loading, EmptyState
└─ pages/
   ├─ Login.tsx     → POST /api/auth/login
   ├─ Dashboard.tsx → GET /api/shipments/metrics
   ├─ Users.tsx     → GET /api/auth/users + POST /api/auth/users/roles
   ├─ Webhooks.tsx  → GET /api/webhooks/courier/inbox (+reprocess, providers)
   └─ Account.tsx   → PATCH /me, change-password, DELETE /me/sessions
```

## Cómo funciona la sesión

1. `POST /api/auth/login` devuelve `accessToken` (15 min) y fija la
   cookie httpOnly `hossana_rt` (refresh, 30 días).
2. Cada petición envía `Authorization: Bearer <accessToken>`.
3. Si el backend responde **401**, `api.ts` llama a
   `POST /api/auth/refresh` (la cookie viaja sola) y reintenta la
   petición **una vez**. Varias peticiones simultáneas comparten una
   sola renovación.
4. **Respaldo**: también se guarda el refresh token en `localStorage`
   y se envía en el cuerpo si el navegador descartó la cookie.
   (El backend devuelve el token en el cuerpo para clientes no
   navegador; la cookie es el camino preferido.)

Los permisos no se calculan en el frontend: `GET /api/users/me`
devuelve `permissions.canAdminister`, y `RequireAdmin` decide.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con hot-reload |
| `npm run build` | Typecheck + build de producción en `dist/` |
| `npm run typecheck` | Solo comprueba tipos |
| `npm run preview` | Sirve el `dist/` localmente |

## Notas

- La pantalla de webhooks **no crea** eventos: los webhooks llegan de
  transportistas. Solo inspecciona y reprocesa.
- La seguridad real está en el backend (todos los endpoints validan
  roles); este panel es solo la cara visible.