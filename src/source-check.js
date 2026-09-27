// Pi source_check: passages are evidence for manual review. Never auto-labels supported/contradicted.

import { sha256 } from "./store.js";

const OFFICIAL_DOCS_HOSTS = /^(developers\.|docs\.|learn\.|reference\.)|\.github\.io$/i;
const OFFICIAL_DOCS_PATHS = /\/(docs?|reference)(\/|\b)/i;
const VENDOR_DOCS_PATHS = /\/(documentation|docs?)\//i;
const REPO_ISSUE_PATHS = /\/(issues|pull|pulls)\//i;
const BLOG_HOSTS = /(medium\.com|substack\.com|dev\.to|hashnode\.)/i;
const BLOG_PATHS = /\/blogs?\//i;
const FORUM_HOSTS = /(stackoverflow\.com|serverfault\.com|superuser\.com|discourse\.|community\.)/i;
const FORUM_PATHS = /\/(forum|forums|threads)\//i;
const NEWS_HOSTS = /(reuters\.com|bloomberg\.com|techcrunch\.com|theverge\.com|arstechnica\.com|wired\.com|cnet\.com|zdnet\.com)/i;
const NEWS_PATHS = /\/news(\/|$)/i;

export function classifySource(url) {
	let host = "";
	let path = "";
	try {
		const parsed = new URL(url);
		host = parsed.hostname;
		path = parsed.pathname;
	} catch {
		return "unknown";
	}
	if (REPO_ISSUE_PATHS.test(path)) return "repo_issue";
	if (OFFICIAL_DOCS_HOSTS.test(host) || OFFICIAL_DOCS_PATHS.test(path)) return "official_docs";
	if (VENDOR_DOCS_PATHS.test(path)) return "vendor_docs";
	if (NEWS_HOSTS.test(host) || NEWS_PATHS.test(path)) return "news";
	if (FORUM_HOSTS.test(host) || FORUM_PATHS.test(path)) return "forum";
	if (BLOG_HOSTS.test(host) || BLOG_PATHS.test(path)) return "blog";
	return "unknown";
}

function tokenize(value) {
	return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 3))];
}

function extractRelevantSpans(content, hint) {
	const sentences = [];
	for (const match of content.matchAll(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g)) {
		const raw = match[0];
		const text = raw.trim();
		if (text.length > 0 && text.length <= 400) {
			const start = (match.index ?? 0) + raw.indexOf(text);
			sentences.push({ text, start, end: start + text.length });
		}
	}
	const terms = tokenize(hint);
	if (!terms.length) return [];
	return sentences
		.map((sentence, index) => ({ sentence, index, score: terms.filter((term) => sentence.text.toLowerCase().includes(term)).length }))
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.slice(0, 3)
		.map(({ sentence }) => sentence);
}

export function buildResearchArtifact({ id, query, provider, summary, results, fetched = [], recency, domainFilter = [] }) {
	const fetchedByUrl = new Map(fetched.map((page) => [page.url, page]));
	const sources = [];
	const seen = new Set();
	for (const [index, result] of results.entries()) {
		if (!result.url || seen.has(result.url)) continue;
		seen.add(result.url);
		if (sources.length >= 20) break;
		const page = fetchedByUrl.get(result.url);
		const ok = Boolean(page && !page.error);
		sources.push({
			rank: sources.length + 1,
			url: result.url,
			title: result.title || result.url,
			snippet: result.snippet || "",
			quality: classifySource(result.url),
			fetched: ok,
			...(page ? { fetch_timestamp: Date.now() } : {}),
			...(ok ? { content_hash: sha256(page.content) } : {}),
			...(page?.error ? { fetch_error: page.error } : {}),
		});
		void index;
	}
	const passages = [];
	for (const source of sources) {
		if (source.snippet) {
			passages.push({
				passage_id: `p-${source.rank}-0`,
				source_url: source.url,
				source_rank: source.rank,
				text: source.snippet,
				content_hash: sha256(source.snippet),
			});
		}
		const page = fetchedByUrl.get(source.url);
		if (page && !page.error && page.content) {
			const spans = extractRelevantSpans(page.content, source.snippet?.trim() || query);
			spans.forEach((span, index) => {
				passages.push({
					passage_id: `p-${source.rank}-${index + 1}`,
					source_url: source.url,
					source_rank: source.rank,
					text: span.text,
					extraction_span: { start: span.start, end: span.end },
					content_hash: sha256(span.text),
				});
			});
		}
	}
	const status = passages.length === 0 ? "missing-evidence" : "unclear";
	const claim = {
		claim: query,
		status,
		supporting_passages: [],
		contradicting_passages: [],
		rationale: passages.length === 0
			? "No passages were retrieved for the claim."
			: "Passages were retrieved, but automated semantic support or contradiction assessment is unavailable; review the cited passages manually.",
		confidence: passages.length === 0 ? 0.2 : 0.3,
	};
	const include = domainFilter.filter((domain) => !String(domain).startsWith("-"));
	const exclude = domainFilter.filter((domain) => String(domain).startsWith("-")).map((domain) => domain.slice(1));
	return {
		id,
		type: "research",
		timestamp: Date.now(),
		query,
		sources,
		passages,
		claims: [claim],
		...(provider ? { provider } : {}),
		...(summary ? { summary } : {}),
		...(passages.length ? { content_hash: sha256(passages.map((passage) => passage.text).join("\n")) } : {}),
		filters: { ...(recency ? { recency } : {}), domain_include: include, domain_exclude: exclude },
	};
}

export function formatSourceCheck(artifact) {
	const assessment = artifact.claims?.[0];
	const lines = [`# Source check: ${artifact.query}`, ""];
	if (assessment) {
		lines.push(`**Status:** ${assessment.status} (confidence ${assessment.confidence.toFixed(2)})`);
		lines.push(`**Rationale:** ${assessment.rationale}`, "");
	}
	if (artifact.sources.length) {
		lines.push("## Sources");
		for (const source of artifact.sources) lines.push(`${source.rank}. [${source.quality}] ${source.title}\n   ${source.url}`);
		lines.push("");
	}
	if (artifact.errors?.length) lines.push(`Search errors: ${artifact.errors.map((entry) => `${entry.query}: ${entry.error}`).join("; ")}`);
	lines.push(`Artifact responseId: ${artifact.id} (retrievable via get_search_content).`);
	return lines.join("\n");
}
