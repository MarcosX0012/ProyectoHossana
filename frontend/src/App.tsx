import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequireRole } from './components/guards';
import { AuthProvider } from './lib/auth';
import { useAuth } from './lib/auth';
import { Account } from './pages/Account';
import { ClientCompleteRegistration } from './pages/ClientCompleteRegistration';
import { ClientLanding } from './pages/ClientLanding';
import { ClientLogin } from './pages/ClientLogin';
import { ClientRegister } from './pages/ClientRegister';
import { ClientVerifyEmail } from './pages/ClientVerifyEmail';
import { CourierConsole } from './pages/CourierConsole';
import { CreateShipmentWizard } from './pages/CreateShipmentWizard';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { NotificationsPage } from './pages/NotificationsPage';
import { PublicTrack } from './pages/PublicTrack';
import { ShipmentDetailPage } from './pages/ShipmentDetailPage';
import { ShipmentsList } from './pages/ShipmentsList';
import { Tarifas } from './pages/Tarifas';
import { Users } from './pages/Users';
import { Webhooks } from './pages/Webhooks';
import { Repartidores } from './pages/admin/Repartidores';
import { RepartidorDetalle } from './pages/admin/RepartidorDetalle';
import { RutaRepartidor } from './pages/admin/RutaRepartidor';
import { RutaDelDia } from './pages/repartidor/RutaDelDia';
import { Pagos } from './pages/admin/Pagos';

/**
 * Mapa de rutas:
 *
 *   Portal del cliente (pÃºblico):
 *     /cliente                      â†’ portada informativa
 *     /cliente/login                â†’ inicio de sesiÃ³n de clientes
 *     /cliente/registro             â†’ alta en 3 pasos (correo â†’ OTP â†’ datos)
 *     /cliente/registro/verificar   â†’ cÃ³digo enviado al correo
 *     /cliente/registro/completar   â†’ perfil y contraseÃ±a
 *     /tarifas                      â†’ tarifario pÃºblico
 *
 *   PÃºblico general:
 *     /login, /rastreo/:code, /track/:code
 *
 *   Panel interno (RequireAuth):
 *     /                â†’ redirige segÃºn el rol
 *     /dashboard       â†’ Dashboard
 *     /envios          â†’ Lista de envÃ­os (todos los roles)
 *     /envios/nuevo    â†’ (SENDER/OPERATOR/ADMIN) Crear envÃ­o
 *     /envios/:code    â†’ Detalle del envÃ­o
 *     /tarifas         â†’ Tarifario pÃºblico (tambiÃ©n enlazado desde el panel)
 *     /reparto         â†’ (COURIER/OPERATOR/ADMIN) Consola
 *     /notificaciones  â†’ Avisos
 *     /usuarios        â†’ (ADMIN) Usuarios
 *     /repartidores    â†’ (OPERATOR/ADMIN) Repartidores y disponibilidad
 *     /webhooks        â†’ (OPERATOR/ADMIN) Webhooks
 *     /cuenta          â†’ Mi cuenta
 */
export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/rastreo" element={<PublicTrack />} />
          <Route path="/rastreo/:code" element={<PublicTrack />} />
          <Route path="/track/:code" element={<PublicTrack />} />

          {/* Portal pÃºblico del cliente */}
          <Route path="/cliente" element={<ClientLanding />} />
          <Route path="/cliente/login" element={<ClientLogin />} />
          <Route path="/cliente/registro" element={<ClientRegister />} />
          <Route path="/cliente/registro/verificar" element={<ClientVerifyEmail />} />
          <Route path="/cliente/registro/completar" element={<ClientCompleteRegistration />} />
          <Route path="/tarifas" element={<Tarifas />} />

          <Route element={<RequireAuth />}>
            <Route element={<Layout />}>
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="envios" element={<ShipmentsList />} />
              <Route
                path="envios/nuevo"
                element={
                  <RequireRole roles={['SENDER', 'OPERATOR', 'ADMIN']}>
                    <CreateShipmentWizard />
                  </RequireRole>
                }
              />
              <Route path="envios/:code" element={<ShipmentDetailPage />} />
              <Route
                path="reparto"
                element={
                  <RequireRole roles={['COURIER', 'OPERATOR', 'ADMIN']}>
                    <CourierConsole />
                  </RequireRole>
                }
              />
              <Route path="notificaciones" element={<NotificationsPage />} />
              <Route
                path="usuarios"
                element={
                  <RequireRole roles={['ADMIN']}>
                    <Users />
                  </RequireRole>
                }
              />
              <Route
                path="pagos"
                element={
                  <RequireRole roles={['ADMIN']}>
                    <Pagos />
                  </RequireRole>
                }
              />
              <Route
                path="repartidores"
                element={
                  <RequireRole roles={['ADMIN', 'OPERATOR']}>
                    <Repartidores />
                  </RequireRole>
                }
              />
              <Route
                path="repartidores/:id"
                element={
                  <RequireRole roles={['ADMIN', 'OPERATOR']}>
                    <RepartidorDetalle />
                  </RequireRole>
                }
              />
              <Route
                path="repartidores/:id/ruta"
                element={
                  <RequireRole roles={['ADMIN', 'OPERATOR']}>
                    <RutaRepartidor />
                  </RequireRole>
                }
              />
              <Route
                path="mi-ruta"
                element={
                  <RequireRole roles={['COURIER']}>
                    <RutaDelDia />
                  </RequireRole>
                }
              />
              <Route
                path="webhooks"
                element={
                  <RequireRole roles={['OPERATOR', 'ADMIN']}>
                    <Webhooks />
                  </RequireRole>
                }
              />
              <Route path="cuenta" element={<Account />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

/** Tras el login, cada rol cae directo a su pantalla natural. */
function HomeRedirect() {
  const { profile } = useAuth();
  if (profile?.roles.includes('ADMIN')) return <Navigate to="/usuarios" replace />;
  if (profile?.roles.includes('COURIER')) return <Navigate to="/reparto" replace />;
  return <Navigate to="/envios" replace />;
}
