// Cache-only Firecrawl scrape (lockdown) unless FIRECRAWL_FRESH_SCRAPE=1. v2 default, same as Pi.

import { loadPiWebSearchConfig, redact, resolveKey } from "./pi-config.js";

export function configuredFirecrawlBase() {
	const env = process.env.FIRECRAWL_BASE_URL?.trim();
	const file = loadPiWebSearchConfig().config.firecrawlBaseUrl;
	const value = env || (typeof file === "string" ? file.trim() : "");
	if (!value) return undefined;
	const url = new URL(value);
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("firecrawlBaseUrl must be HTTP(S)");
	if (url.username || url.password) throw new Error("firecrawlBaseUrl must not include credentials");
	url.search = "";
	url.hash = "";
	url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString().replace(/\/+$/, "");
}

export async function scrapeFirecrawl(target, { fetchImpl = globalThis.fetch, signal } = {}) {
	const base = configuredFirecrawlBase();
	if (!base) return null;
	const apiKey = resolveKey({ envName: "FIRECRAWL_API_KEY", configKey: "firecrawlApiKey" });
	const fresh = process.env.FIRECRAWL_FRESH_SCRAPE === "1" || process.env.FIRECRAWL_FRESH_SCRAPE === "true";
	const version = (process.env.FIRECRAWL_API_VERSION || "v2").trim() || "v2";
	const headers = { "Content-Type": "application/json" };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	const response = await fetchImpl(`${base}/${version}/scrape`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			url: target,
			formats: ["markdown"],
			onlyMainContent: true,
			...(fresh ? {} : { lockdown: true }),
		}),
		signal,
	});
	const text = await response.text();
	if (!response.ok) throw new Error(`Firecrawl scrape error ${response.status}: ${redact(text.slice(0, 300), apiKey)}`);
	const data = JSON.parse(text);
	if (data.success !== true) throw new Error(`Firecrawl scrape unsuccessful: ${redact(String(data.error || "unknown error"), apiKey)}`);
	const markdown = data.data?.markdown;
	if (typeof markdown !== "string" || !markdown.trim()) return null;
	const title = data.data?.metadata?.title || data.data?.title || "";
	return { url: target, title: typeof title === "string" ? title : "", content: markdown.trim() };
}
