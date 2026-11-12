
import { Component, type ReactNode } from 'react';
import { Button } from './ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorInfo: string | null;
}

class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);

    this.state = {
      hasError: false,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(
    _error: Error
  ): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: Error) {
    this.setState({
      errorInfo: error.message,
    });

    console.error('Error en HOSSANA:', error);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-4">
            Ocurrió un error inesperado
          </h2>

          <p className="text-slate-600 mb-6 text-center">
            Se produjo un problema al mostrar esta página.
          </p>

          {this.state.errorInfo && (
            <p className="text-sm text-red-600 mb-6">
              {this.state.errorInfo}
            </p>
          )}

          <Button
            size="md"
            onClick={() => window.location.reload()}
          >
            Reintentar
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}

export { ErrorBoundary };
