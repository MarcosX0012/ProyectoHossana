import { useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { ShipmentDetail, ShipmentStatus, CustodyAction } from '../../lib/types';
import { CUSTODY_ACTIONS } from '../../lib/types';
import { formatDateTime } from '../../lib/utils';
import { Alert, type Notice } from '../feedback';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Input, Select, Textarea } from '../ui/input';
import { Label } from '../ui/label';

/**
 * ACCIONES DE ENVIO POR ROL
 *
 * Cada botón aparece según lo que el backend permite (`requireRole`
 * + máquina de estados). Las decisiones las toma el servidor; aquí
 * solo formulamos la petición y mostramos su resultado.
 */

// Espejo de `ALLOWED_TRANSITIONS` del backend (máquina de estados).
// El servidor sigue siendo la autoridad; esto solo orienta el select.
const ALLOWED_NEXT: Record<ShipmentStatus, ShipmentStatus[]> = {
  CREATED: ['CONFIRMED', 'AWAITING_PAYMENT', 'CANCELLED'],
  CONFIRMED: ['AWAITING_PAYMENT', 'AWAITING_PICKUP', 'PICKED_UP', 'EXCEPTION', 'ON_HOLD', 'CANCELLED'],
  AWAITING_PAYMENT: ['AWAITING_PICKUP', 'PICKED_UP', 'EXCEPTION', 'ON_HOLD', 'CANCELLED', 'CONFIRMED'],
  AWAITING_PICKUP: ['PICKED_UP', 'ON_HOLD', 'EXCEPTION', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'EXCEPTION', 'ON_HOLD'],
  IN_TRANSIT: ['AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY', 'RETURNING', 'EXCEPTION', 'ON_HOLD'],
  AT_DISTRIBUTION_CENTER: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'RETURNING', 'EXCEPTION', 'ON_HOLD'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'DELIVERY_ATTEMPTED', 'RETURNING', 'EXCEPTION'],
  DELIVERY_ATTEMPTED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNING', 'EXCEPTION', 'ON_HOLD'],
  DELIVERED: [],
  ON_HOLD: ['IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY', 'PICKED_UP', 'EXCEPTION', 'CANCELLED', 'RETURNING'],
  EXCEPTION: ['IN_TRANSIT', 'AT_DISTRIBUTION_CENTER', 'OUT_FOR_DELIVERY', 'RETURNING', 'LOST', 'DELIVERED', 'ON_HOLD'],
  RETURNING: ['RETURNED', 'IN_TRANSIT', 'EXCEPTION'],
  RETURNED: [],
  LOST: [],
  CANCELLED: [],
};

const STATUS_LABELS: Record<string, string> = {
  CREATED: 'Creado',
  CONFIRMED: 'Confirmado',
  AWAITING_PAYMENT: 'Esperando pago',
  AWAITING_PICKUP: 'Esperando recolección',
  PICKED_UP: 'Recogido',
  IN_TRANSIT: 'En tránsito',
  AT_DISTRIBUTION_CENTER: 'En centro de distribución',
  OUT_FOR_DELIVERY: 'En reparto',
  DELIVERED: 'Entregado',
  DELIVERY_ATTEMPTED: 'Intentado sin éxito',
  ON_HOLD: 'En espera',
  EXCEPTION: 'Incidencia',
  RETURNING: 'En devolución',
  RETURNED: 'Devuelto',
  LOST: 'Extraviado',
  CANCELLED: 'Cancelado',
};

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

const CUSTODY_LABELS: Record<CustodyAction, string> = {
  PICKUP: 'Recogida',
  SCAN_IN: 'Ingreso a sede',
  SCAN_OUT: 'Salida de sede',
  HANDOFF: 'Cambio de manos',
  SORT: 'Clasificado',
  LOAD_VEHICLE: 'Carga en vehículo',
  DELIVER: 'Entregado',
  ATTEMPT_DELIVERY: 'Intento de entrega',
  RETURN: 'Devuelto',
};

const DISPATCHABLE = ['CONFIRMED', 'AWAITING_PAYMENT', 'AWAITING_PICKUP'];
const DELIVERY_STATES = ['OUT_FOR_DELIVERY', 'DELIVERY_ATTEMPTED'];
const EDITABLE = ['CREATED', 'CONFIRMED', 'AWAITING_PAYMENT'];
const CANCELLABLE = ['CREATED', 'CONFIRMED', 'AWAITING_PAYMENT', 'AWAITING_PICKUP', 'ON_HOLD'];

export function ShipmentActions({
  code,
  detail,
  onChanged,
}: {
  code: string;
  detail: ShipmentDetail;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const roles = profile?.roles ?? [];

  const isAdmin = roles.includes('ADMIN');
  const isOpAdmin = isAdmin || roles.includes('OPERATOR');
  const isStaff = isOpAdmin || roles.includes('COURIER');
  const isSender = roles.includes('SENDER');

  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const nextStates = ALLOWED_NEXT[detail.status];

  const run = async (
    operation: () => Promise<{ ok: boolean; message: string }>,
    { close = true } = {},
  ) => {
    setBusy(true);
    try {
      const outcome = await operation();
      setNotice({ kind: 'success', message: outcome.message });
      if (close) setActive(null);
      onChanged();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'La operación falló.',
      });
    } finally {
      setBusy(false);
    }
  };

  const cancelClose = () => setActive(null);

  return (
    <div className="flex flex-col gap-3">
      {notice ? <Alert notice={notice} /> : null}

      <div className="flex flex-wrap gap-2">
        {/* ── Operador / repartidor ── */}
        {isStaff && nextStates.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setActive('event')} disabled={busy}>
            Registrar evento
          </Button>
        ) : null}
        {isStaff && (detail.isActive || detail.status === 'ON_HOLD') ? (
          <Button variant="outline" size="sm" onClick={() => setActive('custody')} disabled={busy}>
            Custodia / escaneo
          </Button>
        ) : null}
        {isOpAdmin && DISPATCHABLE.includes(detail.status) && !detail.courier.trackingNumber ? (
          <Button variant="outline" size="sm" onClick={() => setActive('dispatch')} disabled={busy}>
            Despachar
          </Button>
        ) : null}
        {isStaff && DELIVERY_STATES.includes(detail.status) ? (
          <>
            <Button variant="outline" size="sm" onClick={() => setActive('otp')} disabled={busy}>
              Pedir OTP al receptor
            </Button>
            <Button size="sm" onClick={() => setActive('deliver')} disabled={busy}>
              Registrar entrega
            </Button>
          </>
        ) : null}
        {isStaff &&
        detail.paymentMethod === 'ON_DELIVERY' &&
        detail.status === 'DELIVERED' &&
        detail.paymentStatus === 'PENDING' ? (
          <Button variant="outline" size="sm" onClick={() => setActive('cod')} disabled={busy}>
            Cobrar contra entrega
          </Button>
        ) : null}

        {/* ── Emisor / admin ── */}
        {(isSender || isAdmin) && EDITABLE.includes(detail.status) ? (
          <Button variant="outline" size="sm" onClick={() => setActive('edit')} disabled={busy}>
            Editar
          </Button>
        ) : null}
        {(isSender || isAdmin) && CANCELLABLE.includes(detail.status) ? (
          <Button variant="destructive" size="sm" onClick={() => setActive('cancel')} disabled={busy}>
            Cancelar envío
          </Button>
        ) : null}
      </div>

      <ActionDialog
        active={active}
        onClose={cancelClose}
        busy={busy}
        run={run}
        code={code}
        detail={detail}
      />
    </div>
  );
}

function ActionDialog({
  active,
  onClose,
  busy,
  run,
  code,
  detail,
}: {
  active: string | null;
  onClose: () => void;
  busy: boolean;
  run: (op: () => Promise<{ ok: boolean; message: string }>, opts?: { close?: boolean }) => void;
  code: string;
  detail: ShipmentDetail;
}) {
  if (!active) return null;

  const open = true;

  const commonProps = {
    open,
    onOpenChange: (next: boolean) => {
      if (!next) onClose();
    },
  };

  switch (active) {
    case 'event':
      return <EventDialog {...commonProps} busy={busy} run={run} code={code} detail={detail} />;
    case 'custody':
      return <CustodyDialog {...commonProps} busy={busy} run={run} code={code} />;
    case 'dispatch':
      return <DispatchDialog {...commonProps} busy={busy} run={run} code={code} />;
    case 'otp':
      return <OtpDialog {...commonProps} busy={busy} run={run} code={code} />;
    case 'deliver':
      return <DeliverDialog {...commonProps} busy={busy} run={run} code={code} />;
    case 'cod':
      return <CodDialog {...commonProps} busy={busy} run={run} code={code} />;
    case 'edit':
      return <EditDialog {...commonProps} busy={busy} run={run} code={code} detail={detail} />;
    case 'cancel':
      return <CancelDialog {...commonProps} busy={busy} run={run} code={code} />;
    default:
      return null;
  }
}

// ── Diálogos concretos ─────────────────────────────────────────

interface DialogShellProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  busy: boolean;
  run: (op: () => Promise<{ ok: boolean; message: string }>, opts?: { close?: boolean }) => void;
  code: string;
}

function EventDialog({ open, onOpenChange, busy, run, code, detail }: DialogShellProps & { detail: ShipmentDetail }) {
  const [nextState, setNextState] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [locationName, setLocationName] = useState('');

  const options = ALLOWED_NEXT[detail.status] ?? [];

  const submit = () =>
    run(async () => {
      await api(`/api/shipments/${code}/events`, {
        method: 'POST',
        json: { status: nextState, title: title || undefined, description: description || undefined, locationName: locationName || undefined },
      });
      return { ok: true, message: `Envío actualizado a «${statusLabel(nextState)}».` };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Registrar evento" description="Cambia el estado del envío según la máquina de estados. El backend valida la transición.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="event-status">Nuevo estado</Label>
            <Select id="event-status" value={nextState} onChange={(e) => setNextState(e.target.value)} required>
              <option value="">Selecciona…</option>
              {options.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
            {options.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">Este estado no tiene transiciones disponibles.</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="event-title">Título (opcional)</Label>
            <Input id="event-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="p. ej. Paquete en sede central" />
          </div>
          <div>
            <Label htmlFor="event-description">Descripción (opcional)</Label>
            <Textarea id="event-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detalle del movimiento…" />
          </div>
          <div>
            <Label htmlFor="event-location">Lugar (opcional)</Label>
            <Input id="event-location" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Ciudad o sede" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={busy || !nextState}>
              {busy ? 'Guardando…' : 'Registrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustodyDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  const [action, setAction] = useState<CustodyAction>('SCAN_IN');
  const [scanCode, setScanCode] = useState('');
  const [note, setNote] = useState('');

  const submit = () =>
    run(async () => {
      await api(`/api/shipments/${code}/custody`, {
        method: 'POST',
        json: { action, scanCode: scanCode || undefined, note: note || undefined },
      });
      return { ok: true, message: `Movimiento de custodia «${CUSTODY_LABELS[action]}» registrado.` };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Custodia / escaneo" description="Registra un movimiento físico del paquete. Aparecerá en la línea de tiempo del receptor.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="custody-action">Movimiento</Label>
            <Select id="custody-action" value={action} onChange={(e) => setAction(e.target.value as CustodyAction)}>
              {CUSTODY_ACTIONS.map((item) => (
                <option key={item} value={item}>
                  {CUSTODY_LABELS[item]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="custody-scan">Código escaneado (opcional)</Label>
            <Input id="custody-scan" value={scanCode} onChange={(e) => setScanCode(e.target.value)} placeholder="Sede o etiqueta" />
          </div>
          <div>
            <Label htmlFor="custody-note">Nota (opcional)</Label>
            <Textarea id="custody-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Condición del paquete, repartidor…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Registrando…' : 'Registrar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DispatchDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  const submit = () =>
    run(async () => {
      const result = await api<{ data?: { trackingNumber: string; estimatedDays: number | null }; message?: string }>(
        `/api/shipments/${code}/dispatch`,
        { method: 'POST' },
      );
      if (result.data) {
        return {
          ok: true,
          message: `Despachado. Nº de seguimiento: ${result.data.trackingNumber}${result.data.estimatedDays ? ` · entrega estimada en ${result.data.estimatedDays} día(s)` : ''}`,
        };
      }
      return { ok: true, message: result.message ?? 'El envío ya estaba registrado en el transportista.' };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Despachar al transportista" description="Registra el envío en el transportista activo y genera el número de seguimiento.">
        <p className="text-sm text-slate-500">
          Una vez despachado no se podrá editar el contenido. ¿Continuar?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Despachando…' : 'Despachar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OtpDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  // Cuando WhatsApp no está configurado, el backend devuelve el código
  // en la respuesta (mismo criterio que el `devCode` del registro de
  // clientes). Se muestra aquí porque el receptor todavía no tiene
  // forma de recibirlo.
  const [devCode, setDevCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    if (!devCode) return;
    try {
      await navigator.clipboard.writeText(devCode);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles el código sigue visible y se puede
      // escribir a mano.
      setCopied(false);
    }
  };

  const submit = () =>
    run(
      async () => {
        const result = await api<{
          data: {
            sent: boolean;
            channel: 'WHATSAPP' | 'EMAIL' | null;
            expiresAt: string | null;
            devCode?: string;
            note?: string;
          };
        }>(`/api/shipments/${code}/delivery-otp`, { method: 'POST' });

        const data = result.data;
        setDevCode(data.devCode ?? null);
        setExpiresAt(data.expiresAt);
        setCopied(false);

        return {
          ok: true,
          message: data.sent
            ? `OTP enviado al receptor.${data.expiresAt ? ` Vence ${formatDateTime(data.expiresAt)}.` : ''}`
            : data.devCode
              ? 'Modo desarrollo: el código del receptor se muestra en pantalla.'
              : `No se pudo enviar el OTP. ${data.note ?? ''}`,
        };
      },
      // Se deja abierto a propósito: si el código se muestra en
      // pantalla, el repartidor necesita leerlo antes de cerrar.
      { close: false },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Enviar OTP de entrega" description="Envía al receptor el código de 6 dígitos que validará la recepción cuando entregues.">
        {devCode ? (
          <Alert
            className="mt-4"
            notice={{
              kind: 'info',
              message:
                'Modo desarrollo: WhatsApp no está configurado, así que el código no se ' +
                'envió. Úsalo tú para validar la entrega.',
            }}
          />
        ) : null}

        {devCode ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Código del receptor
              </p>
              <p className="font-mono text-2xl tracking-[0.3em] text-slate-900">{devCode}</p>
              {expiresAt ? (
                <p className="mt-1 text-xs text-slate-500">Vence {formatDateTime(expiresAt)}</p>
              ) : null}
            </div>
            <Button variant="outline" size="sm" onClick={() => void copyCode()} disabled={busy}>
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
            {devCode ? 'Cerrar' : 'Cancelar'}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Enviando…' : 'Enviar OTP'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  const [mode, setMode] = useState<'otp' | 'unverified'>('otp');
  const [otp, setOtp] = useState('');
  const [reason, setReason] = useState('');
  const [locationName, setLocationName] = useState('');

  const submit = () =>
    run(async () => {
      const payload =
        mode === 'otp'
          ? { otp: otp.trim() }
          : { unverifiedReason: reason.trim(), locationName: locationName || undefined };
      await api(`/api/shipments/${code}/deliver`, { method: 'POST', json: payload });
      return {
        ok: true,
        message:
          mode === 'otp'
            ? 'Entrega registrada y verificada por el receptor.'
            : 'Entrega registrada sin verificación. El panel la marca para revisión.',
      };
    });

  const canSubmit = mode === 'otp' ? otp.trim().length === 6 : reason.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Registrar entrega" description="La verificación por OTP es la única que confirma que el receptor recibió el paquete.">
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              variant={mode === 'otp' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('otp')}
              type="button"
            >
              Con OTP del receptor
            </Button>
            <Button
              variant={mode === 'unverified' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('unverified')}
              type="button"
            >
              Sin verificar (motivo)
            </Button>
          </div>

          {mode === 'otp' ? (
            <div>
              <Label htmlFor="deliver-otp">Código de 6 dígitos</Label>
              <Input
                id="deliver-otp"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="deliver-reason">Motivo de la entrega sin verificación</Label>
              <Textarea
                id="deliver-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="p. ej. El receptor no pudo dar su código pero recibió el paquete…"
              />
              <div>
                <Label htmlFor="deliver-location" className="mt-3">
                  Lugar (opcional)
                </Label>
                <Input id="deliver-location" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Domicilio o punto de entrega" />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={busy || !canSubmit}>
              {busy ? 'Registrando…' : 'Confirmar entrega'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CodDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  const submit = () =>
    run(async () => {
      await api(`/api/payments/shipments/${code}/cod-collected`, { method: 'POST', json: { collected: true } });
      return { ok: true, message: 'Pago contra entrega registrado como cobrado.' };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cobro contra entrega" description="Confirma que el repartidor cobró el importe del paquete al entregarlo.">
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Cobrando…' : 'Confirmar cobro'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ open, onOpenChange, busy, run, code, detail }: DialogShellProps & { detail: ShipmentDetail }) {
  const recipient = detail.recipientAddress;
  const [contactName, setContactName] = useState(recipient.contactName);
  const [contactPhone, setContactPhone] = useState(recipient.contactPhone ?? '');
  const [line1, setLine1] = useState(recipient.line1);
  const [line2, setLine2] = useState(recipient.line2 ?? '');
  const [city, setCity] = useState(recipient.city);
  const [region, setRegion] = useState(recipient.region ?? '');
  const [postalCode, setPostalCode] = useState(recipient.postalCode ?? '');
  const [instructions, setInstructions] = useState(recipient.instructions ?? '');
  const [weight, setWeight] = useState(detail.weightGrams ? String(detail.weightGrams) : '');
  const [declaredValue, setDeclaredValue] = useState(detail.declaredValueCents ? String(detail.declaredValueCents) : '');

  const submit = () =>
    run(async () => {
      const json: Record<string, unknown> = {
        recipientAddress: {
          contactName,
          contactPhone,
          line1,
          line2: line2 || null,
          city,
          region: region || null,
          postalCode: postalCode || null,
          instructions: instructions || null,
          countryCode: recipient.countryCode || 'NI',
        },
      };
      if (weight) json.weightGrams = Number(weight);
      if (declaredValue) json.declaredValueCents = Number(declaredValue);
      await api(`/api/shipments/${code}`, { method: 'PATCH', json });
      return { ok: true, message: 'Envío actualizado.' };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Editar envío" description="Solo es posible antes del despacho. La dirección del remitente no se toca.">
        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <fieldset className="rounded-md border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Dirección del receptor
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-contact">Contacto</Label>
                <Input id="edit-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="edit-phone">Teléfono</Label>
                <Input id="edit-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-line1">Calle y número</Label>
                <Input id="edit-line1" value={line1} onChange={(e) => setLine1(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-line2">Complemento (opcional)</Label>
                <Input id="edit-line2" value={line2} onChange={(e) => setLine2(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="edit-city">Ciudad</Label>
                <Input id="edit-city" value={city} onChange={(e) => setCity(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="edit-region">Departamento (opcional)</Label>
                <Input id="edit-region" value={region} onChange={(e) => setRegion(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="edit-postal">Código postal (opcional)</Label>
                <Input id="edit-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="edit-instructions">Instrucciones de entrega (opcional)</Label>
                <Input id="edit-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Entregar solo en horario…" />
              </div>
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="edit-weight">Peso (gramos)</Label>
              <Input id="edit-weight" type="number" min={1} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="edit-value">Valor declarado (centavos)</Label>
              <Input id="edit-value" type="number" min={0} value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ open, onOpenChange, busy, run, code }: DialogShellProps) {
  const [reason, setReason] = useState('');

  const submit = () =>
    run(async () => {
      await api(`/api/shipments/${code}/cancel`, { method: 'POST', json: { reason } });
      return { ok: true, message: 'Envío cancelado.' };
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cancelar envío" description="Un envío ya despachado no puede cancelarse; se resuelve con devolución.">
        <div className="space-y-4">
          <div>
            <Label htmlFor="cancel-reason">Motivo de la cancelación</Label>
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mínimo 5 caracteres…" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onOpenChange.bind(null, false)} disabled={busy}>
              Volver
            </Button>
            <Button variant="destructive" onClick={submit} disabled={busy || reason.trim().length < 5}>
              {busy ? 'Cancelando…' : 'Cancelar envío'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}