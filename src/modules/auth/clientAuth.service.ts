import { randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { env } from '../../config/env.js';
import { AppError, conflict, unauthorized, validationError } from '../../lib/errors.js';
import { recordAudit } from '../../lib/audit.js';
import { encryptPII, hmacSign, hmacVerify, numericCode, safeEqual, sha256 } from '../../lib/crypto.js';
import { hashPassword } from './service.js';
import { issueRefreshToken, phoneIndex, signAccessToken } from './tokens.js';
import { sendEmail, buildVerificationEmail } from '../notifications/email.js';
import type { ClientCompleteInput } from './schema.js';
import type { FastifyRequest } from 'fastify';

/**
 * REGISTRO DE CLIENTES (PORTAL PUBLICO)
 * =====================================
 *
 * Flujo en tres pasos, pensado para no crear cuentas con correos que
 * el solicitante no controla:
 *
 *   1. `startRegistration(email)`  -> genera un OTP numerico de 6
 *      digitos y lo envia por correo.
 *   2. `verifyRegistrationOtp`     -> valida el codigo y marca el
 *      correo como verificado.
 *   3. `completeRegistration`      -> crea la cuenta (rol SENDER) y
 *      devuelve una sesion iniciada.
 *
 * Decisiones de seguridad:
 *  - El codigo se guarda HASHEADO (sha256), nunca en claro.
 *  - Caduca a los 10 minutos y admite un maximo de intentos.
 *  - Hay un cooldown entre reenvios para frenar el spam de correos.
 */

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * El token de registro vive lo justo para cruzar de la pantalla de
 * verificacion a la de datos: 15 minutos desde que se verifica el OTP.
 */
const REGISTRATION_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Token firmado de un solo uso que `verifyRegistrationOtp` entrega SOLO
 * al cliente que presento el codigo correcto.
 *
 * Por que hace falta: sin el, cualquiera que conociera el correo poda
 * llamar a `complete` dentro de la ventana de validez del OTP y crear
 * la cuenta con SU contrasena antes que el dueno real del correo. Con
 * el token, completar el registro exige haber visto el OTP (es decir,
 * controlar el correo).
 *
 * Formato: `base64url(JSON).hmac` firmado con el secreto del servidor;
 * ata el id del registro OTP verificado y el correo, y expira solo.
 */
function signRegistrationToken(recordId: string, email: string): string {
  const payload = Buffer.from(
    JSON.stringify({ rid: recordId, email, exp: Date.now() + REGISTRATION_TOKEN_TTL_MS }),
    'utf8',
  ).toString('base64url');
  return `${payload}.${hmacSign(payload, env.jwtSecret)}`;
}

/** Valida firma, vigencia y que el token corresponda a ESTE registro. */
function verifyRegistrationToken(token: unknown, recordId: string, email: string): boolean {
  if (typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!hmacVerify(payload, signature, env.jwtSecret)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      rid?: unknown;
      email?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) return false;
    if (typeof parsed.rid !== 'string' || typeof parsed.email !== 'string') return false;
    return safeEqual(parsed.rid, recordId) && parsed.email === email;
  } catch {
    return false;
  }
}

export interface ClientSession {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    roles: UserRole[];
    status: string;
    locale: string;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    createdAt: Date;
  };
}

export interface StartRegistrationResult {
  email: string;
  expiresAt: Date;
  /** Solo en desarrollo: en produccion el codigo viaja por correo. */
  devCode?: string;
}

async function assertEmailIsFree(email: string): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw conflict('Ya existe una cuenta con ese correo electronico');
  }
}

/** Crea un OTP nuevo (invalidando los previos) y lo envia por correo. */
async function issueEmailOtp(email: string, req?: FastifyRequest): Promise<StartRegistrationResult> {
  const recent = await prisma.emailVerificationOtp.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (recent) {
    const elapsed = Date.now() - recent.createdAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new AppError(
        'RATE_LIMITED',
        `Espera ${retryAfter} segundo(s) antes de solicitar otro codigo`,
        429,
        { details: { retryAfter } },
      );
    }
    // Invalida el anterior: un codigo nuevo reemplaza al viejo.
    await prisma.emailVerificationOtp.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    });
  }

  const code = numericCode(6);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.emailVerificationOtp.create({
    data: {
      email,
      otpHash: sha256(code),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt,
    },
  });

  await sendEmail({
    to: email,
    subject: 'Tu codigo de verificacion de Hossana',
    text: buildVerificationEmail(code),
  });

  await recordAudit(
    { action: 'CLIENT_REGISTER_OTP_SENT', entity: 'User', metadata: { email } },
    req,
  );

  return {
    email,
    expiresAt,
    devCode: process.env.NODE_ENV === 'production' ? undefined : code,
  };
}

export async function startRegistration(
  email: string,
  req?: FastifyRequest,
): Promise<StartRegistrationResult> {
  await assertEmailIsFree(email);
  return issueEmailOtp(email, req);
}

export async function resendRegistrationOtp(
  email: string,
  req?: FastifyRequest,
): Promise<StartRegistrationResult> {
  // Si el correo ya tiene cuenta, se sigue el mismo camino de error que
  // en el alta: es informacion que el propio usuario ya conoce.
  await assertEmailIsFree(email);
  return issueEmailOtp(email, req);
}

/**
 * Verifica el OTP. Cuenta intentos para frenar la fuerza bruta sobre un
 * codigo de 6 digitos. Si es correcto, marca el correo como verificado
 * (aun NO crea la cuenta: eso pasa en `completeRegistration`).
 */
export async function verifyRegistrationOtp(
  email: string,
  otp: string,
  req?: FastifyRequest,
): Promise<{ verified: boolean; registrationToken: string }> {
  const record = await prisma.emailVerificationOtp.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    throw validationError('No hay una solicitud de registro activa para este correo');
  }

  if (record.attempts >= record.maxAttempts) {
    await prisma.emailVerificationOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new AppError(
      'OTP_INVALID',
      'Se agotaron los intentos. Solicita un nuevo codigo.',
      400,
    );
  }

  if (record.expiresAt < new Date()) {
    throw new AppError('OTP_EXPIRED', 'El codigo expiro, solicita uno nuevo', 410);
  }

  if (sha256(otp) !== record.otpHash) {
    await prisma.emailVerificationOtp.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError('OTP_INVALID', 'El codigo de verificacion no coincide', 400);
  }

  await prisma.emailVerificationOtp.update({
    where: { id: record.id },
    data: { verified: true },
  });

  await recordAudit(
    { action: 'CLIENT_REGISTER_OTP_VERIFIED', entity: 'User', metadata: { email } },
    req,
  );

  // El token se entrega UNICAMENTE a quien presento el codigo correcto:
  // sin el no se puede completar el registro, aunque se conozca el correo.
  return { verified: true, registrationToken: signRegistrationToken(record.id, email) };
}

/**
 * Crea la cuenta tras verificar el correo. Consume el OTP verificado,
 * crea el usuario con rol SENDER y devuelve una sesion ya iniciada para
 * que el cliente entre directo a su panel.
 */
export async function completeRegistration(
  input: ClientCompleteInput,
  context: { userAgent?: string | null; ip?: string | null } = {},
  req?: FastifyRequest,
): Promise<ClientSession> {
  const record = await prisma.emailVerificationOtp.findFirst({
    where: { email: input.email, consumedAt: null, verified: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date()) {
    throw unauthorized('Debes verificar tu correo antes de crear la cuenta');
  }

  // Venta de seguridad: el registro solo lo completa quien recibio el
  // token al verificar el OTP. Conocer el correo no basta.
  if (!verifyRegistrationToken(input.registrationToken, record.id, input.email)) {
    await recordAudit(
      {
        action: 'CLIENT_REGISTER_COMPLETE_DENIED',
        entity: 'User',
        outcome: 'DENIED',
        metadata: { email: input.email },
      },
      req,
    );
    throw unauthorized('Sesion de registro invalida: verifica tu correo de nuevo');
  }

  await assertEmailIsFree(input.email);

  const passwordHash = await hashPassword(input.password);
  const familyId = randomUUID();

  const user = await prisma.$transaction(async (tx) => {
    // Consume el OTP dentro de la misma transaccion: si la creacion
    // falla, el codigo sigue siendo valido para reintentar.
    await tx.emailVerificationOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });

    return tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        roles: ['SENDER'],
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        // El telefono se guarda cifrado (AES-GCM) mas su indice de
        // busqueda (HMAC): el hash solo sirve para buscar, no para
        // enviar mensajes.
        ...(input.phone
          ? { phoneCipher: encryptPII(input.phone), phoneHash: phoneIndex(input.phone) }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        roles: true,
        status: true,
        locale: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        createdAt: true,
      },
    });
  });

  const [access, refresh] = await Promise.all([
    Promise.resolve(signAccessToken(user)),
    issueRefreshToken(user.id, familyId, context),
  ]);

  await recordAudit(
    { userId: user.id, action: 'CLIENT_REGISTER_COMPLETED', entity: 'User', entityId: user.id },
    req,
  );

  logger.info({ userId: user.id }, 'Cliente registrado y verificado');

  return {
    accessToken: access.token,
    refreshToken: refresh.token,
    expiresInSeconds: access.expiresInSeconds,
    user,
  };
}
