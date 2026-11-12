import { ArrowLeft, ArrowRight, Calculator, Check, Copy, AlertCircle, Package, Plus, Trash2, User, MapPin, CreditCard } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Alert, type Notice } from "../components/feedback";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input, Select, Textarea } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { api, ApiRequestError, apiForm } from "../lib/api";
import { formatMoney } from "../lib/utils";
import type { AddressInput, BankAccount, CreateShipmentInput, CreateShipmentResult, Department, ItemInput, RateBreakdown } from "../lib/types";

interface ProductRow { name: string; quantity: string; unitValue: string; isFragile: boolean; isHazmat: boolean; description: string; catalogCode?: string; }
interface AddressForm { contactName: string; contactPhone: string; line1: string; line2: string; city: string; region: string; postalCode: string; instructions: string; }
interface SavedAddress { id: string; label?: string; contactName: string; contactPhone: string; line1: string; city: string; }

const EMPTY_ADDRESS: AddressForm = { contactName: "", contactPhone: "", line1: "", line2: "", city: "", region: "", postalCode: "", instructions: "" };
const STEPS = [{ id: 1, title: "Remitente/Origen", icon: User }, { id: 2, title: "Destinatario/Receptor", icon: MapPin }, { id: 3, title: "Paquete y Detalles", icon: Package }, { id: 4, title: "Resumen y Confirmación", icon: CreditCard }];
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const CONFIRM_DELAY_MS = 150;

function RequirementItem({ done, label, optional = false }: { done: boolean; label: string; optional?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
        }`}
      >
        {done ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      </span>
      <span className={done ? "text-emerald-800" : "text-amber-800"}>
        {label}
        {optional ? " (opcional)" : null}
      </span>
    </li>
  );
}
const formatUsd = (cents: number) => formatMoney(cents, "USD").replace(/^USD\s*/i, "US$ ");

/**
 * Limpia el teléfono antes de enviarlo: el backend solo acepta dígitos y
 * un '+' inicial (p. ej. "+505 8888-0000" -> "+50588880000").
 */
function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const hasLeadingPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return (hasLeadingPlus ? "+" : "") + digits;
}

function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{7,15}$/.test(normalizePhone(value));
}

function AddressFields({ title, value, onChange, savedAddresses = [], onSelectSaved }: any) {
  const set = (field: keyof AddressForm) => (event: ChangeEvent<HTMLInputElement>) => onChange({ ...value, [field]: event.target.value });
  return (
    <fieldset className="rounded-md border border-slate-200 p-4">
      <legend className="px-2 text-sm font-semibold uppercase tracking-wide text-slate-600">{title}</legend>
      {savedAddresses.length > 0 && onSelectSaved && (
        <div className="mb-4">
          <Label>Usar dirección guardada</Label>
          <Select onChange={(e) => { const addr = savedAddresses.find((a: any) => a.id === e.target.value); if (addr) onSelectSaved(addr); }}>
            <option value="">Seleccionar...</option>
            {savedAddresses.map((addr: any) => (<option key={addr.id} value={addr.id}>{addr.label || addr.contactName} - {addr.city}</option>))}
          </Select>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><Label>Contacto *</Label><Input value={value.contactName} onChange={set("contactName")} required /></div>
        <div><Label>Teléfono *</Label><Input inputMode="numeric" placeholder="88880000" value={value.contactPhone} onChange={set("contactPhone")} required /><p className="mt-1 text-xs text-slate-400">7 a 15 dígitos; acepta espacios y guiones.</p></div>
        <div className="sm:col-span-2"><Label>Dirección completa *</Label><Input value={value.line1} onChange={set("line1")} required /></div>
        <div className="sm:col-span-2"><Label>Complemento</Label><Input value={value.line2} onChange={set("line2")} /></div>
        <div><Label>Ciudad/Municipio *</Label><Input value={value.city} onChange={set("city")} required /></div>
        <div><Label>Departamento</Label><Input value={value.region} onChange={set("region")} /></div>
        <div><Label>Código postal</Label><Input value={value.postalCode} onChange={set("postalCode")} /></div>
        <div><Label>Instrucciones</Label><Input value={value.instructions} onChange={set("instructions")} /></div>
      </div>
    </fieldset>
  );
}
function toAddressInput(form: AddressForm): AddressInput {
  return { contactName: form.contactName, contactPhone: normalizePhone(form.contactPhone), line1: form.line1, line2: form.line2 || null, city: form.city, region: form.region || null, postalCode: form.postalCode || null, instructions: form.instructions || null, countryCode: "NI" };
}
export function CreateShipmentWizard() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [sender, setSender] = useState<AddressForm>(EMPTY_ADDRESS);
  const [recipient, setRecipient] = useState<AddressForm>(EMPTY_ADDRESS);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [productCatalog, setProductCatalog] = useState<any[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([{ name: "", quantity: "1", unitValue: "", isFragile: false, isHazmat: false, description: "", catalogCode: "" }]);
  const [declaredValue, setDeclaredValue] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"BANK_TRANSFER" | "ON_DELIVERY">("ON_DELIVERY");
  const [paymentCurrency, setPaymentCurrency] = useState<"NIO" | "USD">("NIO");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");
  const [bankAccountsLoading, setBankAccountsLoading] = useState(false);
  const [bankAccountsError, setBankAccountsError] = useState<string | null>(null);
  const [copiedAccountId, setCopiedAccountId] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofReference, setProofReference] = useState("");
  const [proofSenderName, setProofSenderName] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [paymentUploadError, setPaymentUploadError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [originDepartmentId, setOriginDepartmentId] = useState("");
  const [destDepartmentId, setDestDepartmentId] = useState("");
  const [weightLbs, setWeightLbs] = useState("");
  const [rate, setRate] = useState<RateBreakdown | null>(null);
  const [rateError, setRateError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReady, setConfirmReady] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [created, setCreated] = useState<CreateShipmentResult | null>(null);
  const submittingRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [deptsRes, catalogRes, addressesRes] = await Promise.all([api<{ data: Department[] }>("/api/departments"), api<{ data: any[] }>("/api/public/product-catalog"), api<{ data: SavedAddress[] }>("/api/addresses").catch(() => ({ data: [] }))]);
        if (!cancelled) { setDepartments(deptsRes.data); setProductCatalog(catalogRes.data); setSavedAddresses(addressesRes.data || []); }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const weight = Number(weightLbs);
    const complete = originDepartmentId !== "" && destDepartmentId !== "" && weightLbs.trim() !== "";
    if (!complete) {
      setRate(null);
      setRateError(null);
      setRateLoading(false);
      return;
    }
    let cancelled = false;
    setRateLoading(true);
    setRate(null);
    setRateError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await api<{ data: RateBreakdown }>("/api/shipping-rates/calculate", { method: "POST", json: { originDepartmentId, destDepartmentId, weightLbs: weight } });
          if (!cancelled) { setRate(response.data); setRateError(null); }
        } catch (cause) {
          if (!cancelled) { setRate(null); setRateError(cause instanceof Error ? cause.message : "No se pudo calcular"); }
        } finally {
          if (!cancelled) setRateLoading(false);
        }
      })();
    }, 450);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [originDepartmentId, destDepartmentId, weightLbs]);
  useEffect(() => {
    // Al cambiar de paso, volvemos arriba para que el usuario vea el
    // contenido nuevo (especialmente el resumen del paso 4).
    window.scrollTo({ top: 0, behavior: "smooth" });
    setReviewed(false);
    if (currentStep !== 4) {
      setConfirmReady(false);
      return;
    }
    setConfirmReady(false);
    const timer = window.setTimeout(() => setConfirmReady(true), CONFIRM_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [currentStep]);
  useEffect(() => {
    // Las cuentas se cargan solo si el pago es por transferencia: se
    // necesita la moneda para listar las cuentas activas correctas.
    if (paymentMethod !== "BANK_TRANSFER") {
      setBankAccounts([]);
      setSelectedBankAccountId("");
      setBankAccountsError(null);
      setBankAccountsLoading(false);
      setProofFile(null);
      setProofReference("");
      setProofSenderName("");
      setProofNote("");
      return;
    }

    let cancelled = false;
    setBankAccountsLoading(true);
    setBankAccountsError(null);
    setSelectedBankAccountId("");

    api<{ data: BankAccount[] }>(`/api/payments/bank-accounts?currency=${paymentCurrency}`)
      .then((response) => {
        if (cancelled) return;
        setBankAccounts(response.data);
        setBankAccountsError(null);
      })
      .catch((cause) => {
        if (cancelled) return;
        setBankAccounts([]);
        setBankAccountsError(
          cause instanceof Error ? cause.message : "No se pudieron cargar las cuentas bancarias",
        );
      })
      .finally(() => {
        if (!cancelled) setBankAccountsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [paymentMethod, paymentCurrency]);
  useEffect(() => {
    // Si cambia la forma o moneda de pago, la revisión anterior deja de
    // ser válida: el usuario debe confirmar de nuevo.
    setReviewed(false);
  }, [paymentMethod, paymentCurrency, selectedBankAccountId, proofFile]);
  const updateProduct = (index: number, patch: Partial<ProductRow>) => setProducts(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addProduct = () => setProducts(rows => [...rows, { name: "", quantity: "1", unitValue: "", isFragile: false, isHazmat: false, description: "", catalogCode: "" }]);
  const removeProduct = (index: number) => setProducts(rows => rows.filter((_, i) => i !== index));
  const handleCatalogSelect = (index: number, code: string) => {
    const item = productCatalog.find(p => p.code === code);
    if (item && code !== "OTROS") updateProduct(index, { name: item.name, catalogCode: code, description: "" });
    else if (code === "OTROS") updateProduct(index, { catalogCode: "OTROS", description: "" });
  };
  const getSubmitErrors = (): string[] => {
    const errors: string[] = [];
    if (!rate) errors.push("calcula la tarifa");
    if (!reviewed) errors.push("marca “He revisado los datos y el método de pago”");
    if (!confirmReady) errors.push("espera un instante y pulsa de nuevo");
    if (paymentMethod === "BANK_TRANSFER" && !selectedBankAccountId)
      errors.push("elige una cuenta bancaria");
    if (paymentMethod === "BANK_TRANSFER" && !proofFile)
      errors.push("adjunta el comprobante de la transferencia");
    return errors;
  };
  const submitBlockers = getSubmitErrors();

  const copyAccount = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedAccountId(id);
      window.setTimeout(() => {
        setCopiedAccountId((current) => (current === id ? null : current));
      }, 1800);
    } catch {
      // Sin permiso de portapapeles: el número sigue visible.
    }
  };
  const canProceed = () => {
    if (currentStep === 1) return sender.contactName && sender.contactPhone && sender.line1 && sender.city;
    if (currentStep === 2) return recipient.contactName && recipient.contactPhone && recipient.line1 && recipient.city;
    if (currentStep === 3) return products.some(p => p.name.trim()) && originDepartmentId && destDepartmentId && weightLbs && rate;
    return true;
  };
  const goNext = () => {
    if (currentStep === 1 || currentStep === 2) {
      const phone = currentStep === 1 ? sender.contactPhone : recipient.contactPhone;
      if (!isValidPhone(phone)) {
        setNotice({
          kind: "error",
          message:
            "Teléfono inválido: usa 7 a 15 dígitos (puedes usar espacios o guiones; se limpian solos).",
        });
        return;
      }
    }
    if (!canProceed()) return;
    setCurrentStep((step) => Math.min(4, step + 1));
  };
  const missingStep3: string[] = [];
  if (currentStep === 3) {
    if (!products.some(p => p.name.trim())) missingStep3.push("nombre del producto");
    if (!originDepartmentId) missingStep3.push("departamento de origen");
    if (!destDepartmentId) missingStep3.push("departamento de destino");
    if (!weightLbs.trim()) missingStep3.push("peso del paquete");
    if (!rate && !rateLoading && !rateError) missingStep3.push("tarifa calculada");
  }
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (currentStep !== 4) {
      goNext();
      return;
    }
    if (submittingRef.current) return;
    setNotice(null);
    setPaymentUploadError(null);
    const errors = getSubmitErrors();
    if (errors.length > 0) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setNotice({
        kind: "error",
        message: `Faltan para confirmar: ${errors.join(", ")}.`,
      });
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    const items: ItemInput[] = products.filter(p => p.name.trim()).map(p => ({ name: p.name.trim(), quantity: Math.max(1, Math.round(Number(p.quantity) || 1)), unitValueCents: Math.max(0, Math.round((Number(p.unitValue) || 0) * 100)), isFragile: p.isFragile, isHazmat: p.isHazmat, description: p.description.trim() || null }));
    const payload: CreateShipmentInput = { recipientEmail: recipientEmail.trim() || null, senderAddress: toAddressInput(sender), recipientAddress: toAddressInput(recipient), items, originDepartmentId, destDepartmentId, weightLbs: Number(weightLbs), declaredValueCents: declaredValue.trim() ? Math.round(Number(declaredValue) * 100) : undefined, paymentMethod, paymentCurrency: paymentMethod === "BANK_TRANSFER" ? paymentCurrency : "NIO", notes: notes.trim() || null };
    try {
      const result = await api<{ data: CreateShipmentResult }>("/api/shipments", { method: "POST", json: payload });
      const code = result.data.trackingCode;

      if (paymentMethod === "BANK_TRANSFER" && proofFile) {
        const form = new FormData();
        form.append("proof", proofFile);
        form.append("bankAccountId", selectedBankAccountId);
        if (proofReference.trim()) form.append("reference", proofReference.trim());
        if (proofSenderName.trim()) form.append("senderName", proofSenderName.trim());
        if (proofNote.trim()) form.append("note", proofNote.trim());

        try {
          await apiForm<{ data: unknown }>(`/api/payments/shipments/${code}/transfer`, form);
          navigate(`/envios/${code}`);
          return;
        } catch (cause) {
          // El envío ya existe: mostramos el error y dejamos que el usuario
          // suba el comprobante desde el detalle.
          setCreated(result.data);
          setPaymentUploadError(
            cause instanceof Error ? cause.message : "No se pudo subir el comprobante.",
          );
          return;
        }
      }

      navigate(`/envios/${code}`);
    } catch (cause) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      const base = cause instanceof Error ? cause.message : "No se pudo crear el envío.";
      const details = cause instanceof ApiRequestError && Array.isArray(cause.details)
        ? cause.details.map((detail: any) => detail?.message).filter(Boolean)
        : [];
      setNotice({ kind: "error", message: details.length ? `${base}: ${details.join("; ")}` : base });
    } finally { submittingRef.current = false; setBusy(false); }
  };
  if (created) {
    return <div className="mx-auto max-w-lg"><Card><CardHeader><CardTitle>¡Envío creado!</CardTitle><CardDescription>{paymentUploadError ? "El envío quedó pendiente de pago y el comprobante no se subió." : "Tu paquete ha sido registrado"}</CardDescription></CardHeader><CardContent className="flex flex-col items-center gap-4">{paymentUploadError ? <Alert notice={{ kind: "error", message: `${paymentUploadError} Ve al detalle del envío para subir el comprobante.` }} /> : null}<div className="text-center"><p className="text-sm text-slate-500">Código</p><code className="text-2xl font-bold text-indigo-700">{created.trackingCode}</code></div>{created.qr && <img src={created.qr.dataUrl} alt="QR" className="h-48 w-48" />}<div className="flex gap-2"><Button variant="outline" onClick={() => navigate(`/envios/${created.trackingCode}`)}>Ver detalle</Button><Button onClick={() => navigate("/envios")}>Ir a mis envíos</Button></div></CardContent></Card></div>;
  }
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Nuevo envío" description="Crear envío paso a paso" actions={<Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" />Volver</Button>} />
      {notice && <Alert notice={notice} className="mb-4" />}
      <div className="mb-8 flex items-center justify-between">
        {STEPS.map((step, idx) => (
          <div key={step.id} className="flex flex-1 items-center">
            <div className="flex flex-col items-center"><div className={`flex h-12 w-12 items-center justify-center rounded-full ${currentStep >= step.id ? "bg-indigo-600 text-white" : "bg-slate-200"}`}>{currentStep > step.id ? <Check className="h-6 w-6" /> : <step.icon className="h-6 w-6" />}</div><p className={`mt-2 text-sm ${currentStep >= step.id ? "text-indigo-600 font-medium" : "text-slate-500"}`}>{step.title}</p></div>
            {idx < STEPS.length - 1 && <div className={`mx-4 h-1 flex-1 ${currentStep > step.id ? "bg-indigo-600" : "bg-slate-200"}`} />}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit}>
        {currentStep === 1 && <Card><CardHeader><CardTitle>Remitente (Origen)</CardTitle></CardHeader><CardContent><AddressFields title="Dirección de origen" value={sender} onChange={setSender} savedAddresses={savedAddresses} onSelectSaved={(addr: any) => setSender({ contactName: addr.contactName, contactPhone: addr.contactPhone, line1: addr.line1, line2: "", city: addr.city, region: "", postalCode: "", instructions: "" })} /></CardContent></Card>}
        {currentStep === 2 && <Card><CardHeader><CardTitle>Destinatario (Receptor)</CardTitle></CardHeader><CardContent className="space-y-4"><div><Label>Correo del receptor (opcional)</Label><Input type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} /></div><AddressFields title="Dirección de destino" value={recipient} onChange={setRecipient} savedAddresses={savedAddresses} onSelectSaved={(addr: any) => setRecipient({ contactName: addr.contactName, contactPhone: addr.contactPhone, line1: addr.line1, line2: "", city: addr.city, region: "", postalCode: "", instructions: "" })} /></CardContent></Card>}
        {currentStep === 3 && <div className="space-y-4">
          <Card><CardHeader><CardTitle>Productos</CardTitle></CardHeader><CardContent className="space-y-4">
            {products.map((product, index) => (
              <div key={index} className="rounded-lg border p-4 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-3"><Label>Tipo</Label><Select value={product.catalogCode || ""} onChange={(e) => handleCatalogSelect(index, e.target.value)}><option value="">Seleccionar...</option>{productCatalog.map(cat => <option key={cat.code} value={cat.code}>{cat.name}</option>)}</Select></div>
                  <div className="sm:col-span-5"><Label>Producto *</Label><Input value={product.name} placeholder={product.catalogCode === "OTROS" ? "Escribe el nombre del producto" : undefined} onChange={(e) => updateProduct(index, { name: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Label>Cantidad</Label><Input type="number" min={1} value={product.quantity} onChange={(e) => updateProduct(index, { quantity: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Label>Valor (C$)</Label><Input type="number" min={0} value={product.unitValue} onChange={(e) => updateProduct(index, { unitValue: e.target.value })} /></div>
                  {product.catalogCode === "OTROS" && <div className="sm:col-span-12"><Label>Descripción *</Label><Textarea value={product.description} onChange={(e) => updateProduct(index, { description: e.target.value })} /></div>}
                  <div className="sm:col-span-12 flex justify-between"><label className="flex items-center gap-2"><input type="checkbox" checked={product.isFragile} onChange={(e) => updateProduct(index, { isFragile: e.target.checked })} />Frágil</label><Button variant="ghost" size="sm" type="button" onClick={() => removeProduct(index)} disabled={products.length === 1}><Trash2 className="h-4 w-4" />Eliminar</Button></div>
                </div>
              </div>
            ))}
            <Button variant="outline" type="button" onClick={addProduct}><Plus className="h-4 w-4" />Agregar producto</Button>
          </CardContent></Card>
          <Card className="border-indigo-200"><CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-5 w-5" />Tarifa</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div><Label>Origen *</Label><Select value={originDepartmentId} onChange={(e) => setOriginDepartmentId(e.target.value)}><option value="">Selecciona...</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div><Label>Destino *</Label><Select value={destDepartmentId} onChange={(e) => setDestDepartmentId(e.target.value)}><option value="">Selecciona...</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></div>
              <div><Label>Peso (lb) *</Label><Input type="number" min={0.1} max={50} step="0.1" value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} /></div>
            </div>
            {rateLoading && <p className="text-sm text-slate-500">Calculando tarifa…</p>}
            {rateError && <Alert notice={{ kind: "error", message: rateError }} />}
            {rate && <div className="rounded-lg border overflow-hidden"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-2 text-left">Concepto</th><th className="px-4 py-2 text-right">Córdobas</th><th className="px-4 py-2 text-right">Dólares</th></tr></thead><tbody className="divide-y"><tr><td className="px-4 py-2">Base (incluye {rate.includedLbs} lb)</td><td className="px-4 py-2 text-right">{formatMoney(rate.baseAmountCents, "NIO")}</td><td className="px-4 py-2 text-right">{formatUsd(rate.baseAmountUsdCents)}</td></tr>{rate.extraLbsCharged > 0 && <tr><td className="px-4 py-2">Extra {rate.extraLbsCharged} lb</td><td className="px-4 py-2 text-right">{formatMoney(rate.extraLbsCharged * rate.extraPerLbCents, "NIO")}</td><td className="px-4 py-2 text-right">{formatUsd(rate.extraLbsCharged * rate.extraPerLbUsdCents)}</td></tr>}{rate.deliveryCents > 0 && <tr><td className="px-4 py-2">Delivery</td><td className="px-4 py-2 text-right">{formatMoney(rate.deliveryCents, "NIO")}</td><td className="px-4 py-2 text-right">{formatUsd(rate.deliveryUsdCents)}</td></tr>}<tr className="bg-indigo-50 font-bold"><td className="px-4 py-2">TOTAL</td><td className="px-4 py-2 text-right text-indigo-700">{formatMoney(rate.totalCents, "NIO")}</td><td className="px-4 py-2 text-right text-indigo-700">{formatUsd(rate.totalUsdCents)}</td></tr></tbody></table><p className="border-t bg-white px-4 py-2 text-xs text-slate-500">Tipo de cambio aplicado: C$ {rate.exchangeRateNioPerUsd.toFixed(2)} por US$ 1.00.</p></div>}
          </CardContent></Card>
        </div>}
        {currentStep === 4 && <Card><CardHeader><CardTitle>Paso 4 de 4 · Resumen y confirmación</CardTitle><CardDescription>Revisa los datos y el método de pago. El envío se registrará únicamente al pulsar “Confirmar envío”.</CardDescription></CardHeader><CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4"><div className="rounded-lg bg-slate-50 p-3"><h4 className="font-semibold mb-2">Remitente</h4><p>{sender.contactName} - {sender.contactPhone}</p><p>{sender.line1}, {sender.city}</p></div><div className="rounded-lg bg-slate-50 p-3"><h4 className="font-semibold mb-2">Destinatario</h4><p>{recipient.contactName} - {recipient.contactPhone}</p><p>{recipient.line1}, {recipient.city}</p></div></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><Label>Valor declarado (C$)</Label><Input type="number" value={declaredValue} onChange={(e) => setDeclaredValue(e.target.value)} /></div>
            <div><Label>Forma de pago</Label><Select value={paymentMethod} onChange={(e) => { const method = e.target.value as "BANK_TRANSFER" | "ON_DELIVERY"; setPaymentMethod(method); if (method === "ON_DELIVERY") setPaymentCurrency("NIO"); }}><option value="ON_DELIVERY">Contra entrega</option><option value="BANK_TRANSFER">Transferencia bancaria</option></Select></div>
            {paymentMethod === "BANK_TRANSFER" && <div><Label>Moneda de la transferencia</Label><Select value={paymentCurrency} onChange={(e) => setPaymentCurrency(e.target.value as "NIO" | "USD")}><option value="NIO">Córdobas (C$)</option><option value="USD">Dólares (US$)</option></Select></div>}
          </div>
          {paymentMethod === "BANK_TRANSFER" && (
            <div className="space-y-4 rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">
                  Cuenta para la transferencia
                </p>
                {rate && (
                  <p className="mt-1 text-sm text-slate-600">
                    Importe a transferir:{" "}
                    <strong>
                      {paymentCurrency === "USD"
                        ? formatUsd(rate.totalUsdCents)
                        : formatMoney(rate.totalCents, "NIO")}
                    </strong>
                  </p>
                )}
              </div>

              {bankAccountsLoading && <p className="text-sm text-slate-500">Cargando cuentas…</p>}
              {bankAccountsError && <Alert notice={{ kind: "error", message: bankAccountsError }} />}
              {!bankAccountsLoading && !bankAccountsError && bankAccounts.length === 0 ? (
                <Alert
                  notice={{
                    kind: "error",
                    message: `No hay una cuenta bancaria activa en ${
                      paymentCurrency === "USD" ? "dólares" : "córdobas"
                    }. Contacta a Hossana.`,
                  }}
                />
              ) : null}

              {bankAccounts.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {bankAccounts.map((account) => (
                    <label
                      key={account.id}
                      htmlFor={`bank-account-${account.id}`}
                      className={`cursor-pointer rounded-lg border p-3 text-sm transition ${
                        selectedBankAccountId === account.id
                          ? "border-indigo-500 bg-white ring-2 ring-indigo-200"
                          : "border-slate-200 bg-white hover:border-indigo-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          id={`bank-account-${account.id}`}
                          type="radio"
                          name="bank-account"
                          className="mt-1 h-4 w-4 accent-indigo-600"
                          checked={selectedBankAccountId === account.id}
                          onChange={() => setSelectedBankAccountId(account.id)}
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">
                            {account.bankName} ·{" "}
                            {account.currency === "USD" ? "Dólares" : "Córdobas"}
                          </p>
                          <p className="text-xs uppercase tracking-wide text-slate-500">
                            Cuenta {account.accountType.toLowerCase().replace(/_/g, " ")}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                            <code className="font-mono text-sm font-semibold text-slate-800">
                              {account.accountNumber}
                            </code>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                              onClick={(event) => {
                                event.preventDefault();
                                void copyAccount(account.accountNumber, account.id);
                              }}
                            >
                              {copiedAccountId === account.id ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                              {copiedAccountId === account.id ? "Copiado" : "Copiar"}
                            </button>
                          </div>
                          <p className="mt-1 text-xs text-slate-600">{account.accountName}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div>
                <Label htmlFor="transfer-proof">
                  Comprobante (JPG, PNG, WEBP o PDF) *
                </Label>
                <Input
                  id="transfer-proof"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => {
                     const selected = event.target.files?.[0] ?? null;
                     if (selected && selected.size > MAX_PROOF_BYTES) {
                       // Dejamos el input vacío y avisamos de inmediato
                       // en lugar de enviarlo y recibir un 400 después.
                       setProofFile(null);
                       event.target.value = "";
                       setNotice({
                         kind: "error",
                         message: "El comprobante supera el límite de 5 MB.",
                       });
                       return;
                     }
                     setProofFile(selected);
                   }}
                />
                <p className="mt-1 text-xs text-slate-500">Máximo 5 MB.</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="transfer-reference">Número de referencia</Label>
                  <Input
                    id="transfer-reference"
                    value={proofReference}
                    onChange={(event) => setProofReference(event.target.value)}
                    maxLength={120}
                    placeholder="Ej. 12345678"
                  />
                </div>
                <div>
                  <Label htmlFor="transfer-sender">Nombre de quien transfirió</Label>
                  <Input
                    id="transfer-sender"
                    value={proofSenderName}
                    onChange={(event) => setProofSenderName(event.target.value)}
                    maxLength={160}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="transfer-note">Nota (opcional)</Label>
                <Textarea
                  id="transfer-note"
                  value={proofNote}
                  onChange={(event) => setProofNote(event.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
              <p className="text-xs text-slate-500">
                Un administrador u operador validará y confirmará la transferencia antes de
                despachar.
              </p>
            </div>
          )}
          <div><Label>Notas</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />
            <span>He revisado los datos y el método de pago. Entiendo que el envío se registrará al confirmar.</span>
          </label>
          {rate && <div className="rounded-lg bg-indigo-50 p-4 text-center"><p className="text-sm">Total del envío</p><div className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1"><p className="text-2xl font-bold text-indigo-700">{formatMoney(rate.totalCents, "NIO")}</p><p className="text-xl font-semibold text-indigo-600">{formatUsd(rate.totalUsdCents)}</p></div>{paymentMethod === "BANK_TRANSFER" && <p className="mt-2 text-sm text-slate-600">Transferirás {paymentCurrency === "USD" ? formatUsd(rate.totalUsdCents) : formatMoney(rate.totalCents, "NIO")}. Un administrador u operador debe confirmar el comprobante antes del despacho.</p>}</div>}
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <p className="font-semibold text-slate-800">Estado de la confirmación</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              <RequirementItem done={!!rate} label="Tarifa calculada" />
              {paymentMethod === "BANK_TRANSFER" && (
                <>
                  <RequirementItem done={!!selectedBankAccountId} label="Cuenta elegida" />
                  <RequirementItem done={!!proofFile} label="Comprobante adjunto" />
                </>
              )}
              <RequirementItem done={reviewed} label="Revisión aceptada" />
            </ul>
            {submitBlockers.length > 0 ? (
              <p className="mt-2 text-xs text-amber-700">
                Falta: {submitBlockers.filter((item) => item !== "espera un instante y pulsa de nuevo").join(", ")}.
              </p>
            ) : (
              <p className="mt-2 text-xs text-emerald-700">Listo para confirmar.</p>
            )}
          </div>
        </CardContent></Card>}
        <div className="mt-6 flex justify-between"><Button type="button" variant="outline" onClick={() => setCurrentStep(s => Math.max(1, s-1))} disabled={currentStep === 1}><ArrowLeft className="h-4 w-4" />Anterior</Button>{currentStep < 4 ? <Button type="button" onClick={goNext} disabled={!canProceed()}>{currentStep === 3 ? "Revisar envío" : "Siguiente"}<ArrowRight className="h-4 w-4" /></Button> : <Button type="submit" disabled={busy}>{busy ? "Creando..." : "Confirmar envío"}</Button>}</div>
        {currentStep === 3 && missingStep3.length > 0 && <p className="mt-2 text-right text-xs text-amber-700">Falta: {missingStep3.join(", ")}.</p>}
      </form>
    </div>
  );
}
