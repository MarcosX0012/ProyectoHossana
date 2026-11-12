/**
 * Indicador de pasos del registro de clientes (correo → código → datos).
 * El paso activo se marca en índigo y los completados en verde.
 */
export function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Correo', 'Código', 'Tus datos'];
  return (
    <ol className="mb-6 flex items-center justify-center gap-2 text-xs">
      {steps.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const active = step === current;
        const done = step < current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={
                'flex h-6 w-6 items-center justify-center rounded-full font-semibold ' +
                (active
                  ? 'bg-indigo-600 text-white'
                  : done
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-500')
              }
            >
              {step}
            </span>
            <span className={active ? 'font-medium text-slate-900' : 'text-slate-500'}>{label}</span>
            {index < steps.length - 1 ? <span className="mx-1 h-px w-6 bg-slate-300" /> : null}
          </li>
        );
      })}
    </ol>
  );
}