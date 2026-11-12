import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** Etiqueta de color para roles, estados de usuario, etc. */

export type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'muted';

const VARIANTS: Record<BadgeVariant, string> = {
  default: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  muted: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
