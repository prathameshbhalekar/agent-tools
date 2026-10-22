make a cloudflare worker
- should be deployed with "deploy on cloudflare button"
- before deployment, it will ask for api key, that api key will come for out application's interface.
- it will attach as a middleware to the existing API endpoint
- on certain entpoints (will be setup on our application), it will respond with x402 response and if payment proof is present, it will validate and inject payment proof in the request and propgate to underlying server
- on certain endpoints (will aslo be setup on application), it will log request and response data to our api for analytics (reference: https://agentcat.com/app/dashboard/)
