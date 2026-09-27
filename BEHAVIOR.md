# Behaviour checklist

Source: `pi-web-access` 0.32.0 (MIT, Nico Bailon). User config: `~/.pi/web-search.json` keys only — `provider: [tavily, perplexity]`, `workflow: none`, Firecrawl base URL, tools `webSearch` / `sourceCheck` / `fetchContent` / `getSearchContent` enabled, commands `websearch` / `curator` / `search` enabled. Secrets stay in that file or `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`.

DSH TUI preset disables `tool-web` (`dsh-tui` `cordis.patch.yml`). Built-in `web_search` / `web_fetch` are therefore not on the daily tool list. `ctx.web` still pins `searchProvider: deepseek-official` and `fetchProvider: http`. This plugin does not register another search provider (that would be ambiguous or would ignore the pin). HTML fetch goes through `ctx.web.fetch`.

| item | Pi evidence | DSH mapping | status | test |
| --- | --- | --- | --- | --- |
| provider array searches those providers together | `index.ts` `resolveProvider` returns `all` for arrays; `gemini-search.ts` `searchWithProviders` uses `allSettled`, dedupes URLs, keeps provider errors | `src/search.js` `searchQuery` for `tavily` and `perplexity` only | ported | `behavior.test.js` search merge |
| workflow `none` returns bounded results plus `responseId` | `formatFullResults`, `presentSearch` guidance, user `workflow: none` | `presentSearch` + disk cache | ported | `presentSearch` assertion |
| curator / `summary-review` / `auto-summary` | `index.ts` curator server | no DSH curator surface | gap | tool throws if workflow is not `none` |
| `web_enable` hides tools until called; fresh session | `tool-activation.ts` `setActiveTools` | `tools.restrict({deny})` on `agent/created` for `startup` and `clear`. Needs agent scope (`dsh-tools` `restrict` throws on the root context) | ported | `activation.test` via `createActivation` |
| resume keeps the recorded tool set | `tool-activation.ts` replays `toolsAdded` | DSH has no `toolsAdded` transcript. `resume` / `compact` skip the gate, so tools start visible | gap | resume does not call `restrict` |
| `fetch_content` GitHub issue/PR | `github-issue-pr.ts` `gh` then REST | `gh` JSON then public REST. No review threads, checks, or comment anchors | partial | issue REST fallback |
| `fetch_content` GitHub repo clone | `github-extract.ts` clone under 350MB, API view above | REST tree + README, shallow `git clone` when size ≤ 350MB | partial | parser unit; clone not executed in tests |
| PDF `unpdf` | `pdf-extract.ts` auto chain Datalab → Gemini → unpdf | local `unpdf` only (no Datalab/Gemini keys on this config). Public-IP check is one DNS lookup, not the full `dsh-web-fetch-http` NAT64 pin | ported | dependency pinned; no binary fixture |
| YouTube Gemini understanding | `youtube-extract.ts` | Perplexity text summary only (the configured fallback) | partial | `summarize` via injected search |
| frame extraction / local video | `youtube-extract.ts`, `video-extract.ts` | no yt-dlp/ffmpeg pipeline, no Gemini Files | gap | call throws |
| readable HTML + Firecrawl when thin | Readability + `extractWithFirecrawl` lockdown unless fresh scrape | Readability/Turndown when installed, else tag strip. Firecrawl v2 `lockdown: true` | ported | thin page sets `lockdown` |
| `mode: raw` skips readability and Firecrawl | README | `fetch-content.js` | ported | raw page does not call Firecrawl |
| `mode: answer` | `page-query.ts` | no answer-model seam | gap | throws |
| `get_search_content` offset/limit/findText | `index.ts`, 1h / 128 entries / 128MiB, mode 0700/0600 | `$DSH_HOME/web-search-cache` (not `~/.pi`) | ported | page + case-insensitive find |
| `source_check` never auto-labels support | `source-check.ts` `assessClaim` | same statuses `unclear` / `missing-evidence`, 20 sources, 5 fetches | ported | artifact test |
| `/search` | command runs search without curator | `ctx.commands` `/search` | ported | not executed inside DSH in unit tests |
| `/websearch`, `/curator` | browser curator | commands return an error pointing at `/search` | gap | — |
| other search providers, proxy, browser-cookie auth, activity monitor, shortcuts | README | not in the user config; no DSH widget/shortcut seam for the monitor | gap | `!command` credentials are not executed |
| built-in `web_fetch` HTML/text SSRF | — | `dsh-web-fetch-http` via `ctx.web.fetch` for ordinary pages | built-in | used by `httpFetch` in `src/index.js` |
| built-in `web_search` | `dsh-tool-web` | disabled in TUI; DeepSeek provider ≠ user providers | gap if re-enabled | do not enable `tool-web` beside this plugin (duplicate `web_search`) |
