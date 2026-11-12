import type { StatusTone } from '../../lib/types';
import { formatDateTime } from '../../lib/utils';
import { statusIconOf, toneFill } from './status';

/**
 * LINEA DE TIEMPO
 *
 * Dibuja los hitos de un envío en orden cronológico. Cada hito trae
 * `statusLabel`, `statusIcon`, `statusTone`, `title`, `description`,
 * `locationName`, `occurredAt` y opcionalmente `operatorName`.
 *
 * El orden y el merge con los eventos en vivo los decide la pantalla
 * que lo usa; este componente solo pinta.
 */

const SOURCE_LABELS: Record<string, string> = {
  SYSTEM: 'Sistema',
  MANUAL: 'Actualización manual',
  SCAN: 'Escaneo',
  COURIER_API: 'Transporte',
  WEBHOOK: 'Transporte',
};

export interface TimelineItemInput {
  id?: string;
  sequence?: number;
  statusLabel: string;
  statusIcon?: string | null;
  statusTone?: StatusTone | string | null;
  title: string;
  description?: string | null;
  locationName?: string | null;
  occurredAt?: string | null;
  operatorName?: string | null;
  source?: string | null;
  sourceLabel?: string | null;
}

function Tail({ isLast }: { isLast: boolean }) {
  if (isLast) return null;
  return <span aria-hidden className="absolute left-[15px] top-8 bottom-[-8px] w-px bg-slate-200" />;
}

export function Timeline({
  items,
  caption,
}: {
  items: TimelineItemInput[];
  caption?: string;
}) {
  return (
    <div>
      {caption ? <h3 className="mb-4 text-sm font-semibold text-slate-900">{caption}</h3> : null}
      <ol className="space-y-5">
        {[...items].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0)).map((item, index, arr) => {
          const Icon = statusIconOf(item.statusIcon);
          return (
            <li key={item.id ?? `${item.sequence ?? index}-${item.occurredAt ?? ''}`} className="relative pl-11">
              <span
                className={`absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full ring-4 ring-white ${toneFill(item.statusTone)}`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <Tail isLast={index === arr.length - 1} />
              <div className="pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <p className="text-sm font-medium text-slate-900">{item.statusLabel}</p>
                  <span className="text-xs text-slate-400">
                    {formatDateTime(item.occurredAt)}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-sm text-slate-500">{item.description}</p>
                ) : null}
                {(item.locationName || item.operatorName || item.source) ? (
                  <p className="mt-0.5 text-xs text-slate-400">
                    {[item.locationName, item.operatorName ? `Operó: ${item.operatorName}` : null, item.sourceLabel ?? SOURCE_LABELS[item.source ?? ''] ?? null]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}