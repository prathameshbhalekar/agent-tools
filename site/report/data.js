// Scan result for alliance.xyz, mapped onto AgentReady check IDs. Replace with the scanner response; pages only read this shape.
// Results visible in the current Site Report screens are used as-is. `sample: true` marks values filled in so every
// layer has content; the real scanner supplies those.

export const report = {
  host: 'alliance.xyz',
  scannedAt: '2026-10-22T14:02:00Z',
  durationSec: 30,
  price: 30,
  testMode: true,

  // Detected, editable. `act` decides whether the Act layer is scored.
  profile: {
    type: 'Startup accelerator',
    act: false,
    docs: false,
    pricing: false,
    payments: false,
  },
  conditions: {
    act: 'Agents should complete tasks here (sign up, buy, call an API)',
    docs: 'The site has developer documentation',
    pricing: 'The site sells something with published prices',
    payments: 'Agents can pay on the site',
  },

  checks: [
    // ---------- Find ----------
    {
      id: 'AR-FIND-01', layer: 'find', strength: 'MUST', status: 'pass',
      title: 'robots.txt and bot protection let agents in',
      summary: 'Major AI crawlers are allowed, and no challenge page was returned to verified agents.',
    },
    {
      id: 'AR-FIND-02', layer: 'find', strength: 'SHOULD', status: 'untested', when: ['docs'],
      title: 'First-party docs are the canonical answer',
      summary: 'No documentation section was found.',
    },
    {
      id: 'AR-FIND-03', layer: 'find', strength: 'SHOULD', status: 'pass', sample: true,
      title: 'sitemap.xml lists public pages',
      summary: 'sitemap.xml is referenced from robots.txt and returns 200.',
    },
    {
      id: 'AR-FIND-04', layer: 'find', strength: 'MAY', status: 'fail',
      title: 'AI Catalog published',
      summary: 'No agent discovery file was found.',
      evidence: ['GET /.well-known/ai-catalog.json', '404 Not Found'],
      why: 'An emerging convention. Agents mostly reach discovery files through links on pages they already visit, so on its own it changes little.',
      fix: 'Optional. Publish the catalog, and link it from a page agents fetch, such as your homepage footer.',
      verify: 'curl -s -o /dev/null -w "%{http_code}\\n" https://alliance.xyz/.well-known/ai-catalog.json',
    },

    // ---------- Read ----------
    {
      id: 'AR-READ-01', layer: 'read', strength: 'MUST', status: 'pass', sample: true,
      title: 'The answer is in the initial HTML',
      summary: 'Homepage and programme pages carry their main text without running JavaScript.',
    },
    {
      id: 'AR-READ-02', layer: 'read', strength: 'MUST', status: 'pass',
      title: 'HTTP status codes are correct',
      summary: 'A missing page returns 404 rather than a 200 error page.',
      evidence: ['GET /__site-404-probe-8x4hek5m', '404 Not Found'],
    },
    {
      id: 'AR-READ-03', layer: 'read', strength: 'SHOULD', status: 'pass', sample: true,
      title: 'Homepage is readable as raw HTML with real links',
      summary: 'Navigation uses <a href> links that resolve without JavaScript.',
    },
    {
      id: 'AR-READ-04', layer: 'read', strength: 'SHOULD', status: 'untested', when: ['docs'],
      title: 'Docs pages answer questions directly',
      summary: 'No documentation section was found.',
    },
    {
      id: 'AR-READ-07', layer: 'read', strength: 'SHOULD', status: 'fail', sample: true,
      title: 'llms.txt describes the site',
      summary: 'No llms.txt was found.',
      evidence: ['GET /llms.txt', '404 Not Found'],
      why: 'When agents read an llms.txt, about a third go on to fetch a page it lists. It gives them a short, accurate map of what Alliance offers.',
      fix: 'Publish /llms.txt with a one-paragraph description and links to the programme, apply and portfolio pages. Link to it from the homepage.',
      verify: 'curl -s https://alliance.xyz/llms.txt | head -20',
    },
    {
      id: 'AR-READ-08', layer: 'read', strength: 'SHOULD', status: 'warn',
      title: 'Structured data (JSON-LD) is complete',
      summary: 'Organization data is present but incomplete.',
      issues: ['contactPoint and address are missing', 'sameAs links to LinkedIn only'],
      evidence: ['@type: Organization', 'missing: contactPoint, address', 'sameAs: ["linkedin.com/company/…"]'],
      why: 'Agents use these fields to answer "how do I contact Alliance" and to be sure they have the right organisation. Repeat the same facts as visible text on the page.',
      fix: 'Add contactPoint and address to the existing Organization block, and list your other official profiles in sameAs.',
      verify: "curl -s https://alliance.xyz | grep -o -E '\"(contactPoint|address|sameAs)\"'",
      task: {
        file: 'AR-READ-08-structured-data.md',
        change: 'Extend the Organization JSON-LD in the homepage <head>. Keep the same email and city visible in the footer.',
        snippet: '{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Alliance",\n  "url": "https://alliance.xyz",\n  "contactPoint": {\n    "@type": "ContactPoint",\n    "contactType": "applications",\n    "email": "…"\n  },\n  "address": { "@type": "PostalAddress", "addressLocality": "…", "addressCountry": "…" },\n  "sameAs": ["https://www.linkedin.com/company/…", "https://x.com/…", "https://github.com/…"]\n}',
        criteria: [
          'The homepage HTML contains contactPoint, address and at least two sameAs profiles.',
          'The email and location match the visible footer text.',
          'The JSON-LD parses without errors.',
        ],
        verifyNote: 'All three field names should print. Then rescan to confirm AR-READ-08 passes.',
      },
    },
    {
      id: 'AR-READ-09', layer: 'read', strength: 'MAY', status: 'warn',
      title: 'Markdown versions of pages',
      summary: 'Pages return HTML when an agent asks for text/markdown.',
      evidence: ['GET /__site-404-probe-8x4hek5m', 'Accept: text/markdown', '404 · Content-Type: text/html'],
      why: 'Agents ask for Markdown often, but in the research format did not decide whether they succeeded. Low priority for a site like this.',
      fix: 'Optional. Serve a Markdown version when the Accept header asks for text/markdown, starting with the homepage.',
      verify: "curl -sS -I -H 'Accept: text/markdown' https://alliance.xyz/",
    },
    {
      id: 'AR-READ-11', layer: 'read', strength: 'SHOULD', status: 'untested', when: ['pricing'],
      title: 'Pricing is text on a first-party page',
      summary: 'No pricing page was found.',
    },

    // ---------- Act (scored only when agents should complete tasks) ----------
    {
      id: 'AR-ACT-01', layer: 'act', strength: 'SHOULD', status: 'fail', when: ['act'],
      title: 'Agents can get credentials',
      summary: 'No OAuth discovery metadata or self-serve API keys were found.',
    },
    {
      id: 'AR-ACT-02', layer: 'act', strength: 'SHOULD', status: 'fail', when: ['act'],
      title: 'Public API with an OpenAPI contract',
      summary: 'No publicly reachable REST or GraphQL API, and no OpenAPI document.',
    },
    {
      id: 'AR-ACT-03', layer: 'act', strength: 'SHOULD', status: 'fail', when: ['act'],
      title: 'MCP server',
      summary: 'No MCP server or manifest was found.',
    },
    {
      id: 'AR-ACT-04', layer: 'act', strength: 'MAY', status: 'fail', when: ['act'],
      title: 'MCP server card',
      summary: 'No server card at /.well-known/mcp/server-card.json or the other standard paths.',
    },
    {
      id: 'AR-ACT-08', layer: 'act', strength: 'MAY', status: 'untested', when: ['act', 'payments'],
      title: 'Agent payments',
      summary: 'No checkout was found to test.',
    },
    {
      id: 'AR-ACT-10', layer: 'act', strength: 'MUST', status: 'fail', when: ['act'],
      title: 'At least one MCP server or CLI',
      summary: 'Agents have no interface to complete tasks through.',
    },
  ],
};
