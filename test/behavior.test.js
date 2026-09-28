import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createActivation } from "../src/activation.js";
import { findInText, selectStored } from "../src/content.js";
import { fetchContent } from "../src/fetch-content.js";
import { normalizeFirecrawlBase, scrapeFirecrawl } from "../src/firecrawl.js";
import { parseGitHubUrl } from "../src/github.js";
import { stripTags } from "../src/html.js";
import { createSecrets, secretsFrom } from "../src/secrets.js";
import { isBlockedAddress } from "../src/public-url.js";
import { configuredProviders, presentSearch, resetPerplexityRateLimit, searchQuery } from "../src/search.js";
import { buildResearchArtifact } from "../src/source-check.js";
import { createStore } from "../src/store.js";
import { youtubeId } from "../src/youtube.js";

test("provider list defaults to both and honours plugin config", () => {
	assert.deepEqual(configuredProviders({}), ["tavily", "perplexity"]);
	assert.deepEqual(configuredProviders({ providers: ["tavily"] }), ["tavily"]);
	assert.throws(() => configuredProviders({ providers: ["exa"] }), /unsupported search provider/);
});

test("secrets come from the credentials service, env only without one", async () => {
	const seen = [];
	const ctx = { get: (name) => name === "credentials" ? { resolve: async (ref) => { seen.push(String(ref)); return ref === "TAVILY_API_KEY" ? { value: " stored " } : undefined; } } : undefined };
	process.env.TAVILY_API_KEY = "from-env";
	assert.equal(await createSecrets(ctx)("TAVILY_API_KEY"), "stored");
	assert.equal(await createSecrets(ctx)("PERPLEXITY_API_KEY"), undefined);
	assert.deepEqual(seen, ["TAVILY_API_KEY", "PERPLEXITY_API_KEY"]);
	assert.equal(await createSecrets({ get: () => undefined })("TAVILY_API_KEY"), "from-env");
	delete process.env.TAVILY_API_KEY;
});

test("search merges tavily and perplexity and keeps a provider error", async () => {
	resetPerplexityRateLimit();
	const secrets = secretsFrom({ TAVILY_API_KEY: "tavily-test", PERPLEXITY_API_KEY: "pplx-test" });
	const fetchImpl = async (url) => {
		if (url.includes("tavily")) {
			return json({ answer: "tav", results: [{ title: "A", url: "https://a.example", content: "snippet" }] });
		}
		return { ok: false, status: 500, text: async () => "pplx-test blew up" };
	};
	const found = await searchQuery("q", { providers: ["tavily", "perplexity"], secrets }, fetchImpl);
	assert.deepEqual(found.providers, ["tavily"]);
	assert.equal(found.results[0].url, "https://a.example");
	assert.match(found.answer, /Provider errors/);
	assert.doesNotMatch(found.answer, /pplx-test/);
	const shown = presentSearch([found], { responseId: "abc", maxChars: 30_000 });
	assert.match(shown, /responseId: "abc"/);
	await assert.rejects(() => searchQuery("q", { providers: ["tavily"], secrets: secretsFrom({}) }, fetchImpl), /DSH credentials/);
});

test("source_check stays unclear or missing-evidence", () => {
	const empty = buildResearchArtifact({ id: "aa", query: "claim", results: [] });
	assert.equal(empty.claims[0].status, "missing-evidence");
	const some = buildResearchArtifact({
		id: "bb",
		query: "streaming",
		results: [{ title: "Docs", url: "https://docs.example.com/docs/stream", snippet: "The API supports streaming responses." }],
		fetched: [{ url: "https://docs.example.com/docs/stream", content: "The API supports streaming responses today." }],
	});
	assert.equal(some.claims[0].status, "unclear");
	assert.equal(some.claims[0].supporting_passages.length, 0);
	assert.equal(some.sources[0].quality, "official_docs");
	assert.ok(some.passages.length >= 1);
});

test("get_search_content pages and finds", () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-web-store-"));
	const store = createStore(dir);
	const id = store.put({
		type: "search",
		queries: [{ query: "q", text: "alpha installation beta" }],
	});
	const page = selectStored(store.get(id), { offset: 6, limit: 12 });
	assert.equal(page.text, "installation");
	const found = findInText("alpha installation beta", "Installation", "case-insensitive");
	assert.equal(found.count, 1);
	assert.equal(selectStored(undefined, {}).error, "Unknown responseId.");
});

test("web_enable gates startup and clear only", () => {
	const activation = createActivation(["web_search", "fetch_content"]);
	const agent = {};
	let denied = null;
	const restrict = (filter) => {
		denied = filter.deny;
		return () => { denied = null; };
	};
	activation.onCreated(agent, "startup", restrict);
	assert.deepEqual(denied, ["web_search", "fetch_content"]);
	assert.deepEqual(activation.enable(agent), ["web_search", "fetch_content"]);
	assert.equal(denied, null);
	activation.onCreated(agent, "resume", restrict);
	assert.equal(activation.isGated(agent), false);
});

test("public addresses block loopback and rfc1918", () => {
	assert.equal(isBlockedAddress("127.0.0.1"), true);
	assert.equal(isBlockedAddress("10.1.2.3"), true);
	assert.equal(isBlockedAddress("192.168.1.1"), true);
	assert.equal(isBlockedAddress("1.1.1.1"), false);
	assert.equal(isBlockedAddress("::1"), true);
});

test("fetch github issue, thin page firecrawl, youtube summary", async () => {
	assert.equal(parseGitHubUrl("https://github.com/acme/widgets/issues/4")?.kind, "issue");
	const issue = await fetchContent("https://github.com/acme/widgets/issues/4", {
		execImpl: async () => { throw new Error("no gh"); },
		fetchImpl: async () => json({ title: "Bug", state: "open", body: "steps", html_url: "https://github.com/acme/widgets/issues/4" }),
		cloneImpl: false,
	});
	assert.match(issue.content, /steps/);

	const fcSecrets = secretsFrom({ FIRECRAWL_BASE_URL: "https://api.firecrawl.dev", FIRECRAWL_API_KEY: "fc-test" });
	let lockdown = false;
	const page = await fetchContent("https://example.com/post", {
		secrets: fcSecrets,
		httpFetch: async () => ({ url: "https://example.com/post", statusCode: 200, kind: "html", body: "<html><body>cookie consent</body></html>", contentType: "text/html" }),
		fetchImpl: async (_url, init) => {
			const body = JSON.parse(init.body);
			lockdown = body.lockdown === true;
			return json({ success: true, data: { markdown: "real article body ".repeat(20), metadata: { title: "Post" } } });
		},
	});
	assert.equal(lockdown, true);
	assert.match(page.content, /real article/);
	let rawHits = 0;
	const raw = await fetchContent("https://example.com/raw", {
		mode: "raw",
		secrets: fcSecrets,
		httpFetch: async () => ({ url: "https://example.com/raw", statusCode: 200, kind: "html", body: "<p>cookie</p>", contentType: "text/html" }),
		fetchImpl: async () => { rawHits += 1; return json({ success: true, data: { markdown: "nope" } }); },
	});
	assert.equal(rawHits, 0);
	assert.match(raw.content, /cookie/);

	assert.equal(youtubeId("https://youtu.be/abcdefghijk"), "abcdefghijk");
	const video = await fetchContent("https://youtu.be/abcdefghijk", {
		search: async () => ({ answer: "a talk about ports" }),
	});
	assert.match(video.content, /Perplexity/);
	await assert.rejects(() => fetchContent("https://youtu.be/abcdefghijk", { frames: 2, search: async () => ({ answer: "x" }) }), /frame extraction/);
});

test("firecrawl base rejects credentials", () => {
	assert.throws(() => normalizeFirecrawlBase("https://user:pass@api.firecrawl.dev"), /credentials/);
	assert.equal(normalizeFirecrawlBase("https://fc.example/"), "https://fc.example");
});

test("strip tags drops scripts", () => {
	assert.equal(stripTags("<style>x</style><p>Hi &amp; co</p><script>alert(1)</script>"), "Hi & co");
});

test("scrape returns null without base", async () => {
	assert.equal(await scrapeFirecrawl("https://example.com", { secrets: secretsFrom({}) }), null);
});

function json(data) {
	return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) };
}
