import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Hook minimo para GET: `const {data, loading, error, reload} = useApi<MiTipo>('/api/...')`.
 *
 * - Cambia la `path` (p. ej. al escribir un filtro) y vuelve a pedir.
 * - `reload()` fuerza otra carga (p. ej. tras guardar un cambio).
 * - `path = null` desactiva la carga (para esperar a que existan los
 *   parametros, como el `page` de una tabla paginada).
 */
export function useApi<T>(path: string | null): UseApiState<T> & { reload: () => void } {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: path !== null,
    error: null,
  });
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    // Limpiar datos previos antes de iniciar la nueva peticion:
    // evita que datos de una ruta anterior se filtren si la peticion
    // tarda demasiado o el usuario navega rapido.
    setState({ data: null, loading: true, error: null });

    let active = true;
    api<T>(path)
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Error inesperado',
          });
        }
      });

    return () => {
      active = false;
    };
  }, [path, reloadKey]);

  return { ...state, reload };
}
