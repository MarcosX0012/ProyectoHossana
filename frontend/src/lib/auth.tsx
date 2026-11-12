import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  ApiRequestError,
  clearTokens,
  logoutRequest,
  setAccessToken,
  setRefreshToken,
} from './api';
import type { Profile, PublicUser } from './types';

/**
 * CONTEXTO DE AUTENTICACION
 *
 * Un solo lugar que sabe:
 *   - si estamos cargando / autenticados / sin sesion,
 *   - quien es el usuario y que permisos tiene (`GET /api/users/me`),
 *   - como iniciar y cerrar sesion.
 *
 * Al arrancar la app siempre se intenta `GET /api/users/me`: si habia
 * un access token valido se usa; si no, el cliente HTTP intenta
 * renovarlo con la cookie. Eso permite recargar la pagina sin perder
 * la sesion.
 */

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  profile: Profile | null;
  login: (identifier: string, password: string) => Promise<Profile>;
  /**
   * Adopta una sesión ya emitida por el backend (p. ej. el registro de
   * clientes, que devuelve tokens tras crear la cuenta) y carga el
   * perfil. Evita pedir el login otra vez al terminar de registrarse.
   */
  establishSession: (accessToken: string, refreshToken?: string | null) => Promise<Profile | null>;
  /**
   * Cierra la sesión. `remote = false` solo limpia lo local: se usa
   * cuando el backend ya revocó las sesiones (cambio de contraseña o
   * "cerrar todas las sesiones"), para no reenviar un token muerto.
   */
  logout: (remote?: boolean) => Promise<void>;
  reloadProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);

  const reloadProfile = useCallback(async (): Promise<Profile | null> => {
    try {
      const response = await api<{ data: Profile }>('/api/users/me');
      setProfile(response.data);
      setStatus('authenticated');
      return response.data;
    } catch {
      setProfile(null);
      setStatus('anonymous');
      return null;
    }
  }, []);

  useEffect(() => {
    void reloadProfile();
  }, [reloadProfile]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<Profile> => {
      const session = await api<{ accessToken: string; refreshToken?: string; user: PublicUser }>(
        '/api/auth/login',
        { method: 'POST', json: { identifier, password } },
      );

      setAccessToken(session.accessToken);
      if (session.refreshToken) setRefreshToken(session.refreshToken);

      const loaded = await reloadProfile();
      if (!loaded) {
        throw new ApiRequestError('La sesion no pudo completarse', 500, 'SESSION_FAILED');
      }
      return loaded;
    },
    [reloadProfile],
  );

  const logout = useCallback(async (remote = true): Promise<void> => {
    if (remote) await logoutRequest();
    else clearTokens();
    setProfile(null);
    setStatus('anonymous');
  }, []);

  const establishSession = useCallback(
    async (accessToken: string, refreshToken?: string | null): Promise<Profile | null> => {
      setAccessToken(accessToken);
      if (refreshToken) setRefreshToken(refreshToken);
      return reloadProfile();
    },
    [reloadProfile],
  );

  const value = useMemo(
    () => ({ status, profile, login, establishSession, logout, reloadProfile }),
    [status, profile, login, establishSession, logout, reloadProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
