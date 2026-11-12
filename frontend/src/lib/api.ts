import type { ApiErrorBody } from './types';

/**
 * CLIENTE HTTP
 *
 * Un `fetch` envuelto con tres responsabilidades:
 *
 *  1. Adjuntar el `Authorization: Bearer <access token>`.
 *  2. Si el backend responde 401 (token vencido), renovarlo con
 *     `POST /api/auth/refresh` y reintentar la peticion original UNA vez.
 *     Varias peticiones simultaneas comparten una sola renovacion
 *     (`refreshPromise`) para no gastar la familia de refresh tokens.
 *  3. Traducir el error estandar `{error:{code,message,details}}` del
 *     backend en una excepcion con un mensaje listo para mostrar.
 *
 * El refresh token vive SOLO en cookie httpOnly `hossana_rt` que fija el
 * backend (camino principal). Ya no se copia a localStorage: esto evita
 * que una vulnerabilidad XSS robe el token de renovacion ademas de la
 * cookie. El login sigue renovandose via cookie; si el navegador descarta
 * la cookie, la sesion expira naturalmente.
 */

const ACCESS_KEY = 'hossana_access_token';

/** Token de refresh en memoria para la sesion actual. No persiste en
 * localStorage: se actualiza cada vez que el backend emite uno nuevo
 * (durante el refresh o logout). */
let accessToken: string | null = null;
let refreshToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

/** Error de la API con codigo y estado HTTP para poder reaccionar. */
export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, code = 'UNKNOWN', details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  if (token) localStorage.setItem(ACCESS_KEY, token);
  else localStorage.removeItem(ACCESS_KEY);
}

export function setRefreshToken(token: string | null): void {
  refreshToken = token;
  // Ya no guardamos copia en localStorage.
}

export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}

export interface ApiOptions extends Omit<RequestInit, 'body' | 'headers'> {
  /** Cuerpo JSON: se serializa y se agrega el Content-Type solo. */
  json?: unknown;
  headers?: Record<string, string>;
}

/**
 * Llamada generica a la API. `path` es relativo (`/api/...`) para que
 * el proxy de Vite se encargue de llegar al backend.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { json, headers, ...rest } = options;

  const send = (): Promise<Response> =>
    fetch(path, {
      credentials: 'include',
      ...rest,
      headers: {
        Accept: 'application/json',
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...headers,
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });

  let response = await send();

  if (response.status === 401 && path !== '/api/auth/refresh') {
    const renewed = await refreshAccessToken();
    if (renewed) response = await send();
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    const message =
      body && typeof body === 'object' && body.error
        ? body.error.message
        : `El servidor respondio con error ${response.status}`;
    throw new ApiRequestError(message, response.status, body?.error?.code, body?.error?.details);
  }

  return payload as T;
}

/**
 * Envio de formularios multipart (comprobantes de pago). Igual que
 * `api`, pero sin fijar Content-Type: el navegador agrega el boundary.
 */
export async function apiForm<T>(
  path: string,
  formData: FormData,
  method: 'POST' | 'PATCH' = 'POST',
): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(path, {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: formData,
    });

  let response = await send();
  if (response.status === 401) {
    const renewed = await refreshAccessToken();
    if (renewed) response = await send();
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const body = payload as ApiErrorBody | null;
    const message =
      body && typeof body === 'object' && body.error
        ? body.error.message
        : `El servidor respondio con error ${response.status}`;
    throw new ApiRequestError(message, response.status, body?.error?.code, body?.error?.details);
  }

  return payload as T;
}

/** Descarga un archivo privado (comprobantes) con el token adjunto. */
export async function apiBlob(path: string): Promise<Blob> {
  const send = (): Promise<Response> =>
    fetch(path, {
      credentials: 'include',
      headers: {
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

  let response = await send();
  if (response.status === 401) {
    const renewed = await refreshAccessToken();
    if (renewed) response = await send();
  }

  if (!response.ok) {
    let message = `El servidor respondio con error ${response.status}`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Sin JSON: se conserva el mensaje generico.
    }
    throw new ApiRequestError(message, response.status);
  }

  return response.blob();
}

/**
 * Renueva el access token. Comparte una unica promesa entre todas las
 * peticiones concurrentes que se encuentren un 401 al mismo tiempo.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = performRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function performRefresh(): Promise<boolean> {
  // 1) Con la cookie httpOnly (el navegador la adjunta solo).
  if (await tryRefresh(undefined)) return true;
  // 2) Ya no hay respaldo en localStorage: solo la cookie.
  return false;
}

async function tryRefresh(bodyToken: string | undefined): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: bodyToken ? JSON.stringify({ refreshToken: bodyToken }) : {},
    });

    if (!response.ok) return false;

    const data = (await response.json()) as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!data.accessToken) return false;

    setAccessToken(data.accessToken);
    // Rotacion: el backend devuelve un refresh token nuevo; hay que
    // guardarlo o la siguiente renovacion usara uno ya revocado.
    if (data.refreshToken) setRefreshToken(data.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cierra la sesion en el backend (revoca el refresh token) y limpia
 * los tokens locales aunque la peticion falle (red caida).
 *
 * Nota: `POST /api/auth/logout` lee el refresh token de la cookie o
 * del header `x-refresh-token`, por eso lo mandamos en el header.
 */
export async function logoutRequest(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(refreshToken ? { 'x-refresh-token': refreshToken } : {}),
      },
    });
  } catch {
    // Sin red igual cortamos la sesion local.
  }
  clearTokens();
}