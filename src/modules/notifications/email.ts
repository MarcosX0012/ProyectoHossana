import { createTransport } from 'nodemailer';
import type { Mail, SMTPSentMessageInfo, SMTPTransportOptions } from 'nodemailer';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

/**
 * CORREO SALIENTE
 * ===============
 *
 * Se usa para la verificacion de cuentas de cliente: el sistema envia
 * un codigo OTP numerico al correo que el usuario quiere registrar.
 *
 * Por que un modulo aparte y no llamar a un proveedor directo: el
 * resto del sistema no debe saber si el correo sale por SMTP, por una
 * API transaccional o si en desarrollo solo se registra en el log.
 * Aqui se decide el COMO; los servicios solo piden "envia esto".
 *
 * Modos (EMAIL_PROVIDER):
 *  - 'log' (o EMAIL_ENABLED=false): el correo se registra en el log.
 *    Suficiente para desarrollo y pruebas automatizadas.
 *  - 'api' + EMAIL_API_URL/EMAIL_API_KEY: POST JSON al proveedor
 *    transaccional.
 *  - 'smtp': envio directo por SMTP con nodemailer. Configurado para
 *    Gmail con una contrasena de aplicacion (EMAIL_SMTP_PASS).
 *
 * Las credenciales salen de las variables EMAIL_* del .env. Cambiarlas
 * exige reiniciar la API: tsx recarga el codigo, no el entorno.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SentEmail {
  delivered: boolean;
  providerMessageId: string | null;
}

/**
 * Conexion SMTP reutilizable. Se crea una sola vez y se guarda: abrir
 * la conexion en cada envio haria lento el registro de clientes.
 */
let smtpTransport: Mail<SMTPSentMessageInfo, SMTPTransportOptions> | undefined;

function getSmtpTransport(): Mail<SMTPSentMessageInfo, SMTPTransportOptions> {
  if (smtpTransport) return smtpTransport;
  smtpTransport = createTransport({
    host: env.EMAIL_SMTP_HOST,
    port: env.EMAIL_SMTP_PORT,
    secure: env.EMAIL_SMTP_SECURE,
    auth: { user: env.EMAIL_SMTP_USER, pass: env.EMAIL_SMTP_PASS },
  });
  return smtpTransport;
}

export async function sendEmail(email: OutgoingEmail): Promise<SentEmail> {
  const useSmtp = env.EMAIL_ENABLED && env.EMAIL_PROVIDER === 'smtp';
  const useApi = env.EMAIL_ENABLED && env.EMAIL_PROVIDER === 'api' && Boolean(env.EMAIL_API_URL);

  if (!useSmtp && !useApi) {
    // Desarrollo o EMAIL_PROVIDER=log: no hay proveedor configurado. El
    // codigo queda en el log para poder completar el flujo manualmente.
    logger.info(
      { to: email.to, subject: email.subject },
      `Correo (modo desarrollo, no enviado): ${email.text}`,
    );
    return { delivered: false, providerMessageId: null };
  }

  if (useSmtp) return sendViaSmtp(email);

  const response = await fetch(env.EMAIL_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.EMAIL_API_KEY ? { Authorization: `Bearer ${env.EMAIL_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html ?? undefined,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    logger.error({ status: response.status, body: text.slice(0, 500) }, 'Correo: envio fallido');
    throw new Error(`El proveedor de correo respondio ${response.status}`);
  }

  const result = (await response.json().catch(() => ({}))) as { id?: string; messageId?: string };
  const providerMessageId = result.id ?? result.messageId ?? null;

  logger.info({ to: email.to, providerMessageId }, 'Correo enviado');
  return { delivered: true, providerMessageId };
}

/** Envio por SMTP (Gmail u otro servidor configurado en EMAIL_SMTP_*). */
async function sendViaSmtp(email: OutgoingEmail): Promise<SentEmail> {
  try {
    const info = await getSmtpTransport().sendMail({
      from: env.EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    const providerMessageId = info.messageId ?? null;
    logger.info({ to: email.to, providerMessageId }, 'Correo enviado (SMTP)');
    return { delivered: true, providerMessageId };
  } catch (error) {
    // El detalle del servidor (por ejemplo "Username and Password not
    // accepted") solo va al log: al cliente no se le expone.
    logger.error({ to: email.to, err: error }, 'Correo: envio SMTP fallido');
    throw new Error('No se pudo enviar el correo');
  }
}

/** Correo con el codigo de verificacion de cuenta. */
export function buildVerificationEmail(code: string): OutgoingEmail['text'] {
  return [
    'Hossana · Verificacion de cuenta',
    '',
    `Tu codigo de verificacion es: ${code}`,
    '',
    'El codigo vence en 10 minutos. Si no solicitaste esta cuenta, ignora este mensaje.',
  ].join('\n');
}

// ── Correos de notificacion ────────────────────────────────────

export interface NotificationEmailInput {
  title: string;
  message: string;
  trackingCode?: string | null;
  statusLabel?: string | null;
  occurredAt?: Date | null;
  estimatedDeliveryAt?: Date | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateEs(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return new Intl.DateTimeFormat('es-NI', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(value);
}

/**
 * Correo generico para avisos del sistema (envios y repartidores).
 *
 * Se construye a partir de datos simples del payload para que el mismo
 * formato sirva para un cambio de estado, una asignacion o una
 * cancelacion sin acoplar el servicio de notificaciones a una plantilla
 * distinta por evento.
 */
export function buildNotificationEmail(input: NotificationEmailInput): OutgoingEmail {
  const subject = ['Hossana', input.title, input.trackingCode]
    .filter(Boolean)
    .join(' · ');

  const occurredAt = formatDateEs(input.occurredAt);
  const estimatedDeliveryAt = formatDateEs(input.estimatedDeliveryAt);
  const actionUrl = input.actionUrl
    ? input.actionUrl.startsWith('http')
      ? input.actionUrl
      : `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}${input.actionUrl.startsWith('/') ? '' : '/'}${input.actionUrl}`
    : null;

  const textLines = [
    `Hossana · ${input.title}`,
    '',
    input.message,
    '',
    input.trackingCode ? `Envio: ${input.trackingCode}` : null,
    input.statusLabel ? `Estado: ${input.statusLabel}` : null,
    occurredAt ? `Fecha: ${occurredAt}` : null,
    estimatedDeliveryAt ? `Entrega estimada: ${estimatedDeliveryAt}` : null,
    actionUrl ? `${input.actionLabel ?? 'Ver en el sistema'}: ${actionUrl}` : null,
    '',
    'Hossana · Sistema de rastreo de envios',
  ].filter((line): line is string => line !== null);

  const rows = (
    [
      input.trackingCode ? ['Envio', input.trackingCode] : null,
      input.statusLabel ? ['Estado', input.statusLabel] : null,
      occurredAt ? ['Fecha', occurredAt] : null,
      estimatedDeliveryAt ? ['Entrega estimada', estimatedDeliveryAt] : null,
    ] as Array<[string, string] | null>
  ).filter((row): row is [string, string] => row !== null);

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.55; max-width: 560px;">
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #1e293b;">${escapeHtml(input.title)}</h2>
      <p style="margin: 0 0 16px;">${escapeHtml(input.message)}</p>
      ${
        rows.length
          ? `<table style="border-collapse: collapse; margin: 0 0 16px; font-size: 14px;">
              ${rows
                .map(
                  ([label, value]) =>
                    `<tr><td style="padding: 4px 16px 4px 0; color: #64748b;">${escapeHtml(label)}</td><td style="padding: 4px 0; color: #0f172a; font-weight: 600;">${escapeHtml(value)}</td></tr>`,
                )
                .join('')}
            </table>`
          : ''
      }
      ${
        actionUrl
          ? `<p style="margin: 20px 0;"><a href="${escapeHtml(actionUrl)}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">${escapeHtml(input.actionLabel ?? 'Ver en el sistema')}</a></p>`
          : ''
      }
      <p style="margin: 24px 0 0; font-size: 12px; color: #64748b;">Hossana · Sistema de rastreo de envios</p>
    </div>
  `.trim();

  return { to: '', subject, text: textLines.join('\n'), html };
}

/** Correo con el OTP que confirma la entrega al receptor. */
export function buildDeliveryOtpEmail(trackingCode: string, code: string): OutgoingEmail {
  const subject = `Hossana · Codigo de entrega · ${trackingCode}`;
  const text = [
    'Hossana · Confirmacion de entrega',
    '',
    `El repartidor esta entregando el envio ${trackingCode}.`,
    `Comparte este codigo solo si recibiste el paquete: ${code}`,
    '',
    'El codigo vence en 10 minutos. Si no esperabas esta entrega, no compartas el codigo.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.55; max-width: 560px;">
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #1e293b;">Confirmacion de entrega</h2>
      <p style="margin: 0 0 12px;">El repartidor esta entregando el envio <strong>${escapeHtml(trackingCode)}</strong>.</p>
      <p style="margin: 0 0 16px;">Comparte este codigo solo si recibiste el paquete:</p>
      <p style="margin: 0 0 16px; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #4f46e5;">${escapeHtml(code)}</p>
      <p style="margin: 0; font-size: 13px; color: #64748b;">El codigo vence en 10 minutos. Si no esperabas esta entrega, no compartas el codigo.</p>
    </div>
  `.trim();

  return { to: '', subject, text, html };
}

/** Correo con el enlace para restablecer la contrasena. */
export function buildPasswordResetEmail(resetToken: string, expiresInMinutes: number): OutgoingEmail {
  const subject = 'Hossana · Restablece tu contrasena';
  const resetUrl = `${env.PUBLIC_WEB_URL.replace(/\/$/, '')}/recuperar?token=${encodeURIComponent(resetToken)}`;
  const text = [
    'Hossana · Recuperacion de contrasena',
    '',
    'Recibimos una solicitud para restablecer la contrasena de tu cuenta.',
    '',
    `Abre este enlace para elegir una nueva contrasena (vence en ${expiresInMinutes} minutos):`,
    resetUrl,
    '',
    'Si no fuiste tu, ignora este mensaje: tu contrasena actual sigue siendo valida.',
  ].join('\n');

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #0f172a; line-height: 1.55; max-width: 560px;">
      <h2 style="margin: 0 0 12px; font-size: 20px; color: #1e293b;">Recuperacion de contrasena</h2>
      <p style="margin: 0 0 16px;">Recibimos una solicitud para restablecer la contrasena de tu cuenta.</p>
      <p style="margin: 20px 0;"><a href="${escapeHtml(resetUrl)}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 10px 16px; border-radius: 6px; display: inline-block;">Elegir nueva contrasena</a></p>
      <p style="margin: 0; font-size: 13px; color: #64748b;">El enlace vence en ${expiresInMinutes} minutos. Si no fuiste tu, ignora este mensaje: tu contrasena actual sigue siendo valida.</p>
    </div>
  `.trim();

  return { to: '', subject, text, html };
}
