import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { getAccessToken } from './api';
import type { RealtimeShipmentEvent } from './types';

/**
 * TIEMPO REAL (Socket.IO)
 *
 * El backend emite dos eventos por sala `shipment:<trackingCode>`:
 *   shipment:event  -> {type, trackingCode, event:{id,sequence,status,title,occurredAt}}
 *   shipment:status -> {type, trackingCode, status, at}
 *
 * Para entrar a la sala el cliente emite `track:join` con
 * `{trackingCode, level}` donde `level` es `'public'` (sin sesión)
 * o `'full'` (sesión iniciada). El backend valida el token del
 * handshake cuando `level === 'full'`.
 */

export interface LiveTimelineItem {
  id: string;
  sequence: number;
  status: string;
  title: string | null;
  occurredAt: string;
}

/**
 * Se conecta a la sala de un envío y devuelve los hitos que aparecen
 * en tiempo real. No pide nada por HTTP: solo escucha.
 *
 * - `authenticated = true` adjunta el access token y pide `level: full`.
 * - Se desconecta al desmontar o si cambia el `trackingCode`.
 * - Los eventos no duplican IDs ya presentes (`seenIds`).
 */
export function useTrackRealtime(
  trackingCode: string | null,
  options: { authenticated?: boolean } = {},
): LiveTimelineItem[] {
  const { authenticated = false } = options;
  const [liveItems, setLiveItems] = useState<LiveTimelineItem[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setLiveItems([]);
    seenIds.current.clear();
    if (!trackingCode) return;

    let cancelled = false;
    const token = authenticated ? getAccessToken() : null;

    const socket: Socket = io(undefined, {
      path: '/ws',
      transports: ['websocket', 'polling'],
      auth: token ? { token } : undefined,
    });

    const join = () => {
      socket.emit('track:join', {
        trackingCode,
        level: authenticated ? 'full' : 'public',
      });
    };
    socket.on('connect', join);

    socket.on('shipment:event', (message: RealtimeShipmentEvent) => {
      if (cancelled) return;
      if (message.trackingCode !== trackingCode) return;
      if (seenIds.current.has(message.event.id)) return;
      seenIds.current.add(message.event.id);
      setLiveItems((previous) => [...previous, message.event]);
    });

    socket.on(
      'connect_error',
      // Las desconexiones silenciosas no deben tumbar la página: si el
      // socket no responde, la pantalla sigue valiendo con los datos HTTP.
      () => socket.disconnect(),
    );

    return () => {
      cancelled = true;
      socket.emit('track:leave', { trackingCode });
      socket.disconnect();
    };
  }, [trackingCode, authenticated]);

  return liveItems;
}