import { createConnection, type Socket } from 'node:net';
import { NTCONTROL_PORT, type ProtectMode } from '@ppc/shared';
import { FrameReader } from './frame-reader.js';
import { buildCommandFrame, handshake, parseResponseFrame } from './framing.js';
import {
  NtControlProtocolError,
  NtControlTimeoutError,
  type NtControlClientOptions,
  type NtControlCredentials,
  type NtControlResult,
} from './types.js';

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_COMMAND_TIMEOUT_MS = 5000;

function connectSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });

    const cleanup = () => {
      socket.removeListener('error', onError);
      socket.removeListener('timeout', onTimeout);
      socket.removeListener('connect', onConnect);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(new NtControlProtocolError(`Could not connect to ${host}:${port} — ${err.message}`, err));
    };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new NtControlTimeoutError(`Timed out connecting to ${host}:${port} after ${timeoutMs}ms`));
    };
    const onConnect = () => {
      cleanup();
      // Connect-phase timeout served its purpose; per-read timeouts take over
      // once FrameReader is attached.
      socket.setTimeout(0);
      resolve(socket);
    };

    socket.setTimeout(timeoutMs);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
    socket.once('connect', onConnect);
  });
}

/**
 * One open NTCONTROL connection, handshaked and ready to send commands.
 *
 * The projector's default behaviour is to close the socket after every
 * single command/response — see docs/protocol-notes.md "Session behavior".
 * A session stays open only as long as the caller keeps it open and the
 * projector's own [COMMAND SESSION PROLONG] setting allows; nothing here
 * assumes reuse will work indefinitely. Use `sendOnce()` below unless the
 * caller specifically wants to pipeline several commands and is prepared for
 * the projector to hang up between them anyway.
 */
export class NtControlSession {
  private closed = false;

  private constructor(
    private readonly socket: Socket,
    private readonly reader: FrameReader,
    private readonly authHash: string | null,
    readonly protectMode: ProtectMode,
    private readonly commandTimeoutMs: number,
  ) {}

  static async open(options: NtControlClientOptions): Promise<NtControlSession> {
    const port = options.port ?? NTCONTROL_PORT;
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;

    const socket = await connectSocket(options.host, port, connectTimeoutMs);
    const reader = new FrameReader(socket);

    let banner: string;
    try {
      banner = await reader.readFrame(connectTimeoutMs);
    } catch (err) {
      socket.destroy();
      throw err;
    }

    let authHash: string | null;
    let protectMode: ProtectMode;
    try {
      const result = handshake(banner, options.credentials);
      authHash = result.authHash;
      protectMode = result.protectMode;
    } catch (err) {
      socket.destroy();
      throw new NtControlProtocolError((err as Error).message, err);
    }

    return new NtControlSession(socket, reader, authHash, protectMode, commandTimeoutMs);
  }

  /** Sends one command body (no device-ID prefix, no CR) and returns the parsed result. */
  async send(body: string): Promise<NtControlResult> {
    if (this.closed) {
      throw new NtControlProtocolError('Cannot send on a closed NtControlSession');
    }
    const frame = buildCommandFrame(body, this.authHash);
    this.socket.write(frame, 'ascii');
    const responseFrame = await this.reader.readFrame(this.commandTimeoutMs);
    return parseResponseFrame(responseFrame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
    this.socket.destroy();
  }
}

/**
 * Opens a connection, sends exactly one command, and closes — matching the
 * projector's default (COMMAND SESSION PROLONG = 0SEC) behaviour. This is
 * the right default for the phase 3 poller and for one-off dispatch: no
 * assumption is made that the socket will still be usable a moment later.
 */
export async function sendOnce(options: NtControlClientOptions, body: string): Promise<NtControlResult> {
  const session = await NtControlSession.open(options);
  try {
    return await session.send(body);
  } finally {
    session.close();
  }
}

export type { NtControlClientOptions, NtControlCredentials, NtControlResult };
