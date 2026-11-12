import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Conserva el cuerpo crudo de la peticion.
 *
 * Existe por una razon muy concreta: la verificacion de firma de
 * Stripe y de los transportistas se calcula sobre los BYTES EXACTOS
 * que envio el proveedor.
 *
 * Si Fastify parsea el JSON y despues hay que re-serializarlo para
 * calcular el HMAC, el resultado puede diferir del original por el
 * orden de las claves, espacios o caracteres escapados, y la
 * verificacion falla siempre aunque la firma sea correcta.
 *
 * Por eso las rutas de webhook piden `config: { rawBody: true }` y
 * reciben `req.rawBody` como Buffer, sin parsear.
 *
 * LIMITE DE TAMANO (seguridad): acumular el cuerpo entero en memoria
 * en una ruta publica sin autenticacion permitia a cualquiera tumbar
 * el proceso con bodies gigantes (OOM). Se corta la lectura en cuanto
 * se supera el maximo y se responde 413.
 */

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

/** Un webhook legito nunca supera unos pocos KB. */
const RAW_BODY_MAX_BYTES = 1024 * 1024; // 1 MB

/**
 * Error de 413 con el formato que entiende `errorHandlerPlugin`
 * (statusCode + code). Se lanza en lugar de responder a mano para que
 * el manejador global lo normalice igual que cualquier otro error.
 */
function rawBodyTooLarge(maxBytes: number): Error {
  const error = new Error(
    `El cuerpo del webhook supera el maximo de ${Math.floor(maxBytes / 1024)} KB`,
  );
  return Object.assign(error, {
    statusCode: 413,
    code: 'RAW_BODY_TOO_LARGE',
  });
}

export const rawBodyPlugin = fp(
  async (app: FastifyInstance, options: { global?: boolean; maxBytes?: number } = {}) => {
    const global = options.global ?? false;
    const maxBytes = options.maxBytes ?? RAW_BODY_MAX_BYTES;

    app.addHook(
      'preParsing',
      async (req: FastifyRequest, _reply, payload: unknown) => {
        const wantsRawBody =
          global || (req.routeOptions?.config as { rawBody?: boolean } | undefined)?.rawBody === true;

        if (!wantsRawBody) return payload;

        // Corte temprano si el cliente declara mas bytes de los
        // permitidos: evita leer el stream para nada.
        const declaredLength = Number(req.headers['content-length'] ?? 0);
        if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
          throw rawBodyTooLarge(maxBytes);
        }

        const chunks: Buffer[] = [];
        let total = 0;

        for await (const chunk of payload as AsyncIterable<Buffer>) {
          const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          total += piece.length;

          // Se corta la lectura en cuanto se supera el maximo: el
          // cliente no puede seguir llenando memoria del proceso.
          if (total > maxBytes) {
            throw rawBodyTooLarge(maxBytes);
          }

          chunks.push(piece);
        }

        const raw = Buffer.concat(chunks);
        req.rawBody = raw;

        // Se devuelve un stream nuevo con el mismo contenido para que el
        // parser de JSON siga funcionando con normalidad.
        const { Readable } = await import('node:stream');
        return Readable.from(raw);
      },
    );
  },
  { name: 'raw-body' },
);
