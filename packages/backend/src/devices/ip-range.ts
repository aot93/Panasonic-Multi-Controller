import { BadRequestError } from '../http/errors.js';

const MAX_RANGE_SIZE = 254;

function parseOctets(ip: string): number[] {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return [];
  const octets = parts.map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return [];
  return octets;
}

/**
 * Expands a start/end IPv4 pair into every address in between, inclusive —
 * the "add multiple devices from an IP range" feature. Deliberately narrow:
 * only a same-/24 range (first three octets identical, varying only the
 * last) is supported. A technician adding a rack of projectors is almost
 * always working within one subnet; supporting arbitrary CIDR ranges would
 * add real complexity for a case that doesn't come up in practice here.
 */
export function parseIpRange(startIp: string, endIp: string): string[] {
  const start = parseOctets(startIp);
  const end = parseOctets(endIp);

  if (start.length === 0) throw new BadRequestError(`Not a valid IPv4 address: "${startIp}"`);
  if (end.length === 0) throw new BadRequestError(`Not a valid IPv4 address: "${endIp}"`);

  if (start[0] !== end[0] || start[1] !== end[1] || start[2] !== end[2]) {
    throw new BadRequestError('Start and end IP must be in the same /24 subnet (only the last octet may differ)');
  }
  if (start[3]! > end[3]!) {
    throw new BadRequestError('Start IP must be less than or equal to the end IP');
  }

  const count = end[3]! - start[3]! + 1;
  if (count > MAX_RANGE_SIZE) {
    throw new BadRequestError(`Range too large: ${count} addresses (max ${MAX_RANGE_SIZE})`);
  }

  const ips: string[] = [];
  for (let last = start[3]!; last <= end[3]!; last++) {
    ips.push(`${start[0]}.${start[1]}.${start[2]}.${last}`);
  }
  return ips;
}
