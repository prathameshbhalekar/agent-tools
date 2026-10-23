// ponytail: vanilla JS, no framework or bundler.

// tabs: [data-tabs] > [role=tab]; aria-controls is optional (vertical tabs have no separate panel)
document.querySelectorAll('[data-tabs]').forEach(root => {
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const select = tab => tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', on);
    t.tabIndex = on ? 0 : -1;
    const panel = t.getAttribute('aria-controls');
    if (panel) document.getElementById(panel).hidden = !on;
  });
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', e => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      const next = tabs[(i + d + tabs.length) % tabs.length];
      select(next);
      next.focus();
    });
  });
});

// segmented toggles: [data-toggle] > [aria-pressed]. data-period on the group swaps [data-monthly]/[data-yearly] text in its scope.
document.querySelectorAll('[data-toggle]').forEach(group => group.addEventListener('click', e => {
  const btn = e.target.closest('[aria-pressed]');
  if (!btn) return;
  group.querySelectorAll('[aria-pressed]').forEach(b => b.setAttribute('aria-pressed', b === btn));
  const scope = group.closest('[data-pricing]');
  if (scope && btn.dataset.period) scope.querySelectorAll(`[data-${btn.dataset.period}]`).forEach(el => el.textContent = el.dataset[btn.dataset.period]);
}));
