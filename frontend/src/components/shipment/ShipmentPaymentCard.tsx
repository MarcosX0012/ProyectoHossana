import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Copy, FileText, Loader2, Upload, XCircle } from 'lucide-react';
import { api, apiBlob, apiForm } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type {
  BankAccount,
  PaymentStatus,
  PaymentSubmission,
  ShipmentPaymentInfo,
} from '../../lib/types';
import { formatDateTime, formatMoney, fullName } from '../../lib/utils';
import { useApi } from '../../lib/useApi';
import { Alert, type Notice } from '../feedback';
import { Badge, type BadgeVariant } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Dialog, DialogContent } from '../ui/dialog';
import { Input, Textarea } from '../ui/input';
import { Label } from '../ui/label';

const PAYMENT_STATUS_META: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
  NOT_REQUIRED: { label: 'No requerido', variant: 'muted' },
  PENDING: { label: 'Pendiente', variant: 'warning' },
  PENDING_REVIEW: { label: 'Comprobante en revisión', variant: 'warning' },
  PAID: { label: 'Pagado', variant: 'success' },
  REJECTED: { label: 'Comprobante rechazado', variant: 'danger' },
  FAILED: { label: 'Pago fallido', variant: 'danger' },
  REFUNDED: { label: 'Reembolsado', variant: 'muted' },
};

const SUBMISSION_STATUS_META: Record<
  PaymentSubmission['status'],
  { label: string; variant: BadgeVariant }
> = {
  PENDING_REVIEW: { label: 'En revisión', variant: 'warning' },
  APPROVED: { label: 'Aprobado', variant: 'success' },
  REJECTED: { label: 'Rechazado', variant: 'danger' },
};

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Sin permiso de portapapeles: el numero sigue visible.
    }
  };

  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy} aria-label={label}>
      {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

function BankAccountBlock({ account }: { account: BankAccount }) {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3 text-sm">
      <p className="font-semibold text-slate-900">
        {account.bankName} · {account.currency === 'USD' ? 'Dólares' : 'Córdobas'}
      </p>
      <dl className="mt-2 space-y-1 text-slate-700">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-xs text-slate-500">Cuenta {account.accountType.toLowerCase().replace(/_/g, ' ')}</dt>
          <dd className="flex items-center gap-1 font-mono font-semibold">
            {account.accountNumber}
            <CopyButton value={account.accountNumber} label="Copiar número de cuenta" />
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <dt className="text-xs text-slate-500">Titular</dt>
          <dd className="font-medium">{account.accountName}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ShipmentPaymentCard({
  code,
  onChanged,
}: {
  code: string;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const roles = profile?.roles ?? [];
  const paymentApi = useApi<{ data: ShipmentPaymentInfo }>(
    `/api/payments/shipments/${code}/payment`,
  );

  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [senderName, setSenderName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reviewing, setReviewing] = useState<{
    submission: PaymentSubmission;
    decision: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);

  const payment = paymentApi.data?.data;

  useEffect(() => {
    if (!payment) return;
    const last = payment.submissions[0];
    if (last?.senderName) setSenderName((current) => current || last.senderName || '');
    if (last?.reference) setReference((current) => current || last.reference || '');
  }, [payment]);

  if (paymentApi.loading && !payment) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando información de pago…
        </CardContent>
      </Card>
    );
  }

  if (paymentApi.error) {
    return (
      <Card>
        <CardContent className="p-5">
          <Alert notice={{ kind: 'error', message: paymentApi.error }} />
        </CardContent>
      </Card>
    );
  }

  if (!payment || payment.paymentMethod !== 'BANK_TRANSFER') return null;

  const statusMeta = PAYMENT_STATUS_META[payment.paymentStatus];
  const bankAccount = payment.bankAccounts[0];
  const latest = payment.submissions[0];
  const canUpload =
    payment.canManage &&
    payment.status === 'AWAITING_PAYMENT' &&
    (payment.paymentStatus === 'PENDING' || payment.paymentStatus === 'REJECTED');
  const canViewProof =
    payment.canManage || roles.includes('ADMIN') || roles.includes('OPERATOR');
  const canReview = roles.includes('ADMIN') || roles.includes('OPERATOR');

  const openProof = async (submission: PaymentSubmission) => {
    setNotice(null);
    try {
      const blob = await apiBlob(`/api/payments/submissions/${submission.id}/proof`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo abrir el comprobante',
      });
    }
  };

  const openReview = (submission: PaymentSubmission, decision: 'APPROVE' | 'REJECT') => {
    setReviewing({ submission, decision });
    setReviewNote('');
    setNotice(null);
  };

  const submitReview = async () => {
    if (!reviewing) return;
    const { submission, decision } = reviewing;
    if (decision === 'REJECT' && !reviewNote.trim()) {
      setNotice({ kind: 'error', message: 'Indica el motivo del rechazo.' });
      return;
    }

    setReviewBusy(true);
    setNotice(null);
    try {
      const endpoint = decision === 'APPROVE' ? 'approve' : 'reject';
      await api<{ data: PaymentSubmission }>(
        `/api/payments/admin/submissions/${submission.id}/${endpoint}`,
        { method: 'POST', json: { note: reviewNote.trim() || undefined } },
      );
      setReviewing(null);
      setNotice({
        kind: 'success',
        message:
          decision === 'APPROVE'
            ? 'Transferencia confirmada. El envío puede continuar su proceso.'
            : 'Comprobante rechazado. El emisor podrá subir uno nuevo.',
      });
      paymentApi.reload();
      onChanged();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo revisar el comprobante.',
      });
    } finally {
      setReviewBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    if (!file) {
      setNotice({ kind: 'error', message: 'Adjunta una foto o PDF del comprobante.' });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append('proof', file);
      if (reference.trim()) form.append('reference', reference.trim());
      if (senderName.trim()) form.append('senderName', senderName.trim());
      if (note.trim()) form.append('note', note.trim());
      if (bankAccount) form.append('bankAccountId', bankAccount.id);

      await apiForm<{ data: PaymentSubmission }>(
        `/api/payments/shipments/${code}/transfer`,
        form,
      );

      setFile(null);
      setNote('');
      setNotice({
        kind: 'success',
        message: 'Comprobante enviado. Un administrador u operador lo revisará y confirmará el pago.',
      });
      paymentApi.reload();
      onChanged();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo subir el comprobante',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Pago por transferencia</CardTitle>
            <CardDescription>
              El envío no avanza hasta que un administrador apruebe el comprobante.
            </CardDescription>
          </div>
          <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice ? <Alert notice={notice} /> : null}

        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Importe a transferir</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">
            {formatMoney(payment.expectedAmountCents, payment.paymentCurrency)}
          </p>
          <p className="text-xs text-slate-500">
            Equivalente: {formatMoney(payment.amountCents, 'NIO')} ·{' '}
            {formatMoney(payment.amountUsdCents, 'USD')} · tipo de cambio C${' '}
            {payment.exchangeRateNioPerUsd.toFixed(2)} por US$ 1.00
          </p>
        </div>

        {payment.paymentStatus === 'PAID' ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Pago aprobado{payment.paidAt ? ` el ${formatDateTime(payment.paidAt)}` : ''}. El
              envío puede continuar su proceso logístico.
            </p>
          </div>
        ) : null}

        {latest?.status === 'REJECTED' ? (
          <Alert
            notice={{
              kind: 'error',
              message: latest.reviewNote
                ? `Comprobante rechazado: ${latest.reviewNote}`
                : 'El comprobante fue rechazado. Puedes subir uno nuevo.',
            }}
          />
        ) : null}

        {latest?.status === 'PENDING_REVIEW' ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <p>
              Comprobante recibido el {formatDateTime(latest.createdAt)}. Está pendiente de
              revisión por un administrador u operador.
            </p>
            {canReview ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openProof(latest)}
                >
                  <FileText className="h-4 w-4" />
                  Descargar comprobante
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={() => openReview(latest, 'APPROVE')}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirmar transferencia
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  onClick={() => openReview(latest, 'REJECT')}
                >
                  <XCircle className="h-4 w-4" />
                  Rechazar
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {canUpload ? (
          <>
            {bankAccount ? (
              <BankAccountBlock account={bankAccount} />
            ) : (
              <Alert
                notice={{
                  kind: 'error',
                  message: `No hay una cuenta bancaria activa en ${payment.paymentCurrency}. Contacta a Hossana.`,
                }}
              />
            )}

            <form className="space-y-3" onSubmit={submit}>
              <div>
                <Label htmlFor="payment-proof">Comprobante (JPG, PNG, WEBP o PDF) *</Label>
                <Input
                  id="payment-proof"
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <p className="mt-1 text-xs text-slate-500">Máximo 5 MB.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="payment-reference">Número de referencia</Label>
                  <Input
                    id="payment-reference"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    maxLength={120}
                    placeholder="Ej. 12345678"
                  />
                </div>
                <div>
                  <Label htmlFor="payment-sender">Nombre de quien transfirió</Label>
                  <Input
                    id="payment-sender"
                    value={senderName}
                    onChange={(event) => setSenderName(event.target.value)}
                    maxLength={160}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="payment-note">Nota (opcional)</Label>
                <Textarea
                  id="payment-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
              <Button type="submit" disabled={busy || !bankAccount}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {busy ? 'Enviando…' : 'Enviar comprobante'}
              </Button>
            </form>
          </>
        ) : null}

        {payment.submissions.length > 0 ? (
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-800">Historial de comprobantes</p>
            <ul className="space-y-2">
              {payment.submissions.map((submission) => {
                const meta = SUBMISSION_STATUS_META[submission.status];
                return (
                  <li
                    key={submission.id}
                    className="rounded-lg border border-slate-200 p-3 text-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <span className="text-slate-600">
                          {formatMoney(submission.amountCents, submission.currency)}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatDateTime(submission.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {submission.bankAccount.bankName} · {submission.bankAccount.accountNumber}
                      {submission.reference ? ` · Ref. ${submission.reference}` : ''}
                      {submission.senderName ? ` · ${submission.senderName}` : ''}
                    </p>
                    <p className="text-xs text-slate-400">
                      Subido por {fullName(submission.submittedBy)}
                      {submission.reviewedBy ? ` · Revisado por ${fullName(submission.reviewedBy)}` : ''}
                    </p>
                    {submission.reviewNote ? (
                      <p className="mt-1 text-xs text-slate-600">Nota: {submission.reviewNote}</p>
                    ) : null}
                    {canViewProof ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={() => void openProof(submission)}
                      >
                        <FileText className="h-4 w-4" />
                        Ver comprobante
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
    {reviewing ? (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) setReviewing(null);
        }}
      >
        <DialogContent
          title={
            reviewing.decision === 'APPROVE'
              ? 'Confirmar transferencia'
              : 'Rechazar comprobante'
          }
          description={
            reviewing.decision === 'APPROVE'
              ? 'Marca el comprobante como verificado y el envío como pagado.'
              : 'Indica el motivo del rechazo. El emisor podrá subir un nuevo comprobante.'
          }
        >
          {reviewing.decision === 'REJECT' ? (
            <div>
              <Label htmlFor="review-note">Motivo del rechazo *</Label>
              <Textarea
                id="review-note"
                value={reviewNote}
                rows={3}
                onChange={(event) => setReviewNote(event.target.value)}
                placeholder="Ej. El monto no coincide, referencia ilegible, cuenta incorrecta..."
              />
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Transferencia de{' '}
              <strong>
                {formatMoney(reviewing.submission.amountCents, reviewing.submission.currency)}
              </strong>{' '}
              · {reviewing.submission.bankAccount.bankName} ·{' '}
              {reviewing.submission.bankAccount.accountNumber}
            </p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setReviewing(null)}
              disabled={reviewBusy}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={reviewing.decision === 'REJECT' ? 'destructive' : 'default'}
              onClick={() => void submitReview()}
              disabled={reviewBusy}
            >
              {reviewBusy
                ? 'Revisando…'
                : reviewing.decision === 'REJECT'
                  ? 'Rechazar comprobante'
                  : 'Confirmar transferencia'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    ) : null}
    </>
  );
}
