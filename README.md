# agent-helper

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/prathameshbhalekar/agent-tools/tree/main/worker)

| Folder | What |
|---|---|
| [`worker/`](worker) | Cloudflare Worker that customers deploy in front of their API. It enforces x402 paywalls and ships analytics logs. |
| [`site/`](site) | Design system (tokens, components, showcase in `system.html`) and the Site Report frontend in `site/report/`. |
| [`app/`](app) | Our application server. It issues API keys, stores route config, verifies x402 payments through a facilitator, and stores logs. |

Flow: client → **worker** → (config / verify / logs → **app** → x402 facilitator) → customer origin.
