type Track = 'stock' | 'etf';

function activate(group: HTMLElement, target: Track) {
  const tabs = group.querySelectorAll<HTMLButtonElement>('[data-track-tab]');
  tabs.forEach((tab) => {
    const isActive = tab.dataset.trackTab === target;
    tab.classList.toggle('bg-slate-800', isActive);
    tab.classList.toggle('text-slate-100', isActive);
    tab.classList.toggle('text-slate-400', !isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  const groupId = group.dataset.trackGroup ?? '';
  const panels = document.querySelectorAll<HTMLElement>(
    `[data-track-panel][data-track-group="${groupId}"]`
  );
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.trackPanel !== target;
  });
}

function init() {
  const groups = document.querySelectorAll<HTMLElement>('[data-track-group][data-track-tabs]');
  groups.forEach((group) => {
    const tabs = group.querySelectorAll<HTMLButtonElement>('[data-track-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.trackTab as Track;
        activate(group, target);
      });
    });
    const initial = (group.querySelector<HTMLButtonElement>('[data-track-tab][aria-selected="true"]') ??
      tabs[0]
    )?.dataset.trackTab as Track | undefined;
    if (initial) activate(group, initial);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
