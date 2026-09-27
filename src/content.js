// get_search_content paging and findText. Cap matches Pi's 20_000 finder budget.

const FIND_CAP = 20_000;

export function pageText(text, offset = 0, limit = 30_000) {
	const start = Math.max(0, offset);
	const slice = text.slice(start, start + limit);
	return {
		text: slice,
		offset: start,
		limit,
		returnedChars: slice.length,
		totalChars: text.length,
		nextOffset: start + slice.length < text.length ? start + slice.length : undefined,
	};
}

function findMode(mode) {
	if (mode === "exact" || mode === "fuzzy") return mode;
	return "case-insensitive";
}

export function findInText(text, needles, mode = "case-insensitive") {
	const queries = [].concat(needles).flatMap((needle) => typeof needle === "string" ? [needle] : []).filter(Boolean);
	const hits = [];
	const resolved = findMode(mode);
	for (const needle of queries) {
		if (resolved === "fuzzy") {
			const terms = needle.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
			if (!terms.length) continue;
			const window = 240;
			for (let i = 0; i < text.length; i += 80) {
				const chunk = text.slice(i, i + window);
				const lower = chunk.toLowerCase();
				if (terms.every((term) => lower.includes(term))) hits.push({ needle, start: i, text: chunk.trim() });
				if (hits.length >= 20) break;
			}
			continue;
		}
		const source = resolved === "exact" ? text : text.toLowerCase();
		const probe = resolved === "exact" ? needle : needle.toLowerCase();
		let from = 0;
		while (hits.length < 20) {
			const at = source.indexOf(probe, from);
			if (at < 0) break;
			const start = Math.max(0, at - 80);
			const end = Math.min(text.length, at + needle.length + 80);
			hits.push({ needle, start: at, text: text.slice(start, end).trim() });
			from = at + Math.max(probe.length, 1);
		}
	}
	let body = hits.map((hit) => `at ${hit.start}: ${hit.text}`).join("\n\n");
	const truncated = body.length > FIND_CAP;
	if (truncated) body = body.slice(0, FIND_CAP);
	return { mode: resolved, count: hits.length, text: body || "No matches.", truncated };
}

export function selectStored(record, params) {
	if (!record) return { error: "Unknown responseId." };
	if (record.type === "research") {
		const text = JSON.stringify(record.artifact ?? record, null, 2);
		if (params.findText) return { title: "artifact", ...findInText(text, params.findText, params.findMode) };
		return { title: "artifact", ...pageText(text, params.offset ?? 0, params.limit ?? 30_000) };
	}
	if (params.url || Number.isInteger(params.urlIndex)) {
		const pages = record.pages ?? [];
		const page = params.url ? pages.find((item) => item.url === params.url) : pages[params.urlIndex];
		if (!page) return { error: "Stored URL not found." };
		const text = page.content || page.error || "";
		if (params.findText) return { title: page.url, ...findInText(text, params.findText, params.findMode) };
		return { title: page.url, ...pageText(text, params.offset ?? 0, params.limit ?? 30_000) };
	}
	const queries = record.queries ?? [];
	const query = Number.isInteger(params.queryIndex) ? queries[params.queryIndex] : queries[0];
	if (!query) return { error: "Stored query not found." };
	const text = query.text || "";
	if (params.findText) return { title: query.query, ...findInText(text, params.findText, params.findMode) };
	return { title: query.query, ...pageText(text, params.offset ?? 0, params.limit ?? 30_000) };
}
