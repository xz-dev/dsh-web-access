// YouTube: Pi falls through Gemini Web → Gemini API → Perplexity. No Gemini key in the user config,
// so the working path is the Perplexity text summary. Frame extraction needs yt-dlp+ffmpeg and is a gap.

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function youtubeId(raw) {
	try {
		if (new URL(raw).pathname === "/playlist") return null;
	} catch { /* still try regex */ }
	return raw.match(YOUTUBE_RE)?.[1] ?? null;
}

export async function summarizeYouTube(raw, prompt, search) {
	const id = youtubeId(raw);
	if (!id) return null;
	const query = prompt
		? `${prompt} YouTube video: ${raw}`
		: `Summarize this YouTube video in detail: https://www.youtube.com/watch?v=${id}`;
	const { answer } = await search(query);
	if (!answer) return null;
	return {
		url: raw,
		title: "Video Summary (via Perplexity)",
		content: `# Video Summary (via Perplexity)\n\n${answer}\n\n*Full video understanding requires Gemini access. Set GEMINI_API_KEY or sign into Google in a supported Chromium browser.*`,
	};
}
