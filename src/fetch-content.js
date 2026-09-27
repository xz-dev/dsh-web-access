// fetch_content router for the paths the user config can actually run.

import { scrapeFirecrawl } from "./firecrawl.js";
import { parseGitHubUrl, renderIssueOrPr, renderRepo } from "./github.js";
import { htmlToMarkdown, looksThin } from "./html.js";
import { extractPdf, isPdfUrl } from "./pdf.js";
import { summarizeYouTube, youtubeId } from "./youtube.js";

export async function fetchContent(raw, options = {}) {
	const url = typeof raw === "string" ? raw.trim() : "";
	if (!url) throw new Error("No URL provided.");
	if (url.startsWith("/") || url.startsWith("./") || url.startsWith("../") || url.startsWith("file:")) {
		throw new Error("Local video and file analysis is not available in dsh-web-access (no Gemini Files path).");
	}
	if (options.timestamp || options.frames) {
		throw new Error("Video frame extraction is not ported (needs yt-dlp, ffmpeg, and the Pi frame pipeline).");
	}
	if (options.mode === "answer") {
		throw new Error('fetch mode "answer" is not ported (needs the Pi answer-model call). Use mode "readable".');
	}

	if (youtubeId(url)) {
		if (!options.search) throw new Error("YouTube summary needs a Perplexity search function.");
		const video = await summarizeYouTube(url, options.prompt, (query) => options.search(query));
		if (!video) throw new Error("Could not extract YouTube video content. Set PERPLEXITY_API_KEY or GEMINI_API_KEY.");
		return video;
	}

	const github = parseGitHubUrl(url);
	if (github && (github.kind === "issue" || github.kind === "pull")) {
		return renderIssueOrPr(github, options);
	}
	if (github) return renderRepo(github, { ...options, forceClone: options.forceClone === true });

	if (isPdfUrl(url)) return extractPdf(url, options);

	const httpFetch = options.httpFetch;
	if (!httpFetch) throw new Error("HTTP fetch provider is not available.");
	let fetched;
	try {
		fetched = await httpFetch(url, options.signal);
	} catch (error) {
		const fallback = await tryFirecrawl(url, options, error);
		if (fallback) return fallback;
		throw error;
	}
	if (isPdfUrl(url, fetched.contentType)) return extractPdf(url, options);
	let title = fetched.title || "";
	let content = fetched.body || "";
	if ((fetched.kind === "html" || /<html/i.test(content)) && options.mode !== "raw") {
		const readable = await htmlToMarkdown(content, url);
		title = readable.title || title;
		content = readable.content;
	}
	if (options.mode !== "raw" && looksThin(content)) {
		const fallback = await tryFirecrawl(url, options);
		if (fallback) return fallback;
	}
	return { url: fetched.url || url, title, content, statusCode: fetched.statusCode };
}

async function tryFirecrawl(url, options, cause) {
	try {
		const scraped = await scrapeFirecrawl(url, { fetchImpl: options.fetchImpl, signal: options.signal });
		return scraped;
	} catch (error) {
		if (!cause) throw error;
		return null;
	}
}
