// Readable markdown. Uses Readability + Turndown when installed; tag-strip is the fallback.

export async function htmlToMarkdown(html, url) {
	try {
		const { parseHTML } = await import("linkedom");
		const { Readability } = await import("@mozilla/readability");
		const { default: TurndownService } = await import("turndown");
		const { document } = parseHTML(html);
		const article = new Readability(document, { url }).parse();
		const fragment = article?.content || html;
		const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
		const title = article?.title || "";
		const markdown = turndown.turndown(fragment).trim();
		return { title, content: markdown };
	} catch {
		return { title: "", content: stripTags(html) };
	}
}

export function stripTags(html) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.trim();
}

export function looksThin(text) {
	if (!text || text.length < 200) return true;
	return /cookie|consent|enable javascript/i.test(text) && text.length < 800;
}
