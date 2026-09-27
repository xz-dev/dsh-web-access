// Read-only Pi web-search.json. Same path order as pi-web-access utils.ts.
// Secrets stay in the file or env. Callers must not log resolved values.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ENV_SOURCE = /^\$(?:([A-Za-z_][A-Za-z0-9_]*)|\{([A-Za-z_][A-Za-z0-9_]*)\})$/;

let cached;

export function clearPiWebSearchConfigCache() {
	cached = undefined;
}

export function resolveWebSearchConfigPath() {
	if (process.env.PI_WEB_SEARCH_CONFIG) return process.env.PI_WEB_SEARCH_CONFIG;
	const explicitDir = process.env.PI_CODING_AGENT_DIR;
	if (explicitDir) return join(explicitDir, "web-search.json");
	const xdg = process.env.XDG_CONFIG_HOME;
	const legacy = join(homedir(), ".pi", "web-search.json");
	const agent = join(homedir(), ".pi", "agent", "web-search.json");
	if (xdg) {
		const xdgFile = join(xdg, "pi", "web-search.json");
		if (existsSync(xdgFile)) return xdgFile;
		if (existsSync(legacy)) return legacy;
		return xdgFile;
	}
	if (existsSync(agent)) return agent;
	if (existsSync(legacy)) return legacy;
	return agent;
}

/** @returns {{ path: string, config: Record<string, unknown> }} */
export function loadPiWebSearchConfig() {
	if (cached) return cached;
	const path = resolveWebSearchConfigPath();
	if (!existsSync(path)) {
		cached = { path, config: {} };
		return cached;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		cached = { path, config: parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {} };
	} catch {
		cached = { path, config: {} };
	}
	return cached;
}

function nonEmpty(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * explicit env value > named env > config string.
 * Config `$VAR` / `${VAR}` reads that env var. `$$` is a literal dollar.
 * Shell-command credentials are not executed.
 */
export function resolveKey({ envValue, envName, configKey }) {
	const direct = nonEmpty(envValue) ?? (envName ? nonEmpty(process.env[envName]) : undefined);
	if (direct) return direct;
	const raw = loadPiWebSearchConfig().config[configKey];
	const configured = nonEmpty(raw);
	if (!configured) return undefined;
	if (configured.startsWith("!")) return undefined;
	if (configured.startsWith("$$") || configured.startsWith("$!")) return configured.slice(1);
	const match = configured.match(ENV_SOURCE);
	if (match) return nonEmpty(process.env[match[1] ?? match[2]]);
	if (configured.startsWith("$")) return undefined;
	return configured;
}

export function hasKey(options) {
	return resolveKey(options) !== undefined;
}

export function redact(text, secret) {
	if (!secret || !text) return text;
	return String(text).split(secret).join("[redacted]");
}
