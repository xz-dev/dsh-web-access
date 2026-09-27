// GitHub URLs: issue/PR via `gh` then REST; repo/blob/tree via REST.
// Shallow clone only for repo roots under 350MB when git is available (Pi githubClone default).

import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const NON_CODE = new Set(["issues", "pull", "pulls", "actions", "projects", "security", "pulse", "wiki", "discussions", "releases", "tags", "labels", "milestones", "commit", "commits", "compare", "stargazers", "watchers", "network", "graphs", "settings"]);

function validOwner(owner) {
	return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner) && !owner.includes("--");
}
function validRepo(repo) {
	return /^[A-Za-z0-9._-]{1,100}$/.test(repo) && repo !== "." && repo !== "..";
}

export function parseGitHubUrl(raw) {
	let url;
	try { url = new URL(raw); } catch { return null; }
	const host = url.hostname.toLowerCase();
	if (host !== "github.com" && host !== "www.github.com") return null;
	const segments = url.pathname.split("/").filter(Boolean).map((part) => {
		try { return decodeURIComponent(part); } catch { return ""; }
	});
	if (segments.length < 2) return null;
	const owner = segments[0];
	const repo = segments[1].replace(/\.git$/, "");
	if (!validOwner(owner) || !validRepo(repo)) return null;
	const route = segments[2]?.toLowerCase();
	if (route && NON_CODE.has(route) && route !== "pull" && route !== "issues") return null;
	if (!route) return { kind: "root", owner, repo };
	if ((route === "pull" || route === "issues") && /^\d+$/.test(segments[3] || "")) {
		if (route === "issues" && segments[4]) return null;
		return { kind: route === "pull" ? "pull" : "issue", owner, repo, number: Number(segments[3]) };
	}
	if ((route === "blob" || route === "tree") && segments[3]) {
		return { kind: route, owner, repo, ref: segments[3], path: segments.slice(4).join("/") };
	}
	return null;
}

async function ghJson(args, execImpl) {
	const run = execImpl ?? execFileAsync;
	const { stdout } = await run("gh", args, {
		timeout: 30_000,
		maxBuffer: 8 * 1024 * 1024,
		env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
	});
	return JSON.parse(stdout);
}

export async function renderIssueOrPr(info, { execImpl, fetchImpl = globalThis.fetch } = {}) {
	try {
		const view = await ghJson([info.kind === "pull" ? "pr" : "issue", "view", String(info.number), "--repo", `${info.owner}/${info.repo}`, "--json", "title,state,body,author,url"], execImpl);
		const body = view.body || "";
		return {
			url: view.url,
			title: view.title || `${info.owner}/${info.repo}#${info.number}`,
			content: `# ${view.title || info.number}\n\n${view.state || ""} by ${view.author?.login || "unknown"}\n\n${body}`,
		};
	} catch {
		const endpoint = info.kind === "pull" ? "pulls" : "issues";
		const response = await fetchImpl(`https://api.github.com/repos/${info.owner}/${info.repo}/${endpoint}/${info.number}`, {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "dsh-web-access" },
		});
		if (!response.ok) throw new Error(`GitHub ${info.kind} ${response.status}`);
		const data = await response.json();
		return {
			url: data.html_url,
			title: data.title || "",
			content: `# ${data.title || info.number}\n\n${data.state || ""}\n\n${data.body || ""}`,
		};
	}
}

export async function renderRepo(info, { fetchImpl = globalThis.fetch, cloneImpl, forceClone = false } = {}) {
	const headers = { Accept: "application/vnd.github+json", "User-Agent": "dsh-web-access" };
	const repoResponse = await fetchImpl(`https://api.github.com/repos/${info.owner}/${info.repo}`, { headers });
	if (!repoResponse.ok) throw new Error(`GitHub repo ${repoResponse.status}`);
	const repo = await repoResponse.json();
	const ref = info.ref || repo.default_branch || "HEAD";
	let fileText = "";
	if (info.kind === "blob" && info.path) {
		const file = await fetchImpl(`https://api.github.com/repos/${info.owner}/${info.repo}/contents/${info.path}?ref=${encodeURIComponent(ref)}`, { headers });
		if (!file.ok) throw new Error(`GitHub file ${file.status}`);
		const data = await file.json();
		fileText = data.content ? Buffer.from(data.content, "base64").toString("utf8") : "";
		return { url: data.html_url || "", title: info.path, content: fileText };
	}
	const treeResponse = await fetchImpl(`https://api.github.com/repos/${info.owner}/${info.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, { headers });
	const tree = treeResponse.ok ? await treeResponse.json() : { tree: [] };
	const prefix = info.path ? `${info.path.replace(/\/$/, "")}/` : "";
	const lines = (tree.tree || [])
		.filter((entry) => !prefix || entry.path === info.path || entry.path.startsWith(prefix))
		.slice(0, 200)
		.map((entry) => `${entry.type === "tree" ? "dir" : "file"} ${entry.path}`);
	let readme = "";
	if (!info.path) {
		const readmeResponse = await fetchImpl(`https://api.github.com/repos/${info.owner}/${info.repo}/readme`, {
			headers: { ...headers, Accept: "application/vnd.github.raw" },
		});
		if (readmeResponse.ok) readme = await readmeResponse.text();
	}
	const sizeKb = Number(repo.size) || 0;
	const tooBig = sizeKb > 350 * 1024 && !forceClone;
	let clonePath = "";
	if (!tooBig && info.kind === "root" && cloneImpl !== false) {
		const clone = cloneImpl ?? defaultClone;
		try { clonePath = await clone(info, repo.default_branch); } catch { clonePath = ""; }
	}
	const content = [
		`# ${repo.full_name}`,
		repo.description || "",
		clonePath ? `\nLocal clone: ${clonePath}` : tooBig ? "\nRepo exceeds 350MB; API view only. Pass forceClone to clone anyway." : "",
		readme ? `\n## README\n\n${readme.slice(0, 20_000)}` : "",
		lines.length ? `\n## Tree\n\n${lines.join("\n")}` : "",
	].filter(Boolean).join("\n");
	return { url: repo.html_url, title: repo.full_name, content };
}

async function defaultClone(info, branch) {
	const dir = mkdtempSync(join(tmpdir(), "dsh-web-gh-"));
	const args = ["clone", "--depth", "1"];
	if (branch) args.push("--branch", branch);
	args.push(`https://github.com/${info.owner}/${info.repo}.git`, dir);
	await execFileAsync("git", args, { timeout: 120_000 });
	return dir;
}
