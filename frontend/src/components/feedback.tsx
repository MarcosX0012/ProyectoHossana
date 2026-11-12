import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

/**
 * Avisos en línea (éxito / error / información).
 *
 * Cada pantalla guarda un `notice` en estado y lo renderiza aquí:
 * es la forma más simple de dar feedback tras una acción sin montar
 * un sistema de toasts.
 */

export type NoticeKind = 'success' | 'error' | 'info';

export interface Notice {
  kind: NoticeKind;
  message: string;
}

const STYLES: Record<NoticeKind, { wrapper: string; Icon: typeof Info }> = {
  success: {
    wrapper: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Icon: CheckCircle2,
  },
  error: {
    wrapper: 'border-rose-200 bg-rose-50 text-rose-800',
    Icon: XCircle,
  },
  info: {
    wrapper: 'border-slate-200 bg-slate-100 text-slate-700',
    Icon: Info,
  },
};

export function Alert({ notice, className }: { notice: Notice; className?: string }) {
  const { wrapper, Icon } = STYLES[notice.kind];
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', wrapper, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{notice.message}</span>
    </div>
  );
}

/** Spinner centrado para cargas de página completa. */
export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      {label}
    </div>
  );
}

/** Estado vacío / error con un botón de reintento. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-12 text-center">
      <AlertTriangle className="mb-1 h-6 w-6 text-slate-400" />
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {description ? <p className="max-w-md text-sm text-slate-500">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
