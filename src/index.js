// dsh-web-access — Pi web tools the daily TUI does not already expose.
// Built-in tool-web is disabled in the TUI preset and searches via DeepSeek, not Tavily+Perplexity.

import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createActivation } from "./activation.js";
import { selectStored } from "./content.js";
import { fetchContent } from "./fetch-content.js";
import { loadPiWebSearchConfig } from "./pi-config.js";
import { configuredProviders, presentSearch, searchQuery } from "./search.js";
import { buildResearchArtifact, formatSourceCheck } from "./source-check.js";
import { createStore, newId } from "./store.js";

export const name = "dsh-web-access";
export const inject = ["tools", "web", "systemPrompt", "commands"];

const HEAVY = ["web_search", "source_check", "fetch_content", "get_search_content"];

export const Config = z.object({
	gate: z.boolean().default(true),
	maxInlineContentChars: z.number().min(1).max(200_000).default(30_000),
	providers: z.array(z.string()).default([]),
});

function textResult(text) {
	return {
		schema: {
			type: "object",
			additionalProperties: false,
			properties: { text: { type: "string", required: true } },
		},
		render: (_args, value) => [{ type: "text", text: value.text }],
	};
}

function toolEnabled(config, key) {
	const override = config.tools?.[key]?.enabled;
	if (typeof override === "boolean") return override;
	if (key === "webSearch" || key === "sourceCheck") return config.webSearch?.enabled !== false;
	return true;
}

function httpFetch(ctx) {
	return async (url, signal) => {
		const result = await ctx.web.fetch({ url }, signal);
		return {
			url: result.url,
			statusCode: result.statusCode,
			kind: result.body.kind,
			body: result.body.content,
			contentType: result.body.kind === "html" ? "text/html" : "text/plain",
		};
	};
}

export function apply(ctx, config = {}) {
	const pi = loadPiWebSearchConfig().config;
	const maxChars = config.maxInlineContentChars ?? 30_000;
	const searchOptions = { providers: config.providers, piConfig: pi };
	const store = createStore();
	const enabled = {
		web_search: toolEnabled(pi, "webSearch"),
		source_check: toolEnabled(pi, "sourceCheck"),
		fetch_content: toolEnabled(pi, "fetchContent"),
		get_search_content: toolEnabled(pi, "getSearchContent"),
	};
	const heavy = HEAVY.filter((toolName) => enabled[toolName]);
	const gate = createActivation(heavy);

	if (enabled.web_search) {
		ctx.tools.register(defineTool({
			name: "web_search",
			description: "Search with the configured providers at once (Tavily and Perplexity when both are configured). workflow none: bounded results, no curator. Full text is stored for get_search_content.",
			parameters: {
				query: { type: "string", description: "Single search query" },
				queries: { type: "array", items: { type: "string" }, description: "Queries, up to 3 at a time" },
				numResults: { type: "integer", description: "Results per query (1-20, default 5)" },
				recencyFilter: { type: "string", enum: ["day", "week", "month", "year"] },
				domainFilter: { type: "array", items: { type: "string" }, description: "Domains; prefix - to exclude" },
				provider: { type: "json", description: "tavily, perplexity, or a list of those. Omit to use web-search.json." },
				workflow: { type: "string", enum: ["none", "summary-review", "auto-summary"] },
				includeContent: { type: "boolean" },
				proxy: { type: "string" },
			},
			output: textResult(""),
			timeoutMs: 60_000,
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				if (args.proxy) throw new Error("proxy is not ported.");
				if (args.workflow && args.workflow !== "none") throw new Error(`workflow "${args.workflow}" needs the Pi curator UI, which DSH does not provide. Use workflow "none".`);
				if (args.includeContent) throw new Error("includeContent background fetch is not ported. Call fetch_content on the URLs you need.");
				const queries = (Array.isArray(args.queries) && args.queries.length ? args.queries : [args.query]).filter((query) => typeof query === "string" && query.trim());
				if (!queries.length) throw new Error("No query provided. Use query or queries.");
				const records = [];
				for (let i = 0; i < queries.length; i += 3) {
					const batch = queries.slice(i, i + 3);
					const found = await Promise.all(batch.map((query) => searchQuery(query, {
						...searchOptions,
						numResults: args.numResults,
						recencyFilter: args.recencyFilter,
						domainFilter: args.domainFilter,
						provider: args.provider,
						signal: exec.signal,
					})));
					records.push(...found);
				}
				const responseId = newId();
				const text = presentSearch(records, { responseId, maxChars });
				store.put({
					id: responseId,
					type: "search",
					queries: records.map((record) => ({ ...record, text: presentSearch([record], { responseId, maxChars }) })),
				});
				return { text };
			},
		}));
	}

	if (enabled.fetch_content) {
		ctx.tools.register(defineTool({
			name: "fetch_content",
			description: "Fetch a URL as readable text. GitHub repos, issues, and PRs use the GitHub API (and a shallow clone under 350MB). PDFs use local unpdf. YouTube uses a Perplexity summary. Thin pages fall back to cache-only Firecrawl when configured.",
			parameters: {
				url: { type: "string", description: "URL to fetch" },
				urls: { type: "array", items: { type: "string" } },
				mode: { type: "string", enum: ["readable", "raw", "answer"] },
				prompt: { type: "string" },
				forceClone: { type: "boolean" },
				timestamp: { type: "string" },
				frames: { type: "integer" },
				proxy: { type: "string" },
			},
			output: textResult(""),
			timeoutMs: 120_000,
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				if (args.proxy) throw new Error("proxy is not ported.");
				const urls = (Array.isArray(args.urls) && args.urls.length ? args.urls : [args.url]).filter((url) => typeof url === "string" && url.trim());
				if (!urls.length) throw new Error("No URL provided. Use url or urls.");
				const pages = [];
				for (const url of urls) {
					const page = await fetchContent(url, {
						mode: args.mode,
						prompt: args.prompt,
						forceClone: args.forceClone,
						timestamp: args.timestamp,
						frames: args.frames,
						signal: exec.signal,
						httpFetch: httpFetch(ctx),
						search: (query) => searchQuery(query, { ...searchOptions, signal: exec.signal }),
					});
					pages.push(page);
				}
				const responseId = newId();
				store.put({
					id: responseId,
					type: "fetch",
					pages: pages.map((page) => ({ url: page.url, title: page.title, content: page.fullText || page.content || "" })),
				});
				const text = pages.map((page) => `# ${page.title || page.url}\n\n${page.content || ""}`).join("\n\n")
					+ `\n\nresponseId: ${responseId}`;
				return { text };
			},
		}));
	}

	if (enabled.source_check) {
		ctx.tools.register(defineTool({
			name: "source_check",
			description: "Search for a claim and return an evidence artifact. Status is unclear when passages exist and missing-evidence when they do not. It does not decide supported or contradicted.",
			parameters: {
				claim: { type: "string", required: true },
				queries: { type: "array", items: { type: "string" } },
				fetchContent: { type: "boolean", description: "Fetch at most 5 result pages" },
				domainFilter: { type: "array", items: { type: "string" } },
				recencyFilter: { type: "string", enum: ["day", "week", "month", "year"] },
			},
			output: textResult(""),
			timeoutMs: 120_000,
			isConcurrencySafe: () => true,
			async execute(args, exec) {
				const queries = (Array.isArray(args.queries) && args.queries.length ? args.queries : [args.claim]).filter((query) => typeof query === "string" && query.trim());
				const results = [];
				const errors = [];
				for (const query of queries) {
					try {
						const found = await searchQuery(query, {
							...searchOptions,
							domainFilter: args.domainFilter,
							recencyFilter: args.recencyFilter,
							signal: exec.signal,
						});
						results.push(...found.results);
					} catch (error) {
						errors.push({ query, error: error instanceof Error ? error.message : String(error) });
					}
				}
				const seen = new Set();
				const unique = results.filter((result) => {
					if (seen.has(result.url)) return false;
					seen.add(result.url);
					return true;
				}).slice(0, 20);
				const fetched = [];
				if (args.fetchContent) {
					for (const result of unique.slice(0, 5)) {
						try {
							const page = await fetchContent(result.url, { signal: exec.signal, httpFetch: httpFetch(ctx) });
							fetched.push({ url: result.url, content: page.fullText || page.content || "", error: null });
						} catch (error) {
							fetched.push({ url: result.url, content: "", error: error instanceof Error ? error.message : String(error) });
						}
					}
				}
				const id = newId();
				const artifact = buildResearchArtifact({
					id,
					query: args.claim,
					provider: configuredProviders(searchOptions).join(","),
					results: unique,
					fetched,
					recency: args.recencyFilter,
					domainFilter: args.domainFilter,
				});
				if (errors.length) artifact.errors = errors;
				store.put({ id, type: "research", artifact });
				return { text: formatSourceCheck(artifact) };
			},
		}));
	}

	if (enabled.get_search_content) {
		ctx.tools.register(defineTool({
			name: "get_search_content",
			description: "Read stored web_search, fetch_content, or source_check content by responseId. Supports offset/limit or findText (exact, case-insensitive, fuzzy).",
			parameters: {
				responseId: { type: "string", required: true },
				queryIndex: { type: "integer" },
				urlIndex: { type: "integer" },
				url: { type: "string" },
				offset: { type: "integer" },
				limit: { type: "integer" },
				findText: { type: "json" },
				findMode: { type: "string", enum: ["exact", "case-insensitive", "fuzzy"] },
			},
			output: textResult(""),
			timeoutMs: 10_000,
			isConcurrencySafe: () => true,
			async execute(args) {
				if (args.findText !== undefined && (args.offset !== undefined || args.limit !== undefined)) {
					throw new Error("findText cannot be combined with offset or limit.");
				}
				const selected = selectStored(store.get(args.responseId), args);
				if (selected.error) throw new Error(selected.error);
				return { text: selected.text };
			},
		}));
	}

	ctx.tools.register(defineTool({
		name: "web_enable",
		description: `Enable configured web tools (${heavy.join(", ") || "none"}). Does not search or fetch. Enabled tools are available on the next model request.`,
		parameters: {},
		output: textResult(""),
		timeoutMs: 5_000,
		isConcurrencySafe: () => true,
		async execute(_args, exec) {
			if (!exec.agent) throw new Error("web_enable requires an agent.");
			const names = gate.enable(exec.agent);
			return { text: names.length ? `Enabled: ${names.join(", ")}.` : "No web tools are enabled in web-search.json." };
		},
	}));

	ctx.systemPrompt.section({
		name: "tool:web_enable",
		order: 40,
		interpolate: false,
		text: () => heavy.length
			? `Web tools (${heavy.join(", ")}) stay hidden until you call web_enable. On a resumed session they may already be visible. Configured search providers: ${configuredProviders(searchOptions).join(", ")}. workflow none returns raw results; curator workflows are unavailable.`
			: "",
	});

	if (config.gate !== false) {
		ctx.on("agent/created", ({ agent, source }) => gate.onCreated(agent, source, (filter) => agent.ctx.tools.restrict(filter)));
	}

	const commandEnabled = (commandName) => pi.commands?.[commandName]?.enabled !== false;
	if (commandEnabled("search")) {
		ctx.commands.register({
			name: "search",
			description: "Run configured web search and print results. No curator.",
			input: { hint: "query" },
			async handler({ rawInput, signal }) {
				const query = rawInput.trim();
				if (!query) return { kind: "error", text: "Usage: /search <query>" };
				try {
					const found = await searchQuery(query, { ...searchOptions, signal });
					const responseId = newId();
					store.put({ id: responseId, type: "search", queries: [{ ...found, text: presentSearch([found], { responseId, maxChars }) }] });
					return { kind: "success", text: presentSearch([found], { responseId, maxChars }) };
				} catch (error) {
					return { kind: "error", text: error instanceof Error ? error.message : String(error) };
				}
			},
		});
	}
	for (const commandName of ["websearch", "curator"]) {
		if (!commandEnabled(commandName)) continue;
		ctx.commands.register({
			name: commandName,
			description: "Pi search curator. Not available in DSH.",
			async handler() {
				return { kind: "error", text: `/${commandName} opens the Pi curator UI. DSH has no curator surface. Use /search or web_search with workflow none.` };
			},
		});
	}
}

export { configuredProviders, searchQuery, fetchContent, buildResearchArtifact, createActivation };
