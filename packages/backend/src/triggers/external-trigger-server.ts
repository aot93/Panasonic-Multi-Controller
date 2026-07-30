import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { createServer as createTcpServer, type Server as TcpServer, type Socket as TcpSocket } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import type { TargetKind } from '@ppc/shared';
import type { Dispatch } from '../dispatch/dispatch.js';
import { runMacro, summarizeMacroRun } from '../macros/run-macro.js';
import { getBooleanSetting, getNumberSetting } from '../poller/settings.js';

interface TriggerRow {
  id: number;
  trigger_key: string;
  enabled: number;
  target_kind: TargetKind;
  target_id: number | null;
  action_kind: 'command' | 'macro';
  action_id: number;
  param: string | null;
}

interface FireResult {
  ok: boolean;
  message: string;
}

/**
 * External TCP/UDP command trigger interface — spec §6: "Triggering of
 * commands via TCP/UDP messages: a protocol for external applications to
 * trigger command actions in the main app."
 *
 * Wire protocol (deliberately simple — the spec doesn't prescribe one, and
 * third-party control systems like Crestron/AMX/QSC that this exists to
 * interop with typically speak plain ASCII):
 *   TCP: connect, send the trigger_key (newline-terminated, or just close
 *        the connection after writing it), get back "OK\n" or "ERR <reason>\n".
 *   UDP: send a single datagram containing the trigger_key; a best-effort
 *        "OK"/"ERR <reason>" reply is sent back to the sender, though UDP
 *        triggers are typically fire-and-forget and callers shouldn't
 *        depend on it arriving.
 *
 * Off by default (`settings.external_trigger_enabled = '0'`) so a fresh
 * install doesn't open unexpected inbound ports. `restart()` lets the
 * settings API (triggers/routes.ts) apply a port/enabled change without a
 * full process restart.
 */
export class ExternalTriggerServer {
  private tcpServer: TcpServer | null = null;
  private udpSocket: UdpSocket | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly dispatch: Dispatch,
  ) {}

  get isRunning(): boolean {
    return this.tcpServer !== null || this.udpSocket !== null;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    if (!getBooleanSetting(this.db, 'external_trigger_enabled', false)) {
      return;
    }

    const tcpPort = getNumberSetting(this.db, 'external_trigger_tcp_port', 5000);
    const udpPort = getNumberSetting(this.db, 'external_trigger_udp_port', 5000);

    await this.startTcp(tcpPort);
    await this.startUdp(udpPort);
    console.log(`[triggers] listening TCP:${tcpPort} UDP:${udpPort}`);
  }

  async stop(): Promise<void> {
    if (this.tcpServer) {
      const server = this.tcpServer;
      this.tcpServer = null;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (this.udpSocket) {
      const socket = this.udpSocket;
      this.udpSocket = null;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
    }
  }

  /** Applies an updated enabled/port setting without a process restart. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  private startTcp(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createTcpServer((socket) => this.onTcpConnection(socket));
      server.once('error', reject);
      server.listen(port, () => {
        server.removeListener('error', reject);
        this.tcpServer = server;
        resolve();
      });
    });
  }

  private startUdp(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createSocket('udp4');
      socket.once('error', reject);
      socket.on('message', (msg, rinfo) => {
        const key = msg.toString('utf8').trim();
        if (!key) return;
        void this.fire(key, 'udp').then((result) => {
          try {
            socket.send(result.ok ? 'OK' : `ERR ${result.message}`, rinfo.port, rinfo.address);
          } catch {
            // Best-effort ack only — see class docs.
          }
        });
      });
      socket.bind(port, () => {
        socket.removeListener('error', reject);
        this.udpSocket = socket;
        resolve();
      });
    });
  }

  private onTcpConnection(socket: TcpSocket): void {
    let buffer = '';
    let handled = false;

    const handle = (rawKey: string) => {
      if (handled) return;
      handled = true;
      void this.fire(rawKey, 'tcp').then((result) => {
        try {
          socket.write(result.ok ? 'OK\n' : `ERR ${result.message}\n`);
        } catch {
          // Client may have already disconnected — nothing to do.
        }
        socket.end();
      });
    };

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const idx = buffer.indexOf('\n');
      if (idx !== -1) handle(buffer.slice(0, idx).trim());
    });

    socket.on('end', () => {
      if (!handled && buffer.trim()) handle(buffer.trim());
    });

    // A connection that never sends anything shouldn't hang around forever.
    socket.setTimeout(5000, () => socket.destroy());
  }

  private async fire(triggerKey: string, transport: 'tcp' | 'udp'): Promise<FireResult> {
    const row = this.db
      .prepare('SELECT * FROM external_triggers WHERE trigger_key = ? AND enabled = 1')
      .get(triggerKey) as TriggerRow | undefined;

    if (!row) {
      console.warn(`[triggers] unknown or disabled trigger key "${triggerKey}" via ${transport}`);
      return { ok: false, message: `Unknown or disabled trigger key: ${triggerKey}` };
    }

    const target = { kind: row.target_kind, ids: row.target_id !== null ? [row.target_id] : undefined };

    try {
      let message: string;
      if (row.action_kind === 'command') {
        await this.dispatch(target, { commandId: row.action_id }, row.param, 'trigger');
        message = 'dispatched';
      } else {
        const result = await runMacro(this.db, this.dispatch, row.action_id, target, 'trigger');
        message = summarizeMacroRun(result);
      }
      this.db
        .prepare("UPDATE external_triggers SET last_fired_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .run(row.id);
      return { ok: true, message };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[triggers] dispatch failed for "${triggerKey}": ${message}`);
      return { ok: false, message };
    }
  }
}
