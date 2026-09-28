# dsh-web-access

Web research tools for DeepSeek Harness, ported from [pi-web-access](https://github.com/nicobailon/pi-web-access) (MIT, Copyright 2025 Nico Bailon). Not a fork of the extension. Behaviour that the daily DSH TUI already has is left alone. See [BEHAVIOR.md](BEHAVIOR.md).

- Tavily and Perplexity run together and URLs are merged
- `workflow: "none"` only (no curator UI)
- Firecrawl as a cache-only scrape when a page is thin
- Tools: `web_enable`, `web_search`, `fetch_content`, `source_check`, `get_search_content`; command `/search`

`web_enable` hides the heavy tools on a new TUI session (`startup` / `clear`) until the model calls it. Resumed sessions show the tools immediately.

Keep the TUI `tool-web` row disabled. It also registers `web_search`.

## Secrets

Read per call through the DSH credentials service (`$DSH_HOME/.credentials.yaml`, the launch environment, or `.env`), never from the plugin config:

| name | used for |
|---|---|
| `TAVILY_API_KEY` | Tavily search |
| `PERPLEXITY_API_KEY` | Perplexity search and YouTube summaries |
| `FIRECRAWL_BASE_URL` | Firecrawl endpoint; unset disables the fallback |
| `FIRECRAWL_API_KEY` | Firecrawl bearer token (optional for self-hosted) |

```yaml
# $DSH_HOME/.credentials.yaml (mode 0600)
version: 1
refs:
  TAVILY_API_KEY: tvly-…
  PERPLEXITY_API_KEY: pplx-…
```

## Config

| key | default | |
|---|---|---|
| `gate` | `true` | hide heavy tools until `web_enable` |
| `maxInlineContentChars` | `30000` | inline result cap; the rest via `get_search_content` |
| `providers` | `[]` (= tavily + perplexity) | |
| `tools.{webSearch,sourceCheck,fetchContent,getSearchContent}` | `true` | |
| `commands.{search,websearch,curator}` | `true` | `websearch`/`curator` only explain that the curator is unavailable |

## Install

```sh
dsh plugin --profile tui add file:/absolute/path/dsh-web-access-0.2.0.tgz --ignore-scripts
```

## License

Upstream MIT, Copyright (c) 2025 Nico Bailon. See [LICENSE](LICENSE).
