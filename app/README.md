# agent-helper app

Backend for the worker: accounts and API keys, route config, x402 payment verification, and analytics logs.
It uses Node ≥ 22.13 with no dependencies (built-in `http` and `node:sqlite`).

```sh
ADMIN_TOKEN=change-me npm start   # :8787
npm test
```

| Env | Default | What |
|---|---|---|
| `PORT` | `8787` | |
| `DB_PATH` | `agent-helper.db` | SQLite file |
| `ADMIN_TOKEN` | — | Required to create accounts |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator used for `/verify` and `/settle` (testnet). Point it at a mainnet facilitator, e.g. Coinbase CDP, for real money. |

## API

Every call except `/health` and account creation needs `Authorization: Bearer <API_KEY>`.

| Endpoint | Caller | What |
|---|---|---|
| `POST /v1/accounts` `{name}` | admin (`Bearer ADMIN_TOKEN`) | Creates an account and returns `{apiKey}`. The customer enters this key in the Deploy button. |
| `PUT /v1/routes` `{routes:[...]}` | dashboard | Replaces the route list. Each route is `{method?, path, paywall?: {accepts:[...]}, log?}` and the first match wins. |
| `GET /v1/routes` | dashboard | Returns the current routes. |
| `GET /v1/logs?limit=50&before=<id>` | dashboard | Returns logs newest first, with paging via `next`. |
| `GET /v1/worker/config` | worker | Returns `{routes}`. |
| `POST /v1/worker/verify` `{payment, accepts}` | worker | Decodes `X-PAYMENT`, picks the matching `accepts` entry, then calls facilitator `/verify` and `/settle`. Returns `{valid, error?, payer?, paymentResponse?}`. |
| `POST /v1/worker/logs` | worker | Stores one request/response log. |

Example setup:
```sh
curl -XPOST localhost:8787/v1/accounts -H 'authorization: Bearer change-me' -d '{"name":"acme"}'
curl -XPUT localhost:8787/v1/routes -H 'authorization: Bearer ah_...' -d '{"routes":[
  {"method":"GET","path":"/api/premium/*","log":true,"paywall":{"accepts":[{"scheme":"exact","network":"base-sepolia",
   "maxAmountRequired":"10000","resource":"https://api.acme.com/api/premium","description":"Premium data",
   "mimeType":"application/json","payTo":"0xYourWallet","maxTimeoutSeconds":60,
   "asset":"0x036CbD53842c5426634e7929541eC2318f3dCF7e","extra":{"name":"USDC","version":"2"}}]}},
  {"path":"/api/search","log":true}]}'
```
