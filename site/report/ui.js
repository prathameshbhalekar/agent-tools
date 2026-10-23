// Shared HTML snippets for the Site Report pages. Everything from scan data goes through esc().

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fmtDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

const LABEL = { pass: 'Passed', warn: 'Warning', fail: 'Failed', untested: 'Not tested', na: 'Not scored' };
export const status = s => `<span class="status status--${s}">${LABEL[s]}</span>`;
export const strength = s => `<span class="strength strength--${s}" title="${s === 'MUST' ? 'Agents fail without it' : s === 'SHOULD' ? 'Measurably changes agent behaviour' : 'Emerging convention'}">${s}</span>`;

const R = 54, C = 2 * Math.PI * R;
export const ring = (value, { small } = {}) => `
  <div class="ring${small ? ' ring--sm' : ''}" role="img" aria-label="Score ${value} out of 100">
    <svg viewBox="0 0 128 128" aria-hidden="true"><circle class="ring__track" cx="64" cy="64" r="${R}"/>
      <circle class="ring__value" cx="64" cy="64" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - value / 100)).toFixed(1)}"/></svg>
    <div class="ring__label"><b>${value}</b>${small ? '' : '<span>out of 100</span>'}</div>
  </div>`;

export const evidence = lines => lines?.length
  ? `<pre class="evidence"><span class="evidence__label">What the scan saw</span>${esc(lines.join('\n'))}</pre>` : '';

export const code = text => `<pre class="code">${esc(text)}<button class="copy" type="button" data-copy="${esc(text)}">Copy</button></pre>`;

export const verify = text => /^(curl|wget|grep)\b/.test(text) ? code(text) : `<p class="read">${esc(text)}</p>`;

// The implementation task every applicable finding gets in the paid plan, rendered as the file the buyer receives.
export const taskFile = c => `
  <article class="file">
    <div class="file__bar"><span class="mono">${esc(c.task.file)}</span>${strength(c.strength)}</div>
    <div class="file__body">
      <div class="step"><h4>Observed</h4><div><p class="read">${esc(c.summary)}</p>${evidence(c.evidence)}</div></div>
      <div class="step"><h4>Why it matters</h4><div><p class="read">${esc(c.why)}</p></div></div>
      <div class="step"><h4>Change</h4><div><p class="read">${esc(c.task.change)}</p>${code(c.task.snippet)}</div></div>
      <div class="step"><h4>Done when</h4><div><ul class="criteria">${c.task.criteria.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></div>
      <div class="step"><h4>Verify</h4><div>${code(c.verify)}<p class="t-small">${esc(c.task.verifyNote)}</p></div></div>
    </div>
  </article>`;

export function wireCopy() {
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.dataset.copy);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => (btn.textContent = 'Copy'), 1600);
  });
}
