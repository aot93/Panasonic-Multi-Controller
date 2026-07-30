import { randomBytes } from 'node:crypto';
import { createServer, type Server, type Socket } from 'node:net';
import { TERMINATOR, type ProtectMode } from '@ppc/shared';
import { computeAuthHash } from './framing.js';

/**
 * A simulated NTCONTROL projector, for exercising the client
 * (packages/backend/src/protocol/client.ts) without real hardware — per the
 * phase 2 brief.
 *
 * Modelling notes / honest limitations:
 *   - The two source PDFs confirm exact wire behaviour for the handshake,
 *     framing, and QUERY responses, but do not document what an EXECUTE-only
 *     command (PON, POF, VSE:n, ...) sends back as an acknowledgement. This
 *     mock echoes the command body back as the ack payload — a reasonable,
 *     commonly-seen convention, but it is a modelling assumption, not a
 *     confirmed protocol fact. Tests should verify execute commands by
 *     re-querying state afterwards (e.g. PON then QPW -> "001"), not by
 *     asserting on the exact ack bytes.
 *   - Lockout tracking is global to the mock instance (not per source IP)
 *     for simplicity — enough to test the client's ERRA/lockout handling.
 */

export interface ProjectorState {
  power: 'on' | 'off';
  shutterClosed: boolean;
  aspect: number;
  screenSetting: number;
  testPattern: string;
  input: string;
  tempIntakeC: number;
  tempIntakeMaxC: number;
  tempExhaustC: number;
  tempExhaustMaxC: number;
  lampHours: number[];
  lampStatus: number;
  runtimeHours: number;
  model: string;
  serial: string;
  /** QVX:VMOI2 raw units — whole volts, confirmed against real hardware (see parseAcVoltage). */
  acVoltageRaw: number;
  /** Simulates a unit whose AC-voltage sensor isn't ready yet — a blank value field, testing the NaN-guard in poll-device.ts. */
  acVoltageMalformed: boolean;
  /** QVX:ERRS1 raw positional field — 'N' per position means normal; set any position to something else to simulate an active (unidentified) condition. */
  errs1: string;
  /** QVX:ERRS2 raw value — a code like "H001", or 'N' for nothing active. */
  errs2: string;
}

const DEFAULT_STATE: ProjectorState = {
  power: 'off',
  shutterClosed: false,
  aspect: 0,
  screenSetting: 0,
  testPattern: '00',
  input: 'HD1',
  tempIntakeC: 30,
  tempIntakeMaxC: 80,
  tempExhaustC: 35,
  tempExhaustMaxC: 80,
  lampHours: [1234],
  lampStatus: 2,
  runtimeHours: 5000,
  model: 'PT-RQ35KD',
  serial: 'SW0101234',
  acVoltageRaw: 230,
  acVoltageMalformed: false,
  errs1: 'N'.repeat(20),
  errs2: 'N',
};

export interface MockProjectorOptions {
  protectMode?: ProtectMode;
  username?: string;
  password?: string;
  /** 0 = disconnect after one command/response, matching the real default. */
  sessionProlongSec?: number;
  lockoutThreshold?: number;
  lockoutSeconds?: number;
  initialState?: Partial<ProjectorState>;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

export class MockProjector {
  readonly state: ProjectorState;
  private readonly server: Server;
  private readonly protectMode: ProtectMode;
  private readonly username: string;
  private readonly password: string;
  private readonly sessionProlongSec: number;
  private readonly lockoutThreshold: number;
  private readonly lockoutSeconds: number;

  private failureCount = 0;
  private lockedUntilMs: number | null = null;
  private _port = 0;

  constructor(options: MockProjectorOptions = {}) {
    this.protectMode = options.protectMode ?? 'md5';
    this.username = options.username ?? 'admin1';
    this.password = options.password ?? 'panasonic';
    this.sessionProlongSec = options.sessionProlongSec ?? 0;
    this.lockoutThreshold = options.lockoutThreshold ?? 3;
    this.lockoutSeconds = options.lockoutSeconds ?? 60;
    this.state = { ...DEFAULT_STATE, ...options.initialState };
    this.server = createServer((socket) => this.onConnection(socket));
  }

  get port(): number {
    return this._port;
  }

  listen(port = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.removeListener('error', reject);
        const addr = this.server.address();
        this._port = typeof addr === 'object' && addr ? addr.port : port;
        resolve(this._port);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  /** Resets the simulated 3-strikes lockout — handy between test cases. */
  resetLockout(): void {
    this.failureCount = 0;
    this.lockedUntilMs = null;
  }

  private onConnection(socket: Socket): void {
    const challenge = randomBytes(4).toString('hex');
    let buffer = '';
    // Once we've decided to hang up (the sessionProlongSec === 0 default),
    // a client can still race a second write in before it sees our FIN —
    // TCP half-close leaves its send direction open. Ignore anything that
    // arrives after that point instead of trying to respond on an ended
    // socket, which is what a real projector's silence would look like too.
    let ending = false;

    const banner =
      this.protectMode === 'none'
        ? 'NTCONTROL 0'
        : `NTCONTROL ${this.protectMode === 'md5' ? '1' : '2'} ${challenge}`;
    socket.write(banner + TERMINATOR, 'ascii');

    socket.on('data', (chunk: Buffer) => {
      if (ending) return;
      buffer += chunk.toString('ascii');
      let idx: number;
      while ((idx = buffer.indexOf(TERMINATOR)) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        this.handleFrame(socket, frame, challenge);

        if (this.sessionProlongSec === 0) {
          ending = true;
          socket.end();
          return;
        }
      }
    });

    // Idle sessions beyond the configured prolong window get dropped, same
    // as a real unit would eventually hang up.
    if (this.sessionProlongSec > 0) {
      socket.setTimeout(this.sessionProlongSec * 1000, () => socket.end());
    }
  }

  private handleFrame(socket: Socket, frame: string, challenge: string): void {
    if (this.lockedUntilMs !== null) {
      const remaining = Math.ceil((this.lockedUntilMs - Date.now()) / 1000);
      if (remaining > 0) {
        socket.write(`ERRA ${remaining}${TERMINATOR}`, 'ascii');
        return;
      }
      this.lockedUntilMs = null;
      this.failureCount = 0;
    }

    let body: string;

    if (this.protectMode === 'none') {
      if (!frame.startsWith('00')) {
        socket.write(`ERR5${TERMINATOR}`, 'ascii');
        return;
      }
      body = frame.slice(2);
    } else {
      const hashLen = this.protectMode === 'md5' ? 32 : 64;
      if (frame.length < hashLen + 2) {
        socket.write(`ERR5${TERMINATOR}`, 'ascii');
        return;
      }
      const clientHash = frame.slice(0, hashLen).toLowerCase();
      const rest = frame.slice(hashLen);
      if (!rest.startsWith('00')) {
        socket.write(`ERR5${TERMINATOR}`, 'ascii');
        return;
      }

      const expected = computeAuthHash(
        { username: this.username, password: this.password },
        challenge,
        this.protectMode,
      );

      if (clientHash !== expected) {
        this.failureCount += 1;
        if (this.failureCount >= this.lockoutThreshold) {
          this.lockedUntilMs = Date.now() + this.lockoutSeconds * 1000;
          socket.write(`ERRA ${this.lockoutSeconds}${TERMINATOR}`, 'ascii');
        } else {
          socket.write(`ERRA${TERMINATOR}`, 'ascii');
        }
        return;
      }

      this.failureCount = 0;
      body = rest.slice(2);
    }

    const result = this.executeCommand(body);
    if (result.ok) {
      socket.write(`00${result.payload}${TERMINATOR}`, 'ascii');
    } else {
      socket.write(`${result.code}${TERMINATOR}`, 'ascii');
    }
  }

  private executeCommand(body: string): { ok: true; payload: string } | { ok: false; code: string } {
    const s = this.state;
    let m: RegExpMatchArray | null;

    if (body === 'QPW') return { ok: true, payload: s.power === 'on' ? '001' : '000' };
    if (body === 'PON') {
      s.power = 'on';
      return { ok: true, payload: body };
    }
    if (body === 'POF') {
      s.power = 'off';
      return { ok: true, payload: body };
    }

    if (body === 'QSH') return { ok: true, payload: s.shutterClosed ? '1' : '0' };
    if (body === 'OSH:0' || body === 'OSH:1') {
      s.shutterClosed = body === 'OSH:1';
      return { ok: true, payload: body };
    }

    if (body === 'QSE') return { ok: true, payload: String(s.aspect) };
    if ((m = body.match(/^VSE:(\d+)$/))) {
      s.aspect = Number(m[1]);
      return { ok: true, payload: body };
    }

    if (body === 'QSF') return { ok: true, payload: String(s.screenSetting) };
    if ((m = body.match(/^VSF:(\d+)$/))) {
      s.screenSetting = Number(m[1]);
      return { ok: true, payload: body };
    }

    if (body === 'QTM:0') return { ok: true, payload: `${pad(s.tempIntakeC, 4)}/${pad(s.tempIntakeMaxC, 4)}` };
    if (body === 'QTM:1') return { ok: true, payload: `${pad(s.tempExhaustC, 4)}/${pad(s.tempExhaustMaxC, 4)}` };

    if ((m = body.match(/^Q\$L:(\d+)$/))) {
      const hours = s.lampHours[Number(m[1]) - 1];
      if (hours === undefined) return { ok: false, code: 'ERR2' };
      return { ok: true, payload: pad(hours, 4) };
    }
    if (body === 'Q$S') return { ok: true, payload: String(s.lampStatus) };

    if (body === 'QID') return { ok: true, payload: s.model };
    if (body === 'QSN') return { ok: true, payload: s.serial };
    if (body === 'QVX:RTMS1') return { ok: true, payload: `RTMS1=${s.runtimeHours}` };
    if (body === 'QVX:VMOI2') {
      return { ok: true, payload: s.acVoltageMalformed ? 'VMOI2=' : `VMOI2=+${pad(s.acVoltageRaw, 5)}` };
    }
    if (body === 'QVX:ERRS1') return { ok: true, payload: `ERRS1=${s.errs1}` };
    if (body === 'QVX:ERRS2') return { ok: true, payload: `ERRS2=${s.errs2}` };

    if (body === 'QTS') return { ok: true, payload: s.testPattern };
    if ((m = body.match(/^OTS:(\d+)$/))) {
      s.testPattern = m[1]!;
      return { ok: true, payload: body };
    }

    if (body === 'QIN') return { ok: true, payload: s.input };
    if ((m = body.match(/^IIS:(.+)$/))) {
      s.input = m[1]!;
      return { ok: true, payload: body };
    }

    return { ok: false, code: 'ERR1' };
  }
}
