import type { Socket } from 'node:net';
import { TERMINATOR } from '@ppc/shared';
import { NtControlProtocolError, NtControlTimeoutError } from './types.js';

/**
 * Buffers bytes off a socket and hands back one CR-terminated frame at a
 * time, CR stripped. Both the banner and every command response use this
 * same framing, so the client uses one reader instance per connection for
 * both.
 */
export class FrameReader {
  private buffer = '';
  private pending: {
    resolve: (frame: string) => void;
    reject: (err: Error) => void;
    timeoutHandle: ReturnType<typeof setTimeout>;
  } | null = null;
  private closed = false;
  private closeError: Error | null = null;

  constructor(socket: Socket) {
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (err: Error) => this.onSocketDone(err));
    socket.on('close', () => this.onSocketDone(null));
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('ascii');
    this.tryResolvePending();
  }

  private onSocketDone(err: Error | null): void {
    this.closed = true;
    this.closeError = err;
    if (this.pending) {
      clearTimeout(this.pending.timeoutHandle);
      const { reject } = this.pending;
      this.pending = null;
      reject(
        err
          ? new NtControlProtocolError(`Connection error while waiting for a frame: ${err.message}`, err)
          : new NtControlProtocolError('Connection closed before a complete frame was received'),
      );
    }
  }

  private tryResolvePending(): void {
    if (!this.pending) return;
    const idx = this.buffer.indexOf(TERMINATOR);
    if (idx === -1) return;

    const frame = this.buffer.slice(0, idx);
    this.buffer = this.buffer.slice(idx + 1);

    clearTimeout(this.pending.timeoutHandle);
    const { resolve } = this.pending;
    this.pending = null;
    resolve(frame);
  }

  /** Resolves with the next CR-terminated frame, CR excluded. */
  readFrame(timeoutMs: number): Promise<string> {
    if (this.pending) {
      throw new NtControlProtocolError('readFrame() called while a previous read is still pending');
    }

    // A frame may already be sitting in the buffer (e.g. it arrived in the
    // same TCP segment as a previous one) — checked before installing a
    // waiter so we never leave data unclaimed.
    const idx = this.buffer.indexOf(TERMINATOR);
    if (idx !== -1) {
      const frame = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      return Promise.resolve(frame);
    }

    if (this.closed) {
      return Promise.reject(
        this.closeError
          ? new NtControlProtocolError(`Connection error: ${this.closeError.message}`, this.closeError)
          : new NtControlProtocolError('Connection already closed'),
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending = null;
        reject(new NtControlTimeoutError(`Timed out after ${timeoutMs}ms waiting for a response`));
      }, timeoutMs);
      this.pending = { resolve, reject, timeoutHandle };
    });
  }
}
