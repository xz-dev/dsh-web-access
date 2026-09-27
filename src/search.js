// User routing: provider array searches those providers at once (Pi resolveProvider → "all").
// Defaults when the Pi file lists none: tavily then perplexity, matching ~/.pi/web-search.json shape.

import { hasKey, redact, resolveKey } from "./pi-config.js";

const TAVILY_URL = "https://api.tavily.com/search";
const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
const RATE = { max: 10, windowMs: 60_000 };
const perplexityHits = [];

export function configuredProviders(config = {}) {
	const fromPlugin = config.providers;
	if (Array.isArray(fromPlugin) && fromPlugin.length > 0) return normalizeList(fromPlugin);
	const file = config.piConfig ?? {};
	const selected = file.searchProvider ?? file.provider;
	if (Array.isArray(selected) && selected.length > 0) return normalizeList(selected);
	if (typeof selected === "string" && selected.trim() && selected !== "auto" && selected !== "all") return normalizeList([selected]);
	return ["tavily", "perplexity"];
}

function normalizeList(list) {
	const out = [];
	for (const item of list) {
		if (item !== "tavily" && item !== "perplexity") {
			throw new Error(`unsupported search provider "${item}". This port implements tavily and perplexity (the configured pair).`);
		}
		if (!out.includes(item)) out.push(item);
	}
	return out;
}

export function providerAvailable(name) {
	if (name === "tavily") return hasKey({ envName: "TAVILY_API_KEY", configKey: "tavilyApiKey" });
	if (name === "perplexity") return hasKey({ envName: "PERPLEXITY_API_KEY", configKey: "perplexityApiKey" });
	return false;
}

function keyFor(name) {
	if (name === "tavily") return resolveKey({ envName: "TAVILY_API_KEY", configKey: "tavilyApiKey" });
	return resolveKey({ envName: "PERPLEXITY_API_KEY", configKey: "perplexityApiKey" });
}

function clampCount(value) {
	const n = Number.isFinite(value) ? Math.floor(value) : 5;
	return Math.min(20, Math.max(1, n));
}

function domainSplit(domainFilter) {
	const include = [];
	const exclude = [];
	for (const raw of domainFilter ?? []) {
		if (typeof raw !== "string") continue;
		const excludeThis = raw.trim().startsWith("-");
		const domain = raw.trim().replace(/^-/, "").toLowerCase();
		if (!domain) continue;
		(excludeThis ? exclude : include).push(domain);
	}
	return { include, exclude };
}

async function searchTavily(query, options, fetchImpl) {
	const apiKey = keyFor("tavily");
	if (!apiKey) throw new Error("Tavily API key not found. Set TAVILY_API_KEY or tavilyApiKey in web-search.json.");
	const numResults = clampCount(options.numResults);
	const domains = domainSplit(options.domainFilter);
	const body = {
		query,
		search_depth: "basic",
		max_results: numResults,
		include_answer: "basic",
		include_raw_content: false,
		...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
		...(domains.include.length ? { include_domains: domains.include } : {}),
		...(domains.exclude.length ? { exclude_domains: domains.exclude } : {}),
	};
	const response = await fetchImpl(TAVILY_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
		signal: options.signal,
	});
	if (!response.ok) {
		const text = redact(await response.text(), apiKey);
		throw new Error(`Tavily API error ${response.status}: ${text.slice(0, 300)}`);
	}
	const data = await response.json();
	const results = [];
	for (const item of data.results ?? []) {
		if (!item?.url) continue;
		results.push({
			title: item.title || `Source ${results.length + 1}`,
			url: item.url,
			snippet: typeof item.content === "string" ? item.content.replace(/\s+/g, " ").trim() : "",
		});
		if (results.length >= numResults) break;
	}
	return { provider: "tavily", answer: typeof data.answer === "string" ? data.answer : "", results };
}

function notePerplexity(now) {
	while (perplexityHits.length && perplexityHits[0] < now - RATE.windowMs) perplexityHits.shift();
	if (perplexityHits.length >= RATE.max) {
		const wait = Math.ceil((perplexityHits[0] + RATE.windowMs - now) / 1000);
		throw new Error(`Rate limited. Try again in ${wait}s`);
	}
	perplexityHits.push(now);
}

export function resetPerplexityRateLimit() {
	perplexityHits.length = 0;
}

async function searchPerplexity(query, options, fetchImpl) {
	const apiKey = keyFor("perplexity");
	if (!apiKey) throw new Error("Perplexity API key not found. Set PERPLEXITY_API_KEY or perplexityApiKey in web-search.json.");
	notePerplexity(options.now ?? Date.now());
	const numResults = clampCount(options.numResults);
	const body = {
		model: "sonar",
		messages: [{ role: "user", content: query }],
		max_tokens: 1024,
		return_related_questions: false,
		...(options.recencyFilter ? { search_recency_filter: options.recencyFilter } : {}),
		...(options.domainFilter?.length ? { search_domain_filter: options.domainFilter } : {}),
	};
	const response = await fetchImpl(PERPLEXITY_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify(body),
		signal: options.signal,
	});
	if (!response.ok) {
		const text = redact(await response.text(), apiKey);
		throw new Error(`Perplexity API error ${response.status}: ${text.slice(0, 300)}`);
	}
	const data = await response.json();
	const answer = data.choices?.[0]?.message?.content || "";
	const citations = Array.isArray(data.citations) ? data.citations : [];
	let highest = 0;
	for (const match of String(answer).matchAll(/\[(\d{1,3})\]/g)) highest = Math.max(highest, Number(match[1]));
	const keep = Math.min(citations.length, 20, Math.max(numResults, highest));
	const results = [];
	for (let i = 0; i < keep; i++) {
		const citation = citations[i];
		if (typeof citation === "string") results.push({ title: `Source ${i + 1}`, url: citation, snippet: "" });
		else if (citation && typeof citation.url === "string") {
			results.push({ title: citation.title || `Source ${i + 1}`, url: citation.url, snippet: "" });
		}
	}
	return { provider: "perplexity", answer, results };
}

const SEARCHERS = { tavily: searchTavily, perplexity: searchPerplexity };

export async function searchQuery(query, options, fetchImpl = globalThis.fetch) {
	const requested = options.provider ? normalizeList([].concat(options.provider)) : configuredProviders(options);
	const available = requested.filter(providerAvailable);
	if (available.length === 0) {
		throw new Error(`No configured search provider available (${requested.join(", ")}). Set TAVILY_API_KEY and/or PERPLEXITY_API_KEY.`);
	}
	const settled = await Promise.allSettled(available.map((name) => SEARCHERS[name](query, options, fetchImpl)));
	if (options.signal?.aborted) throw new Error("Aborted");
	const successes = [];
	const failures = [];
	settled.forEach((outcome, index) => {
		if (outcome.status === "fulfilled") successes.push(outcome.value);
		else failures.push({ provider: available[index], error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) });
	});
	if (successes.length === 0) {
		throw new Error(`Selected-provider search failed:\n  - ${failures.map((f) => `${f.provider}: ${f.error}`).join("\n  - ")}`);
	}
	const results = [];
	const seen = new Set();
	for (const response of successes) {
		for (const result of response.results) {
			if (seen.has(result.url)) continue;
			seen.add(result.url);
			results.push(result);
		}
	}
	const sections = successes.map((response) => `## ${response.provider}\n\n${response.answer || "(No answer text returned.)"}`);
	if (failures.length) sections.push(`## Provider errors\n\n${failures.map((f) => `- **${f.provider}:** ${f.error}`).join("\n")}`);
	return {
		query,
		providers: successes.map((response) => response.provider),
		failures,
		answer: sections.join("\n\n"),
		results,
	};
}

export function formatSearchResult(record) {
	let output = `## Results for: "${record.query}"\n\n`;
	if (record.providers?.length) output += `**Provider${record.providers.length === 1 ? "" : "s"}:** ${record.providers.join(", ")}\n\n`;
	if (record.answer) output += `${record.answer}\n\n---\n\n`;
	for (const result of record.results) {
		output += `### ${result.title}\n${result.url}${result.snippet ? `\n\n${result.snippet}` : ""}\n\n`;
	}
	return output;
}

export function presentSearch(records, { responseId, maxChars }) {
	const body = records.map(formatSearchResult).join("\n");
	const guidance = `\nUse get_search_content({ responseId: "${responseId}", queryIndex: 0, offset: 0, limit: ${maxChars} }) to retrieve the first bounded page${records.length > 1 ? `; repeat with queryIndex 1 through ${records.length - 1}` : ""}.`;
	const full = body + guidance;
	if (full.length <= maxChars) return full;
	const marker = `\n\n---\n[Output truncated.]${guidance}`;
	return `${body.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}
