import { Component, ReactNode, useState } from 'react';

/**
 * Componente que captura errores JavaScript no tratados en su subcampo
 * y muestra una pantalla amigable en vez de una pantalla en blanco o
 * errores de consola. Se usa envolviendo todo el árbol de rutas.
 *
 * Decisión de diseño:
 * - Al capturar un error, la app muestra un estado "algo falló" con
 *   un botón para volver al inicio. No se intenta recuperar la
 *   petición fallida; el usuario puede navegar de nuevo.
 * - `info` se guarda en state para mostrar un mensaje genérico; no se
 *   filtran datos sensibles del error (el stack se oculta del usuario).
 */
class ErrorBoundary extends Component<{
  children: ReactNode;
  fallback?: ReactNode;
}> {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Actualiza state para que el componente vuelva a renderizar.
    return { hasError: true, errorInfo: { error } };
  }

  render() {
    if (this.state.hasError) {
      // Mostramos una UI de error en lugar del árbol de hijos.
      return this.state.errorInfo ? (
        <div className="min-h-screen bg-slate-100 p-8 flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Ocurrió un error</h2>
          <p className="text-slate-600 mb-8">Algo inesperado ocurrió en la aplicación.</p>
          <Button size="md" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      ) : (
        null
      );
    }
    return this.props.children;
  }
}

export { ErrorBoundary };

/** Variante funcional que acepte un `fallback` opcional. */
function useErrorBoundaryFallback(fallback: ReactNode | undefined) {
  const [hasError, setHasError] = useState(false);

  // No es un hook real; solo se usa como referencia de patrones.
  return hasError;
}