import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export type ResolvedWebhookAddress = {
  address: string;
  family: 4 | 6;
};

export type WebhookHostnameResolver = (
  hostname: string,
) => Promise<readonly ResolvedWebhookAddress[]>;

export class UnsafeWebhookUrlError extends Error {
  constructor(message = "Webhook URL must use HTTPS and resolve only to public IP addresses.") {
    super(message);
    this.name = "UnsafeWebhookUrlError";
  }
}

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}
const globalUnicastIpv6 = new BlockList();
globalUnicastIpv6.addSubnet("2000::", 3, "ipv6");

function normalizedHostname(url: URL): string {
  const withoutBrackets = url.hostname.replace(/^\[|\]$/g, "");
  return withoutBrackets.toLowerCase().replace(/\.$/, "");
}

function isPublicIpAddress(address: string, family: 4 | 6): boolean {
  if (family === 4) {
    return isIP(address) === 4 && !blockedIpv4.check(address, "ipv4");
  }
  return (
    isIP(address) === 6 &&
    globalUnicastIpv6.check(address, "ipv6") &&
    !blockedIpv6.check(address, "ipv6")
  );
}

export function parseSafeWebhookUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebhookUrlError("Webhook URL is invalid.");
  }

  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw new UnsafeWebhookUrlError();
  }

  const hostname = normalizedHostname(url);
  if (
    hostname.length === 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    throw new UnsafeWebhookUrlError();
  }

  const family = isIP(hostname);
  if (family !== 0 && !isPublicIpAddress(hostname, family as 4 | 6)) {
    throw new UnsafeWebhookUrlError();
  }

  return url;
}

export function isSafeWebhookUrlForStorage(rawUrl: string): boolean {
  try {
    parseSafeWebhookUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

export const resolveWebhookHostname: WebhookHostnameResolver = async (hostname) => {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses.map(({ address, family }) => ({
    address,
    family: family === 6 ? 6 : 4,
  }));
};

export async function assertWebhookUrlResolvesPublic(
  rawUrl: string,
  resolveHostname: WebhookHostnameResolver = resolveWebhookHostname,
): Promise<{ url: URL; addresses: readonly ResolvedWebhookAddress[] }> {
  const url = parseSafeWebhookUrl(rawUrl);
  const hostname = normalizedHostname(url);
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    return {
      url,
      addresses: [{ address: hostname, family: literalFamily as 4 | 6 }],
    };
  }

  const addresses = await resolveHostname(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) => !isPublicIpAddress(address, family))
  ) {
    throw new UnsafeWebhookUrlError();
  }
  return { url, addresses };
}
