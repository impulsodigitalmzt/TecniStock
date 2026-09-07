import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    console.error("TecniStock UI:", error.message);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <AlertTriangle className="mb-4 h-12 w-12 text-amber-500" />
            <h2 className="mb-2 text-lg font-semibold text-stone-800">Algo salió mal</h2>
            <p className="mb-4 max-w-md text-sm text-stone-500">
              Ocurrió un error inesperado. Recarga la página e inténtalo de nuevo.
            </p>
            <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
              Recargar
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
