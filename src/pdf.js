// Local unpdf text extraction. Datalab and Gemini PDF tiers are unused: no keys configured.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicHttpUrl } from "./public-url.js";

export function isPdfUrl(raw, contentType = "") {
	if (/application\/pdf/i.test(contentType)) return true;
	try { return new URL(raw).pathname.toLowerCase().endsWith(".pdf"); } catch { return false; }
}

export async function extractPdf(raw, { fetchImpl = globalThis.fetch, signal, lookup } = {}) {
	const url = await assertPublicHttpUrl(raw, lookup);
	const response = await fetchImpl(url, { signal, redirect: "manual" });
	if (response.status >= 300 && response.status < 400) throw new Error("PDF redirect blocked; fetch the final URL");
	if (!response.ok) throw new Error(`PDF fetch ${response.status}`);
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("PDF exceeds 20MB");
	const { extractText, getDocumentProxy } = await import("unpdf");
	const doc = await getDocumentProxy(bytes);
	const extracted = await extractText(doc, { mergePages: true });
	const text = Array.isArray(extracted.text) ? extracted.text.join("\n\n") : String(extracted.text || "");
	const dir = mkdtempSync(join(tmpdir(), "dsh-web-pdf-"));
	const path = join(dir, "document.md");
	writeFileSync(path, text);
	return {
		url: raw,
		title: "PDF",
		content: `Saved PDF markdown: ${path}\n\n${text.slice(0, 4000)}`,
		fullText: text,
	};
}
