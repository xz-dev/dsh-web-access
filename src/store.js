// Session content cache. Pi: 1h, 128 entries, 128 MiB, 0700/0600 under the Pi config dir.
// This port uses $DSH_HOME/web-search-cache when set, else a temp dir. Never ~/.pi.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TTL_MS = 60 * 60 * 1000;
const MAX_ENTRIES = 128;
const MAX_BYTES = 128 * 1024 * 1024;

export function createStore(root = defaultRoot()) {
	mkdirSync(root, { recursive: true });
	try { chmodSync(root, 0o700); } catch { /* windows */ }

	function file(id) {
		if (!/^[a-f0-9]{12}$/.test(id)) return undefined;
		return join(root, `${id}.json`);
	}

	function evict() {
		const names = readdirSync(root).filter((name) => name.endsWith(".json"));
		const rows = names.map((name) => {
			const path = join(root, name);
			const stat = statSync(path);
			return { path, mtime: stat.mtimeMs, size: stat.size };
		}).sort((a, b) => a.mtime - b.mtime);
		let bytes = rows.reduce((sum, row) => sum + row.size, 0);
		while (rows.length > MAX_ENTRIES || bytes > MAX_BYTES) {
			const row = rows.shift();
			if (!row) break;
			rmSync(row.path, { force: true });
			bytes -= row.size;
		}
	}

	return {
		root,
		put(record) {
			const id = record.id ?? randomBytes(6).toString("hex");
			const stored = { ...record, id, timestamp: record.timestamp ?? Date.now() };
			const path = join(root, `${id}.json`);
			writeFileSync(path, JSON.stringify(stored));
			try { chmodSync(path, 0o600); } catch { /* windows */ }
			evict();
			return id;
		},
		get(id) {
			const path = file(id);
			if (!path || !existsSync(path)) return undefined;
			const stat = statSync(path);
			if (Date.now() - stat.mtimeMs > TTL_MS) {
				rmSync(path, { force: true });
				return undefined;
			}
			try {
				return JSON.parse(readFileSync(path, "utf8"));
			} catch {
				return undefined;
			}
		},
	};
}

function defaultRoot() {
	const home = process.env.DSH_HOME;
	if (home) return join(home, "web-search-cache");
	return join(tmpdir(), "dsh-web-access-cache");
}

export function newId() {
	return randomBytes(6).toString("hex");
}

export function sha256(text) {
	return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
