// Minimal public-destination check for bytes ctx.web will not return (PDF).
// ponytail: one lookup, no NAT64. Upgrade to dsh-web-fetch-http's resolver if that is exported.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_V4 = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
	["100.64.0.0", 10],
];

function ipv4ToInt(ip) {
	return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function ipv4Blocked(ip) {
	const value = ipv4ToInt(ip);
	return BLOCKED_V4.some(([base, bits]) => {
		const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
		return (value & mask) === (ipv4ToInt(base) & mask);
	});
}

function ipv6Blocked(ip) {
	const normalized = ip.toLowerCase();
	if (normalized === "::1" || normalized === "::") return true;
	if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
	return mapped ? ipv4Blocked(mapped[1]) : false;
}

export function isBlockedAddress(ip) {
	const family = isIP(ip);
	if (family === 4) return ipv4Blocked(ip);
	if (family === 6) return ipv6Blocked(ip);
	return true;
}

export async function assertPublicHttpUrl(raw, lookupImpl = lookup) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("URL must be absolute HTTP(S)");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("URL must be HTTP(S)");
	if (url.username || url.password) throw new Error("URL must not include credentials");
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const literal = isIP(host);
	const addresses = literal ? [host] : (await lookupImpl(host, { all: true })).map((entry) => entry.address);
	if (addresses.length === 0) throw new Error(`hostname "${host}" resolved to no addresses`);
	for (const address of addresses) {
		if (isBlockedAddress(address)) throw new Error(`URL hostname "${host}" resolves to a non-public IP address`);
	}
	return url;
}
