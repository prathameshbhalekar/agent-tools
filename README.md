# agent-helper

| Folder | What |
|---|---|
| [`worker/`](worker) | Cloudflare Worker that customers deploy in front of their API. It enforces x402 paywalls and ships analytics logs. |
| [`app/`](app) | Our application server. It issues API keys, stores route config, verifies x402 payments through a facilitator, and stores logs. |

Flow: client → **worker** → (config / verify / logs → **app** → x402 facilitator) → customer origin.
