import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import {
  clientCompleteSchema,
  clientRegisterSchema,
  clientResendOtpSchema,
  clientVerifyOtpSchema,
} from '../modules/auth/schema.js';
import * as clientAuth from '../modules/auth/clientAuth.service.js';

/**
 * RUTAS DE REGISTRO DE CLIENTES (portal publico)
 *
 * Prefijo: /api/auth/client
 *
 * El flujo no crea la cuenta hasta que se verifica el correo con el
 * codigo OTP. Por eso el registro se parte en tres endpoints.
 */

const REFRESH_COOKIE = 'hossana_rt';

function contextOf(req: FastifyRequest) {
  return { userAgent: req.headers['user-agent'] ?? null, ip: req.ip };
}

function setRefreshCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(REFRESH_COOKIE, token, {
    path: '/api/auth',
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? 'lax' : 'none',
    maxAge: Math.floor(env.jwtRefreshTtlMs / 1000),
  });
}

export async function clientAuthRoutes(app: FastifyInstance): Promise<void> {
  // ── 1. Solicitar registro (solo correo) ───────────────────
  app.post(
    '/register',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Solicita el registro de un cliente (envia un codigo al correo)',
      },
    },
    async (req) => {
      const input = clientRegisterSchema.parse(req.body);
      const result = await clientAuth.startRegistration(input.email, req);
      return {
        email: result.email,
        expiresAt: result.expiresAt,
        message: 'Te enviamos un codigo de verificacion a tu correo.',
        ...(result.devCode ? { devCode: result.devCode } : {}),
      };
    },
  );

  // ── 2. Reenviar codigo ────────────────────────────────────
  app.post(
    '/resend-otp',
    {
      config: { rateLimit: { max: 3, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Reenvia el codigo de verificacion',
      },
    },
    async (req) => {
      const input = clientResendOtpSchema.parse(req.body);
      const result = await clientAuth.resendRegistrationOtp(input.email, req);
      return {
        email: result.email,
        expiresAt: result.expiresAt,
        message: 'Codigo reenviado.',
        ...(result.devCode ? { devCode: result.devCode } : {}),
      };
    },
  );

  // ── 3. Verificar codigo ───────────────────────────────────
  app.post(
    '/verify-email',
    {
      config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Verifica el codigo numerico enviado al correo',
      },
    },
    async (req) => {
      const input = clientVerifyOtpSchema.parse(req.body);
      const result = await clientAuth.verifyRegistrationOtp(input.email, input.otp, req);
      return {
        verified: true,
        // Necesario para el paso final: prueba que quien llama vio el
        // codigo del correo. Se guarda en sessionStorage y se envia en
        // el /complete.
        registrationToken: result.registrationToken,
        message: 'Correo verificado. Ya puedes crear tu cuenta.',
      };
    },
  );

  // ── 4. Completar cuenta (crea usuario SENDER + sesion) ────
  app.post(
    '/complete',
    {
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
      schema: {
        tags: ['auth'],
        summary: 'Crea la cuenta de cliente tras verificar el correo',
      },
    },
    async (req, reply) => {
      const input = clientCompleteSchema.parse(req.body);
      const session = await clientAuth.completeRegistration(input, contextOf(req), req);
      setRefreshCookie(reply, session.refreshToken);
      return reply.status(201).send({
        accessToken: session.accessToken,
        expiresIn: session.expiresInSeconds,
        user: session.user,
        refreshToken: session.refreshToken,
      });
    },
  );
}
