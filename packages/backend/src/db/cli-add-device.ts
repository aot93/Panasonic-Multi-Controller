/**
 * Manual dev/test helper for registering a device before phase 4 ships a
 * real REST endpoint for it. Useful for smoke-testing the phase 3 poller
 * against real hardware:
 *
 *   npm run add-device --workspace @ppc/backend -- \
 *     --name "Foyer" --host 192.168.0.131 --username admin1 --password panasonic
 */
import { getDb, closeDb } from './index.js';
import { setDeviceCredentials } from '../credentials/store.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));

if (!args.name || !args.host) {
  console.error(
    'Usage: npm run add-device --workspace @ppc/backend -- --name "Foyer" --host 192.168.0.131 ' +
      '[--port 1024] [--username admin1] [--password panasonic] [--poll-interval-sec 30]',
  );
  process.exit(1);
}

const db = getDb();
const port = args.port ? Number(args.port) : 1024;
const pollIntervalSec = args['poll-interval-sec'] ? Number(args['poll-interval-sec']) : null;

const info = db
  .prepare('INSERT INTO devices (name, host, port, poll_interval_sec) VALUES (?, ?, ?, ?)')
  .run(args.name, args.host, port, pollIntervalSec);
const deviceId = Number(info.lastInsertRowid);

if (args.username !== undefined || args.password !== undefined) {
  setDeviceCredentials(db, deviceId, { username: args.username, password: args.password });
}

console.log(`[db] registered device #${deviceId} "${args.name}" at ${args.host}:${port}`);
closeDb();
