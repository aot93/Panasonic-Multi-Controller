import { networkInterfaces } from 'node:os';

/** Every non-internal IPv4 address on this machine — shown in the console at startup and in the UI (NextSteps.md phase 3 item 12: "add ip address of the server to the top of the page"). */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n): n is NonNullable<typeof n> => Boolean(n) && n!.family === 'IPv4' && !n!.internal)
    .map((n) => n.address);
}
