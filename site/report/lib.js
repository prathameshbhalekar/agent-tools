// Report logic, no DOM. Checks follow the AgentReady spec: layer (find/read/act), strength (MUST/SHOULD/MAY).
// The spec leaves scoring to tools; ours is deliberately simple so the report can explain it in one sentence.

export const LAYERS = {
  find: { name: 'Find', question: 'Can agents discover and fetch your site?' },
  read: { name: 'Read', question: 'Can agents get the answer from what they fetch?' },
  act: { name: 'Act', question: 'Can agents complete a task through an interface?' },
};

export const WEIGHT = { MUST: 3, SHOULD: 2, MAY: 1 };
const CREDIT = { pass: 1, warn: 0.5, fail: 0 };
const GRADES = [[90, 'A'], [80, 'B'], [60, 'C'], [40, 'D'], [0, 'F']];

export function normalizeUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { error: 'Enter a website address.' };
  let url;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That doesn't look like a website address." };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Use an http or https address.' };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.includes('.') || host.endsWith('.') || host.startsWith('.')) return { error: 'Include the full domain, like example.com.' };
  return { host };
}

// A check applies when every condition it lists is true for this site (e.g. ['act'], ['docs']).
export const applies = (check, profile) => (check.when ?? []).every(c => profile[c]);

const scored = (c, profile) => applies(c, profile) && c.status in CREDIT;

export function score(checks, profile) {
  const total = list => {
    const counted = list.filter(c => scored(c, profile));
    const possible = counted.reduce((n, c) => n + WEIGHT[c.strength], 0);
    const earned = counted.reduce((n, c) => n + WEIGHT[c.strength] * CREDIT[c.status], 0);
    return possible ? { value: Math.round((earned / possible) * 100), checks: counted.length } : null;
  };
  const layers = Object.fromEntries(Object.keys(LAYERS).map(l => [l, total(checks.filter(c => c.layer === l))]));
  return { overall: total(checks), layers };
}

export const grade = value => GRADES.find(([min]) => value >= min)[1];

// Points the overall score would rise if this one check passed, under the method above.
export function gain(check, checks, profile) {
  if (!scored(check, profile) || check.status === 'pass') return 0;
  const possible = checks.filter(c => scored(c, profile)).reduce((n, c) => n + WEIGHT[c.strength], 0);
  return Math.round((WEIGHT[check.strength] * (1 - CREDIT[check.status]) / possible) * 100);
}

// Applicable checks that need work: MUST before SHOULD before MAY, failures before warnings, then find → read → act.
export function needsWork(checks, profile) {
  const order = Object.keys(LAYERS);
  return checks
    .filter(c => applies(c, profile) && (c.status === 'fail' || c.status === 'warn'))
    .sort((a, b) =>
      WEIGHT[b.strength] - WEIGHT[a.strength] ||
      CREDIT[a.status] - CREDIT[b.status] ||
      order.indexOf(a.layer) - order.indexOf(b.layer));
}

export function tally(checks, profile) {
  const t = { pass: 0, warn: 0, fail: 0, untested: 0, na: 0 };
  for (const c of checks) t[applies(c, profile) ? c.status : 'na']++;
  return t;
}
