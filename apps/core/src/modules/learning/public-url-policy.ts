import { isIP } from 'node:net';

export class PublicResourceFetchError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'PublicResourceFetchError';
    this.code = code;
  }
}

export interface PublicDnsAnswer {
  address: string;
  family: 4 | 6;
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  const [a, b, c] = octets;
  if (a === undefined || b === undefined || c === undefined) return false;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function expandIpv6(address: string): number[] | undefined {
  const lower = address.toLowerCase();
  if (lower.includes('.')) return undefined;
  const halves = lower.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...head, ...tail].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined;
  return [...head, ...Array(missing).fill('0'), ...tail].map((part) => Number.parseInt(part, 16));
}

function matchesIpv6Prefix(groups: readonly number[], prefix: readonly number[], bits: number): boolean {
  const completeGroups = Math.floor(bits / 16);
  const remainder = bits % 16;
  for (let index = 0; index < completeGroups; index += 1) {
    if (groups[index] !== prefix[index]) return false;
  }
  if (remainder === 0) return true;
  const group = groups[completeGroups];
  const prefixGroup = prefix[completeGroups];
  if (group === undefined || prefixGroup === undefined) return false;
  const mask = (0xffff << (16 - remainder)) & 0xffff;
  return (group & mask) === (prefixGroup & mask);
}

const nonGlobalIpv6SpecialUsePrefixes: ReadonlyArray<{ name: string; prefix: readonly number[]; bits: number }> = [
  { name: 'IPv4-compatible', prefix: [0, 0, 0, 0, 0, 0], bits: 96 },
  { name: 'IPv4-mapped', prefix: [0, 0, 0, 0, 0, 0xffff], bits: 96 },
  { name: 'IPv4-IPv6 translation', prefix: [0x0064, 0xff9b, 0, 0, 0, 0], bits: 96 },
  { name: 'IPv4-IPv6 translation local-use', prefix: [0x0064, 0xff9b, 0x0001], bits: 48 },
  { name: 'discard-only', prefix: [0x0100, 0, 0, 0], bits: 64 },
  { name: 'dummy IPv6 prefix', prefix: [0x0100, 0, 0, 0x0001], bits: 64 },
  { name: 'IETF protocol assignments', prefix: [0x2001, 0], bits: 23 },
  { name: 'IETF anycast assignments', prefix: [0x2001, 0x0001, 0, 0], bits: 64 },
  { name: 'benchmarking', prefix: [0x2001, 0x0002, 0], bits: 48 },
  { name: 'AS112-v6', prefix: [0x2001, 0x0004, 0x0112], bits: 48 },
  { name: 'ORCHID', prefix: [0x2001, 0x0010], bits: 28 },
  { name: 'ORCHIDv2', prefix: [0x2001, 0x0020], bits: 28 },
  { name: 'drone remote ID', prefix: [0x2001, 0x0030], bits: 28 },
  { name: 'documentation', prefix: [0x2001, 0x0db8], bits: 32 },
  { name: '6to4', prefix: [0x2002], bits: 16 },
  { name: 'AS112 delegation', prefix: [0x2620, 0x004f, 0x8000], bits: 48 },
  { name: 'former 6bone', prefix: [0x3ffe], bits: 16 },
  { name: 'documentation', prefix: [0x3fff, 0], bits: 20 },
  { name: 'segment routing local-use', prefix: [0x5f00], bits: 16 },
];

function isPublicIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups || groups.length !== 8) return false;
  const [g0, g5, g7] = [groups[0]!, groups[5]!, groups[7]!];
  if (groups.every((group) => group === 0)) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && g7 === 1) return false;
  if (groups.slice(0, 5).every((group) => group === 0) && g5 === 0xffff) return false;
  if ((g0 & 0xfe00) === 0xfc00) return false;
  if ((g0 & 0xffc0) === 0xfe80) return false;
  if ((g0 & 0xff00) === 0xff00) return false;
  if ((g0 & 0xffc0) === 0xfec0) return false;
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (nonGlobalIpv6SpecialUsePrefixes.some(({ prefix, bits }) => matchesIpv6Prefix(groups, prefix, bits))) return false;
  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

export function parseSafePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_URL_UNSAFE');
  }
  url.hash = '';
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_URL_UNSAFE');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_URL_UNSAFE');
  }
  if (isIP(hostname) && !isPublicIpAddress(hostname)) {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_URL_UNSAFE');
  }
  return url;
}

export async function resolvePinnedPublicUrl(
  raw: string,
  resolveAll: (hostname: string) => Promise<PublicDnsAnswer[]>,
): Promise<{ url: URL; addresses: PublicDnsAnswer[] }> {
  const url = parseSafePublicUrl(raw);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  if (family === 4 || family === 6) {
    return { url, addresses: [{ address: hostname, family: family as 4 | 6 }] };
  }
  let addresses: PublicDnsAnswer[];
  try {
    addresses = await resolveAll(hostname);
  } catch {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_DNS_UNAVAILABLE');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new PublicResourceFetchError('PUBLIC_RESOURCE_DNS_UNSAFE');
  }
  return { url, addresses };
}
