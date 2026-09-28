// Named secrets through the DSH credentials service ($DSH_HOME/.credentials.yaml,
// layered under the launch environment and .env files by dsh-credentials-local).
// Without a credentials service (tests, bare hosts) the process environment is used.
// Callers must not log resolved values.

import { credentialRef } from "@deepseek-ai/dsh-credentials";

/** @returns {(name: string) => Promise<string | undefined>} */
export function createSecrets(ctx) {
	return async (name) => {
		const credentials = ctx?.get?.("credentials");
		if (credentials) {
			const hit = await credentials.resolve(credentialRef(name));
			return nonEmpty(hit?.value);
		}
		return nonEmpty(process.env[name]);
	};
}

/** Test helper: a fixed name → value map. */
export function secretsFrom(values) {
	return async (name) => nonEmpty(values[name]);
}

function nonEmpty(value) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function redact(text, secret) {
	if (!secret || !text) return text;
	return String(text).split(secret).join("[redacted]");
}
