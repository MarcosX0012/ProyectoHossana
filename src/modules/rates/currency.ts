import { env } from '../../config/env.js';

/**
 * CONVERSION DE MONEDA
 * ====================
 *
 * Hossana publica sus tarifas en cordobas y muestra el equivalente en
 * dolares. El tipo de cambio es una sola constante configurable
 * (`USD_EXCHANGE_RATE_NIO`), no una tabla de precios paralela: asi el
 * tarifario nunca queda desincronizado.
 *
 * Los montos se guardan en centavos. La conversion se redondea al
 * centavo mas cercano.
 */

export const DEFAULT_NIO_PER_USD = env.USD_EXCHANGE_RATE_NIO;

export function nioPerUsd(rate = DEFAULT_NIO_PER_USD): number {
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_NIO_PER_USD;
}

export function nioCentsToUsdCents(nioCents: number, rate = DEFAULT_NIO_PER_USD): number {
  return Math.round(nioCents / nioPerUsd(rate));
}

export function usdCentsToNioCents(usdCents: number, rate = DEFAULT_NIO_PER_USD): number {
  return Math.round(usdCents * nioPerUsd(rate));
}

/** Formato compacto para respuestas de API y mensajes de error. */
export function formatCents(amountCents: number, currency: string): string {
  const symbol = currency.toUpperCase() === 'USD' ? 'US$' : 'C$';
  return `${symbol} ${(amountCents / 100).toFixed(2)}`;
}
