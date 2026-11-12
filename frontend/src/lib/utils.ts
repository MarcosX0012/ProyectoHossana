import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Une clases de Tailwind sin conflictos (helper estandar de shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const dateTimeFormatter = new Intl.DateTimeFormat('es-NI', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateFormatter = new Intl.DateTimeFormat('es-NI', {
  dateStyle: 'medium',
});

/** `2026-05-01T14:03:00.000Z` -> `1 may 2026, 10:03` (hora local). */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/** Nombre completo de un usuario, con respaldo si viene vacio. */
export function fullName(user: { firstName: string; lastName: string; email?: string }): string {
  const name = `${user.firstName} ${user.lastName}`.trim();
  return name || user.email || 'Sin nombre';
}

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** `amountCents` (10950) + `NIO` -> `C$ 109,50`. */
export function formatMoney(cents: number | null | undefined, currency = 'NIO'): string {
  if (cents === null || cents === undefined) return '—';
  let formatter = moneyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat('es-NI', { style: 'currency', currency });
    moneyFormatters.set(currency, formatter);
  }
  return formatter.format(cents / 100);
}

/** `10950` -> `C$ 109,50` cuando hay valor, `—` sin él. */
export function formatMoneyOr(cents: number | null | undefined, currency = 'NIO'): string {
  if (!cents) return '—';
  return formatMoney(cents, currency);
}

/** Pesos en gramos -> `1,2 kg` / `350 g`. */
export function formatWeight(grams: number | null | undefined): string {
  if (grams === null || grams === undefined) return '—';
  return grams >= 1000
    ? `${(grams / 1000).toLocaleString('es-NI', { maximumFractionDigits: 2 })} kg`
    : `${grams.toLocaleString('es-NI')} g`;
}

/**
 * Normaliza el parámetro de rastreo que llega por URL a un código plano
 * (`HOS-2026-000123`). El QR del paquete puede traer dos cosas:
 *
 *   - el código pelado (se usa tal cual);
 *   - el token firmado `base64url(codigo.issuedAt.firma)` que emite el
 *     backend en `qr.trackingUrl`.
 *
 * El endpoint público del backend exige que un token contenga puntos
 * literales para entrar en su rama de verificación, pero el formato
 * base64url nunca los produce, así que el enlace del QR daría 400.
 * Aquí se decodifica el token (no se valida la firma: eso es del
 * servidor; el código que produce es público de todos modos) y se
 * extrae el código para que el rastreo funcione.
 */
export function resolveTrackingParam(raw: string): string {
  const value = raw.trim();
  if (/^[A-Z]{3}-\d{4}-\d{6,}$/.test(value)) return value;

  const fromToken = trackingCodeFromQrToken(value);
  if (fromToken) return fromToken;

  // Entrada tecleada a mano o inesperada: se normaliza a mayúsculas.
  return value.toUpperCase();
}

/** `base64url(codigo.epoch.firma)` -> código de rastreo, o `null`. */
export function trackingCodeFromQrToken(input: string): string | null {
  try {
    const standard = input.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(standard);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const code = decoded.split('.')[0] ?? '';
    return /^[A-Z]{3}-\d{4}-\d{6,}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}
