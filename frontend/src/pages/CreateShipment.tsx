import { ArrowLeft, Calculator, Info, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { Alert, type Notice } from '../components/feedback';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input, Select, Textarea } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { api } from '../lib/api';
import { formatMoney } from '../lib/utils';
import type {
  AddressInput,
  CreateShipmentInput,
  CreateShipmentResult,
  Department,
  ItemInput,
  RateBreakdown,
} from '../lib/types';

interface ProductRow {
  name: string;
  quantity: string;
  unitValue: string;
  isFragile: boolean;
  isHazmat: boolean;
  description: string;
}

interface AddressForm {
  contactName: string;
  contactPhone: string;
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  instructions: string;
}

const EMPTY_ADDRESS: AddressForm = {
  contactName: '',
  contactPhone: '',
  line1: '',
  line2: '',
  city: '',
  region: '',
  postalCode: '',
  instructions: '',
};

function AddressFields({
  title,
  value,
  onChange,
}: {
  title: string;
  value: AddressForm;
  onChange: (next: AddressForm) => void;
}) {
  const set = (field: keyof AddressForm) => (event: ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [field]: event.target.value });

  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${title}-contact`}>Contacto</Label>
          <Input id={`${title}-contact`} value={value.contactName} onChange={set('contactName')} required />
        </div>
        <div>
          <Label htmlFor={`${title}-phone`}>Teléfono</Label>
          <Input
            id={`${title}-phone`}
            value={value.contactPhone}
            onChange={set('contactPhone')}
            placeholder="70012345"
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${title}-line1`}>Calle, número y zona</Label>
          <Input id={`${title}-line1`} value={value.line1} onChange={set('line1')} placeholder="Av. Siempre Viva 742" required />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor={`${title}-line2`}>Complemento (opcional)</Label>
          <Input id={`${title}-line2`} value={value.line2} onChange={set('line2')} placeholder="Depto 3B, edificio…" />
        </div>
        <div>
          <Label htmlFor={`${title}-city`}>Ciudad</Label>
          <Input id={`${title}-city`} value={value.city} onChange={set('city')} placeholder="Managua" required />
        </div>
        <div>
          <Label htmlFor={`${title}-region`}>Departamento (opcional)</Label>
          <Input id={`${title}-region`} value={value.region} onChange={set('region')} placeholder="Managua" />
        </div>
        <div>
          <Label htmlFor={`${title}-postal`}>Código postal (opcional)</Label>
          <Input id={`${title}-postal`} value={value.postalCode} onChange={set('postalCode')} />
        </div>
        <div>
          <Label htmlFor={`${title}-instructions`}>Instrucciones de entrega (opcional)</Label>
          <Input id={`${title}-instructions`} value={value.instructions} onChange={set('instructions')} placeholder="Entregar solo en horario…" />
        </div>
      </div>
    </fieldset>
  );
}

function toAddressInput(form: AddressForm): AddressInput {
  return {
    contactName: form.contactName,
    contactPhone: form.contactPhone,
    line1: form.line1,
    line2: form.line2 || null,
    city: form.city,
    region: form.region || null,
    postalCode: form.postalCode || null,
    instructions: form.instructions || null,
    countryCode: 'NI',
  };
}

/**
 * NUEVO ENVIO
 *
 * Formulario de creación para SENDER / OPERATOR / ADMIN. Los campos
 * reflejan `createShipmentSchema` del backend; la validación final la
 * hace el servidor. Al crear, muestra el QR recién generado.
 */
export function CreateShipment() {
  const navigate = useNavigate();

  const [recipientEmail, setRecipientEmail] = useState('');
  const [sender, setSender] = useState<AddressForm>(EMPTY_ADDRESS);
  const [recipient, setRecipient] = useState<AddressForm>(EMPTY_ADDRESS);
  const [products, setProducts] = useState<ProductRow[]>([
    { name: '', quantity: '1', unitValue: '', isFragile: false, isHazmat: false, description: '' },
  ]);
  const [declaredValue, setDeclaredValue] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'ON_DELIVERY'>('ON_DELIVERY');
  const [notes, setNotes] = useState('');

  // ── Tarifa: origen + destino + peso ──────────────────────
  const [departments, setDepartments] = useState<Department[]>([]);
  const [originDepartmentId, setOriginDepartmentId] = useState('');
  const [destDepartmentId, setDestDepartmentId] = useState('');
  const [weightLbs, setWeightLbs] = useState('');
  const [rate, setRate] = useState<RateBreakdown | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreateShipmentResult | null>(null);

  // Los departamentos son un catálogo público; se cargan una vez.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await api<{ data: Department[] }>('/api/departments');
        if (!cancelled) setDepartments(response.data);
      } catch {
        // El formulario avisa al intentar calcular sin catálogo.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cálculo en vivo del costo. Se espera medio segundo desde la última
  // tecla para no disparar una petición por dígito.
  useEffect(() => {
    const weight = Number(weightLbs);
    const complete =
      originDepartmentId !== '' &&
      destDepartmentId !== '' &&
      weightLbs.trim() !== '' &&
      Number.isFinite(weight) &&
      weight >= 0.1 &&
      weight <= 50;

    if (!complete) {
      setRate(null);
      setRateError(null);
      setRateLoading(false);
      return;
    }

    let cancelled = false;
    setRateLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await api<{ data: RateBreakdown }>('/api/shipping-rates/calculate', {
            method: 'POST',
            json: { originDepartmentId, destDepartmentId, weightLbs: weight },
          });
          if (!cancelled) {
            setRate(response.data);
            setRateError(null);
          }
        } catch (cause) {
          if (!cancelled) {
            setRate(null);
            setRateError(
              cause instanceof Error ? cause.message : 'No se pudo calcular el costo del envío',
            );
          }
        } finally {
          if (!cancelled) setRateLoading(false);
        }
      })();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [originDepartmentId, destDepartmentId, weightLbs]);

  const updateProduct = (index: number, patch: Partial<ProductRow>) =>
    setProducts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const addProduct = () =>
    setProducts((rows) => [
      ...rows,
      { name: '', quantity: '1', unitValue: '', isFragile: false, isHazmat: false, description: '' },
    ]);

  const removeProduct = (index: number) => setProducts((rows) => rows.filter((_, i) => i !== index));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);

    // El costo debe estar calculado antes de crear: el backend lo
    // recalcula de todos modos, pero así el emisor ve lo que pagará.
    if (!rate) {
      setNotice({
        kind: 'error',
        message: 'Completa el origen, el destino y el peso (máximo 50 lb) para calcular el costo.',
      });
      return;
    }

    setBusy(true);

    const items: ItemInput[] = products
      .filter((product) => product.name.trim())
      .map((product) => ({
        name: product.name.trim(),
        quantity: Math.max(1, Number(product.quantity) || 1),
        unitValueCents: Math.max(0, Number(product.unitValue) || 0) * 100,
        isFragile: product.isFragile,
        isHazmat: product.isHazmat,
        description: product.description.trim() || null,
      }));

    const payload: CreateShipmentInput = {
      recipientEmail: recipientEmail.trim() || null,
      senderAddress: toAddressInput(sender),
      recipientAddress: toAddressInput(recipient),
      items,
      originDepartmentId,
      destDepartmentId,
      weightLbs: Number(weightLbs),
      declaredValueCents: declaredValue ? Number(declaredValue) * 100 : undefined,
      paymentMethod,
      notes: notes.trim() || null,
    };

    try {
      const result = await api<{ data: CreateShipmentResult }>('/api/shipments', {
        method: 'POST',
        json: payload,
      });
      setCreated(result.data);
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo crear el envío.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="mx-auto max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">¡Envío creado!</CardTitle>
            <CardDescription>
              El paquete quedó registrado. Comparte el QR para que el receptor lo rastree.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <code className="font-mono text-lg font-semibold text-indigo-700">
              {created.trackingCode}
            </code>
            {created.qr ? (
              <img
                src={created.qr.dataUrl}
                alt={`QR de ${created.trackingCode}`}
                className="h-44 w-44 rounded-md border border-slate-200"
              />
            ) : null}
            <p className="text-center text-sm text-slate-500">
              Entrega estimada:{' '}
              {created.estimatedDeliveryAt ? new Date(created.estimatedDeliveryAt).toLocaleDateString('es-NI') : '—'}
            </p>
            {rate ? (
              <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-sm">
                <span className="text-slate-500">Costo del envío: </span>
                <span className="font-semibold text-slate-900">
                  {formatMoney(rate.totalCents, rate.currency)}
                </span>
                {rate.minWeightNote ? (
                  <p className="mt-1 text-xs text-amber-700">{rate.minWeightNote}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate(`/envios/${created.trackingCode}`)}>
                Ver detalle
              </Button>
              <Button onClick={() => navigate('/envios')}>Ir a mis envíos</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Nuevo envío"
        description="Registra un paquete para enviarlo a un destinatario."
        actions={
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Button>
        }
      />

      {notice ? <Alert notice={notice} className="mb-4" /> : null}

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Receptor</CardTitle>
            <CardDescription>
              Si el correo pertenece a una cuenta registrada, la entrega se podrá verificar con su
              código OTP.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Label htmlFor="recipient-email">Correo del receptor (opcional)</Label>
            <Input
              id="recipient-email"
              type="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="receptor@ejemplo.com"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Direcciones</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <AddressFields title="Dirección de origen" value={sender} onChange={setSender} />
            <AddressFields title="Dirección de destino" value={recipient} onChange={setRecipient} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Productos
              <Button variant="outline" size="sm" type="button" onClick={addProduct}>
                <Plus className="h-4 w-4" />
                Agregar
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {products.map((product, index) => (
              <div key={index} className="rounded-md border border-slate-200 p-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <Label htmlFor={`product-name-${index}`}>Producto</Label>
                    <Input
                      id={`product-name-${index}`}
                      value={product.name}
                      onChange={(event) => updateProduct(index, { name: event.target.value })}
                      placeholder="p. ej. Documentos"
                      required
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor={`product-qty-${index}`}>Cantidad</Label>
                    <Input
                      id={`product-qty-${index}`}
                      type="number"
                      min={1}
                      value={product.quantity}
                      onChange={(event) => updateProduct(index, { quantity: event.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Label htmlFor={`product-value-${index}`}>Valor unitario (C$)</Label>
                    <Input
                      id={`product-value-${index}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={product.unitValue}
                      onChange={(event) => updateProduct(index, { unitValue: event.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex items-end gap-2 sm:col-span-2">
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={product.isFragile}
                        onChange={(event) => updateProduct(index, { isFragile: event.target.checked })}
                      />
                      Frágil
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={() => removeProduct(index)}
                      disabled={products.length === 1}
                      aria-label="Quitar producto"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-indigo-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-indigo-600" />
              Costo del envío
            </CardTitle>
            <CardDescription>
              El costo se calcula con el departamento de origen, el de destino y el peso en
              libras. No se ingresa ningún monto a mano.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="origin-department">Departamento de origen</Label>
                <Select
                  id="origin-department"
                  value={originDepartmentId}
                  onChange={(event) => setOriginDepartmentId(event.target.value)}
                  required
                >
                  <option value="">Selecciona…</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="dest-department">Departamento de destino</Label>
                <Select
                  id="dest-department"
                  value={destDepartmentId}
                  onChange={(event) => setDestDepartmentId(event.target.value)}
                  required
                >
                  <option value="">Selecciona…</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="weight-lbs">Peso del paquete (libras)</Label>
                <Input
                  id="weight-lbs"
                  type="number"
                  min={0.1}
                  max={50}
                  step="0.1"
                  inputMode="decimal"
                  value={weightLbs}
                  onChange={(event) => setWeightLbs(event.target.value)}
                  placeholder="2.0"
                  required
                />
              </div>
            </div>

            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Importante:</strong> el peso se ingresa en libras y no puede superar
                  las 50 lb. Los paquetes de menos de 2 libras se cobran como 2 libras, y los
                  decimales se redondean hacia arriba (4.5 lb se cobran como 5 lb).
                </span>
              </p>
            </div>

            {rateError ? <Alert notice={{ kind: 'error', message: rateError }} /> : null}
            {rateLoading ? <p className="text-sm text-slate-500">Calculando costo…</p> : null}

            {rate ? (
              <div className="rounded-md border border-slate-200">
                <dl className="divide-y divide-slate-100 text-sm">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="text-slate-500">
                      Ruta {rate.routeTypeLabel} · tarifa base (incluye {rate.includedLbs} lb)
                    </dt>
                    <dd className="font-medium text-slate-800">
                      {formatMoney(rate.baseAmountCents, rate.currency)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="text-slate-500">
                      Libras adicionales: {rate.extraLbsCharged} lb ×{' '}
                      {formatMoney(rate.extraPerLbCents, rate.currency)}
                    </dt>
                    <dd className="font-medium text-slate-800">
                      {formatMoney(rate.extraLbsCharged * rate.extraPerLbCents, rate.currency)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <dt className="text-slate-500">Delivery</dt>
                    <dd className="font-medium text-slate-800">
                      {rate.deliveryCents === 0
                        ? 'Incluido'
                        : formatMoney(rate.deliveryCents, rate.currency)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2 font-semibold">
                    <dt>Total del envío</dt>
                    <dd className="text-indigo-700">
                      {formatMoney(rate.totalCents, rate.currency)}
                    </dd>
                  </div>
                </dl>
                {rate.minWeightNote ? (
                  <p className="border-t border-slate-100 px-3 py-2 text-xs text-amber-700">
                    {rate.minWeightNote}
                  </p>
                ) : null}
              </div>
            ) : !rateLoading && !rateError ? (
              <p className="text-sm text-slate-500">
                Selecciona origen, destino y peso para ver el desglose del costo.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pago y notas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="declared">Valor declarado (C$)</Label>
              <Input id="declared" type="number" min={0} value={declaredValue} onChange={(event) => setDeclaredValue(event.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label htmlFor="payment">Método de pago</Label>
              <Select
                id="payment"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value as 'ONLINE' | 'ON_DELIVERY')}
              >
                <option value="ON_DELIVERY">
                  Contra entrega (el receptor paga
                  {rate ? ` ${formatMoney(rate.totalCents, rate.currency)}` : ''})
                </option>
                <option value="ONLINE">
                  En línea (pagas al crear
                  {rate ? ` ${formatMoney(rate.totalCents, rate.currency)}` : ''})
                </option>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="notes">Notas (opcional)</Label>
              <Textarea id="notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Instrucciones para el operador…" />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={() => navigate('/envios')}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy || !rate || products.every((product) => !product.name.trim())}>
            {busy ? 'Creando…' : 'Crear envío'}
          </Button>
        </div>
      </form>

      <p className="mt-4 text-center text-xs text-slate-400">
        <Link to="/envios" className="underline-offset-2 hover:underline">
          O volver a la lista sin crear nada
        </Link>
      </p>
    </div>
  );
}