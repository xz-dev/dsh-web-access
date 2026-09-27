# dsh-web-access

Port of [pi-web-access](https://github.com/nicobailon/pi-web-access) (MIT, Copyright 2025 Nico Bailon) onto DeepSeek Harness. Not a fork of the extension. Behaviour that the daily DSH TUI already has is left alone. See [BEHAVIOR.md](BEHAVIOR.md).

Configured like the user's Pi `web-search.json`:

- `provider: ["tavily", "perplexity"]` runs both and merges URLs
- `workflow: "none"`
- Firecrawl (`FIRECRAWL_BASE_URL` / `firecrawlBaseUrl`) as a cache-only scrape when a page is thin
- keys from `TAVILY_API_KEY`, `PERPLEXITY_API_KEY`, `FIRECRAWL_API_KEY`, or the same names in `web-search.json` (`$ENV` refs work; `!shell` credentials do not)

Tools: `web_enable`, `web_search`, `fetch_content`, `source_check`, `get_search_content`.

`web_enable` hides the heavy tools on a new TUI session (`startup` / `clear`) until the model calls it. Resumed sessions show the tools immediately.

Keep the TUI `tool-web` row disabled. It also registers `web_search`.

## Install

```sh
node ~/.local/share/dsh/npm/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile tui add file:/absolute/path/dsh-web-access-0.1.0.tgz --ignore-scripts
```

The package `cordis.patch.yml` inserts `dsh-web-access` with `gate: true`. No extra rows. Do not put API keys in the patch.

## License

Upstream MIT, Copyright (c) 2025 Nico Bailon. See [LICENSE](LICENSE).
