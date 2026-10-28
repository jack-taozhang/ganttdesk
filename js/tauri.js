'use strict';

/* Thin bridge to the Tauri desktop shell. In a normal browser the API is
   absent and every method is a no-op, so the same files keep working. */
const TauriBridge = (() => {
  const api = window.__TAURI__;
  const available = !!(api && api.core && typeof api.core.invoke === 'function');

  async function load() {
    if (!available) return null;
    try {
      const raw = await api.core.invoke('load_data');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('Could not read ProjectPlan.dplan beside the app', e);
      return null;
    }
  }

  async function save(payload) {
    if (!available) return false;
    try {
      await api.core.invoke('save_data', { content: JSON.stringify(payload, null, 2) });
      return true;
    } catch (e) {
      console.warn('Could not write ProjectPlan.dplan beside the app', e);
      return false;
    }
  }

  // The desktop window has no native caption, so the title bar buttons in the
  // page drive it. Browsers keep the buttons hidden (body.tauri is not set).
  function currentWindow() {
    if (!available || !api.window || typeof api.window.getCurrentWindow !== 'function') return null;
    try { return api.window.getCurrentWindow(); } catch (e) { return null; }
  }

  function bindWindowControls() {
    if (!available) return;
    const win = currentWindow();
    if (!win) return;
    document.body.classList.add('tauri');
    const maxBtn = document.getElementById('winMax');
    const syncMax = (max) => {
      const use = maxBtn && maxBtn.querySelector('use');
      if (use) use.setAttribute('href', max ? '#i-restore' : '#i-max');
      if (maxBtn) maxBtn.title = max ? 'Restore' : 'Maximize';
    };
    document.querySelectorAll('#winControls [data-win]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.win;
        const run = action === 'minimize' ? win.minimize()
          : action === 'maximize' ? win.toggleMaximize()
            : action === 'close' ? win.close() : null;
        if (run && run.catch) run.catch((err) => console.warn('Window control failed', err));
      });
    });
    if (win.onResized) {
      win.onResized(() => {
        win.isMaximized().then(syncMax).catch(() => {});
      });
    }
    // Double-clicking the empty part of the bar toggles maximise, like a
    // native caption; buttons and menus keep their own clicks.
    const bar = document.querySelector('.titlebar');
    if (bar) {
      bar.addEventListener('dblclick', (e) => {
        if (e.target.closest('button')) return;
        win.toggleMaximize().catch(() => {});
      });
    }
    win.isMaximized().then(syncMax).catch(() => {});
  }

  return { available: () => available, load, save, bindWindowControls };
})();
