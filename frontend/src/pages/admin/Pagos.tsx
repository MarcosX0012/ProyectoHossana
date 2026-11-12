import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, FileText, Loader2, Search, XCircle } from 'lucide-react';
import { api, apiBlob } from '../../lib/api';
import type {
  PaymentSubmission,
  PaymentSubmissionStatus,
} from '../../lib/types';
import { formatDateTime, formatMoney, fullName } from '../../lib/utils';
import { useApi } from '../../lib/useApi';
import { PageHeader } from '../../components/PageHeader';
import { Alert, type Notice } from '../../components/feedback';
import { Badge, type BadgeVariant } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent } from '../../components/ui/dialog';
import { Input, Select, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const STATUS_META: Record<
  PaymentSubmissionStatus,
  { label: string; variant: BadgeVariant }
> = {
  PENDING_REVIEW: { label: 'En revisión', variant: 'warning' },
  APPROVED: { label: 'Aprobado', variant: 'success' },
  REJECTED: { label: 'Rechazado', variant: 'danger' },
};

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface SubmissionsResponse {
  data: PaymentSubmission[];
  pagination: Pagination;
}

export function Pagos() {
  const [status, setStatus] = useState<PaymentSubmissionStatus | ''>('PENDING_REVIEW');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [reviewing, setReviewing] = useState<{
    submission: PaymentSubmission;
    decision: 'APPROVE' | 'REJECT';
  } | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    params.set('page', String(page));
    params.set('pageSize', '20');
    return `/api/payments/admin/submissions?${params.toString()}`;
  }, [status, search, page]);

  const submissionsApi = useApi<SubmissionsResponse>(path);

  const openReview = (submission: PaymentSubmission, decision: 'APPROVE' | 'REJECT') => {
    setReviewNote('');
    setNotice(null);
    setReviewing({ submission, decision });
  };

  const submitReview = async () => {
    if (!reviewing) return;
    const { submission, decision } = reviewing;
    if (decision === 'REJECT' && !reviewNote.trim()) {
      setNotice({ kind: 'error', message: 'Indica el motivo del rechazo.' });
      return;
    }

    setBusyId(submission.id);
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
            ? `Pago de ${submission.shipment?.trackingCode ?? 'el envío'} aprobado.`
            : `Comprobante de ${submission.shipment?.trackingCode ?? 'el envío'} rechazado.`,
      });
      submissionsApi.reload();
    } catch (cause) {
      setNotice({
        kind: 'error',
        message: cause instanceof Error ? cause.message : 'No se pudo revisar el comprobante.',
      });
    } finally {
      setBusyId(null);
    }
  };

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
        message: cause instanceof Error ? cause.message : 'No se pudo abrir el comprobante.',
      });
    }
  };

  const rows = submissionsApi.data?.data ?? [];
  const pagination = submissionsApi.data?.pagination;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Revisión de pagos"
        description="Comprobantes de transferencia bancaria pendientes de aprobación."
      />

      {notice ? <Alert notice={notice} /> : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
          <div>
            <Label htmlFor="payment-status">Estado</Label>
            <Select
              id="payment-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as PaymentSubmissionStatus | '');
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              <option value="PENDING_REVIEW">En revisión</option>
              <option value="APPROVED">Aprobados</option>
              <option value="REJECTED">Rechazados</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="payment-search">Buscar</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="payment-search"
                className="pl-9"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Código de envío, referencia, nombre o correo"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {submissionsApi.loading ? (
            <p className="flex items-center gap-2 p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando comprobantes…
            </p>
          ) : null}
          {submissionsApi.error ? (
            <div className="p-4">
              <Alert notice={{ kind: 'error', message: submissionsApi.error }} />
            </div>
          ) : null}

          {!submissionsApi.loading && !submissionsApi.error ? (
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-medium">Envío</th>
                  <th className="px-4 py-3 font-medium">Emisor</th>
                  <th className="px-4 py-3 font-medium">Importe</th>
                  <th className="px-4 py-3 font-medium">Cuenta</th>
                  <th className="px-4 py-3 font-medium">Comprobante</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((submission) => {
                  const meta = STATUS_META[submission.status];
                  const isPending = submission.status === 'PENDING_REVIEW';
                  return (
                    <tr key={submission.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="px-4 py-3">
                        {submission.shipment ? (
                          <Link
                            to={`/envios/${submission.shipment.trackingCode}`}
                            className="font-mono font-semibold text-indigo-700 hover:underline"
                          >
                            {submission.shipment.trackingCode}
                          </Link>
                        ) : (
                          '—'
                        )}
                        <p className="mt-1 text-xs text-slate-400">
                          {formatDateTime(submission.createdAt)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-800">
                          {fullName(submission.submittedBy)}
                        </p>
                        <p className="text-xs text-slate-500">{submission.submittedBy.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900">
                          {formatMoney(submission.amountCents, submission.currency)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatMoney(submission.amountNioCents, 'NIO')}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p>{submission.bankAccount.bankName}</p>
                        <p className="font-mono text-xs">{submission.bankAccount.accountNumber}</p>
                        <p className="text-xs text-slate-400">
                          {submission.reference ? `Ref. ${submission.reference}` : 'Sin referencia'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void openProof(submission)}
                        >
                          <FileText className="h-4 w-4" />
                          Ver
                        </Button>
                        <p className="mt-1 text-xs text-slate-400">
                          {submission.proofOriginalName ?? 'Comprobante'}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        {submission.reviewNote ? (
                          <p className="mt-1 max-w-[180px] text-xs text-slate-500">
                            {submission.reviewNote}
                          </p>
                        ) : null}
                        {submission.reviewedBy ? (
                          <p className="mt-1 text-xs text-slate-400">
                            Por {fullName(submission.reviewedBy)}
                          </p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {isPending ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={() => openReview(submission, 'APPROVE')}
                              disabled={busyId === submission.id}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Aprobar
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => openReview(submission, 'REJECT')}
                              disabled={busyId === submission.id}
                            >
                              <XCircle className="h-4 w-4" />
                              Rechazar
                            </Button>
                          </div>
                        ) : (
                          <p className="text-right text-xs text-slate-400">Revisado</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                      No hay comprobantes con estos filtros.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
          <p>
            {pagination.total} comprobante{pagination.total === 1 ? '' : 's'} · página{' '}
            {pagination.page} de {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={pagination.page <= 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={reviewing !== null} onOpenChange={(open) => (!open ? setReviewing(null) : null)}>
        {reviewing ? (
          <DialogContent
            title={reviewing.decision === 'APPROVE' ? 'Aprobar pago' : 'Rechazar comprobante'}
            description={
              reviewing.decision === 'APPROVE'
                ? `Se marcará ${reviewing.submission.shipment?.trackingCode ?? 'el envío'} como pagado y podrá avanzar en la logística.`
                : 'El emisor podrá subir un nuevo comprobante. Explica el motivo.'
            }
          >
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <p>
                  {formatMoney(
                    reviewing.submission.amountCents,
                    reviewing.submission.currency,
                  )}{' '}
                  · {reviewing.submission.bankAccount.bankName}
                </p>
                <p className="text-xs text-slate-500">
                  {reviewing.submission.reference
                    ? `Referencia ${reviewing.submission.reference}`
                    : 'Sin referencia'}{' '}
                  · {fullName(reviewing.submission.submittedBy)}
                </p>
              </div>
              <div>
                <Label htmlFor="review-note">
                  Nota {reviewing.decision === 'REJECT' ? '*' : '(opcional)'}
                </Label>
                <Textarea
                  id="review-note"
                  rows={3}
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  maxLength={500}
                  placeholder={
                    reviewing.decision === 'APPROVE'
                      ? 'Ej. Transferencia verificada en el estado de cuenta.'
                      : 'Ej. El monto no coincide con el total del envío.'
                  }
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setReviewing(null)}
                  disabled={busyId !== null}
                >
                  Cancelar
                </Button>
                <Button
                  variant={reviewing.decision === 'APPROVE' ? 'default' : 'destructive'}
                  onClick={() => void submitReview()}
                  disabled={busyId !== null}
                >
                  {busyId !== null ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : reviewing.decision === 'APPROVE' ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  {busyId !== null
                    ? 'Guardando…'
                    : reviewing.decision === 'APPROVE'
                      ? 'Aprobar pago'
                      : 'Rechazar comprobante'}
                </Button>
              </div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
