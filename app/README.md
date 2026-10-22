# agent-helper app

This is the dashboard and backend for the worker: sign-up and login, API keys, route config, x402 payment verification, payment history, and analytics logs.
It uses Node ≥ 22.13 with no dependencies (built-in `http` and `node:sqlite`). The dashboard is a single page, `public/index.html`, served at `/`.

```sh
npm start   # http://localhost:8787
npm test
```

| Env | Default | What |
|---|---|---|
| `PORT` | `8787` | |
| `DB_PATH` | `agent-helper.db` | SQLite file |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator used for `/verify` and `/settle` (testnet). Point it at a mainnet facilitator, e.g. Coinbase CDP, for real money. |

## Dashboard

- **Overview:** revenue, payments, logged requests, error rate and latency, with daily charts and top routes.
- **Routes:** add, reorder and remove routes; turn logging on or off; set a USDC price, network and pay-to wallet for paywalled routes.
- **Payments:** settled payments with links to the Basescan transaction.
- **Logs:** logged requests; click a row to see the redacted headers and the bodies.
- **API key & setup:** show, copy or rotate the key, plus the worker deploy steps.

## API

The dashboard authenticates with an `sid` session cookie (HttpOnly, SameSite=Lax). The worker uses `Authorization: Bearer <API_KEY>`. Every endpoint below accepts either.

| Endpoint | What |
|---|---|
| `POST /v1/signup` `{email, password}` | Creates an account and API key and starts a session. Passwords must be at least 8 characters and are hashed with scrypt. |
| `POST /v1/login` / `POST /v1/logout` | Starts or ends a session. |
| `GET /v1/me` | Returns `{email, apiKey}`. |
| `POST /v1/key/rotate` | Issues a new key; the old one stops working immediately. |
| `GET` / `PUT /v1/routes` | Gets or replaces the route list `[{method?, path, paywall?: {accepts:[...]}, log?}]`. The first match wins. |
| `GET /v1/stats?days=7\|30\|90` | Returns totals, a daily series and the top routes. |
| `GET /v1/payments?limit&before` | Lists settled payments, newest first, with paging via `next`. |
| `GET /v1/logs?limit&before` | Lists logs, newest first, with paging via `next`. |
| `GET /v1/worker/config` | Worker: returns `{routes}`. |
| `POST /v1/worker/verify` `{payment, accepts, method, url}` | Worker: decodes `X-PAYMENT`, picks the matching `accepts` entry, and calls facilitator `/verify` then `/settle`. If both succeed it records the payment. Returns `{valid, error?, payer?, paymentResponse?}`. |
| `POST /v1/worker/logs` | Worker: stores one request/response log. |

The worker fills in each payment requirement's `resource` from the request URL, so routes saved from the dashboard leave it out.
