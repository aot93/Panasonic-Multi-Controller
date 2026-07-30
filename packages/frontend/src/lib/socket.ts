import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@ppc/shared';

/**
 * One Socket.io connection for the whole app's lifetime, lazily created.
 * Multiple components (the grid, a manual "refresh" button, etc) all need to
 * emit/listen on the same connection rather than each opening their own.
 */
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  socket ??= io();
  return socket;
}
