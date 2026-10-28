'use strict';

/* Application shell: tabs, ribbon, menus, dialogs, files and keyboard. */
const App = (() => {
  let openMenuName = null;
  let customItems = null;
  let initialized = false;

  function $(id) { return document.getElementById(id); }
  function tab() { return Store.active(); }
  function esc(s) { return U.escapeHtml(s); }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  // ---------- rendering ----------
  // `type` is the store event that triggered the redraw. A selection change and
  // a saved flag never alter task data, so they only repaint the parts that
  // actually move; everything else still does a full pass.
  function renderAll(ev) {
    const active = tab();
    // The pinned Overview page means the strip is never empty, but an unknown
    // active id is still handled: there is simply nothing to paint.
    if (!active) {
      document.body.classList.add('no-tabs');
      renderTabs();
      return;
    }
    document.body.classList.remove('no-tabs');
    const type = (ev && ev.detail && ev.detail.type) || 'project';
    if (type === 'selection') {
      Gantt.paintSelection();
      return;
    }
    if (type === 'save') {
      renderTabs();
      renderDocTitle(active);
      return;
    }
    // Anything that reaches here rewrote the project (an outline move, an undo,
    // a settings that reshapes the grid). The incremental cache compares row
    // counts and column layout, which do not change when a row is only moved or
    // renamed, so it has to be dropped explicitly or the outline would look
    // frozen while the model moved on.
    Gantt.invalidate();
    applyPalette(active.project);
    renderTabs();
    renderProjectHead(active.project);
    renderDocTitle(active);
    syncRibbon(active.project);
    Dashboard.render();
    Gantt.render();
  }

  // Tab tints follow the project theme; the maths lives in the model so the
  // overview and the strip cannot drift apart.
  function tint(hex, alpha) { return Model.alphaOn(hex, alpha, '26,111,209'); }

  function setPaletteVars(p) {
    const root = document.documentElement;
    root.style.setProperty('--bar', p.bar);
    root.style.setProperty('--bar-2', p.bar2);
    root.style.setProperty('--bar-progress', p.progress);
    root.style.setProperty('--summary', p.summary);
    root.style.setProperty('--ms', p.milestone);
    root.style.setProperty('--accent', p.accent);
    root.style.setProperty('--head', p.head);
    root.style.setProperty('--head-2', Model.mixHex(p.head, '#000000', 0.18));
  }

  function applyPalette(project) {
    setPaletteVars(Model.paletteOf(project));
  }

  // Live preview from the theme dialog, before it is applied.
  function previewPalette(patch) {
    const active = Store.active();
    const base = Model.paletteOf(active && active.project);
    setPaletteVars(Object.assign({}, base, patch || {}));
  }

  // Every project tab is tinted with its own theme colour so tabs stay
  // recognisable at a glance; the selected tab is highlighted with that colour.
  // The palette (preset + custom overrides) is the single source of truth.
  function renderTabs() {
    const box = $('tabs');
    if (!box) return;
    const active = tab();
    box.innerHTML = Store.tabs().map((t) => {
      const isActive = !!active && t.id === active.id;
      const pal = Model.paletteOf(t.project);
      const cls = 'ptab' + (isActive ? ' active' : '') + (t.pinned ? ' pinned' : '');
      const style = ' style="--tab-accent:' + pal.accent + ';--tab-head:' + pal.head +
        ';--tab-soft:' + tint(pal.accent, 0.14) + ';--tab-line:' + tint(pal.accent, 0.5) + '"';
      // Hover order is "label · project": the label is what the strip shows,
      // the project name is the context behind it.
      const projectName = (t.project && t.project.name) || '';
      const tip = projectName && projectName !== t.name
        ? t.name + ' · ' + projectName
        : t.name;
      const close = t.pinned
        ? ''
        : '<button class="close" data-tab-close="' + t.id + '" title="Close tab">' + U.icon('x') + '</button>';
      return '<div class="' + cls + '" data-tab-id="' + t.id + '" title="' + esc(tip) + '"' + style + '>' +
        '<span class="ptab-dot" aria-hidden="true"></span>' +
        '<span class="ptab-name" data-tab-name="' + t.id + '" title="' + esc(tip) + '">' + esc(t.name) + '</span>' +
        (t.sample ? '<span class="sample">sample</span>' : '') +
        close +
        '</div>';
    }).join('');
  }

  function renderProjectHead(project) {
    const name = $('projectName');
    if (name) name.textContent = project.name;
    const lead = $('leadName');
    if (lead) lead.textContent = project.lead || 'No lead';
    const s = Model.statsWithReferences(project, Store.allProjects());
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const dates = $('projectDates');
    if (dates) {
      dates.textContent = s.taskCount
        ? 'Starts ' + U.fmtDate(s.first, fmt) + ' · Finishes ' + U.fmtDate(s.last, fmt)
        : 'No tasks scheduled yet';
    }
    const head = $('projectHead');
    const headerStyle = (project.appearance && project.appearance.headerStyle) || Store.settings().headerStyle || 'banner';
    if (head) head.classList.toggle('compact', headerStyle === 'compact');
  }

  function renderDocTitle(active) {
    const title = $('docTitle');
    if (title) title.textContent = (active.name || 'project') + (active.dirty ? ' *' : '') + '  —  GanttDesk';
    document.title = (active.name || 'GanttDesk') + ' — GanttDesk';
  }

  function syncRibbon(project) {
    const view = project.view;
    document.querySelectorAll('#zoomButtons button').forEach((b) => {
      b.classList.toggle('active', b.dataset.zoom === (view.zoom || 'day'));
    });
    const ratio = $('zoomRatio');
    if (ratio && document.activeElement !== ratio) {
      const text = ((Gantt.zoomPercent ? Gantt.zoomPercent() : (Store.settings().planZoom || 100))) + '%';
      if (ratio.value !== text) ratio.value = text;
    }
    document.querySelectorAll('[data-toggle]').forEach((b) => {
      b.classList.toggle('on', !!view[b.dataset.toggle]);
    });
    const search = $('searchInput');
    if (search && document.activeElement !== search) search.value = Gantt.getSearch();
    const filter = $('filterSelect');
    if (filter && document.activeElement !== filter) filter.value = Gantt.getFilter();
    syncResourceFilter(project);
  }

  // Resources are listed by NAME, merged across the open plan and every plan
  // it references. A roster is local to its project, so ids cannot be shared;
  // the filter therefore matches the names shown in the RESOURCES column.
  function collectResources(project) {
    const byKey = new Map();
    function addPlan(p) {
      const byId = new Map();
      (p.resources || []).forEach((r) => { if (r && r.id) byId.set(r.id, r); });
      (p.tasks || []).forEach((t) => {
        (t.resources || []).forEach((a) => {
          const r = byId.get(a.resourceId);
          const name = String((r && r.name) || '').trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (!byKey.has(key)) byKey.set(key, name);
        });
      });
    }
    addPlan(project);
    (project.linkedProjects || []).forEach((link) => {
      const entry = Model.resolveLinkProject(link, Store.allProjects());
      if (entry) addPlan(entry.project);
    });
    return Array.from(byKey, ([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // The roster is data-driven, so the resource dropdown is rebuilt whenever the
  // rows' resource assignments change (an id signature keeps this off the hot path).
  function syncResourceFilter(project) {
    const select = $('resourceFilter');
    if (!select || !project) return;
    const list = collectResources(project);
    const current = Gantt.getResourceFilter();
    const sig = list.map((r) => r.key).join('|');
    if (select.dataset.sig !== sig) {
      select.innerHTML = '<option value="">All resources</option>' + list.map((r) =>
        '<option value="' + esc(r.key) + '">' + esc(r.name) + '</option>').join('');
      select.dataset.sig = sig;
      if (current && !list.some((r) => r.key === current)) Gantt.setResourceFilter('');
    }
    if (document.activeElement !== select) select.value = Gantt.getResourceFilter();
  }

  // ---------- menus ----------
  const SEP = { sep: true };
  function mi(label, action, opts) {
    return Object.assign({ label, action }, opts || {});
  }

  function menus() {
    const active = tab();
    const project = active ? active.project : null;
    const view = project ? project.view : {};
    const selected = Store.selection();
    const hasSelection = !!(project && selected.length && Model.getTask(project, selected[0]));
    return {
      file: [
        mi('New', 'new', { key: 'Ctrl+N', icon: 'plus' }),
        mi('Open...', 'open', { key: 'Ctrl+O', icon: 'open' }),
        SEP,
        mi('New tab', 'new-tab', { icon: 'plus' }),
        mi('Duplicate tab', 'duplicate-tab', { icon: 'copy' }),
        mi('Close tab', 'close-tab', { key: 'Ctrl+W', icon: 'x' }),
        mi('Close all tabs', 'close-all-tabs', { icon: 'x' }),
        SEP,
        mi('Save', 'save', { key: 'Ctrl+S', icon: 'save' }),
        mi('Save As...', 'save-as', { key: 'Ctrl+Shift+S', icon: 'save' }),
        SEP,
        mi('Import from Excel...', 'import', { icon: 'open' }),
        mi('Export to PDF...', 'export-pdf', { key: 'Ctrl+P', icon: 'print' }),
        mi('Export to image (PNG)...', 'export-png', { icon: 'image' }),
        mi('Export to Excel...', 'export-excel', { icon: 'export' }),
        SEP,
        mi('App settings...', 'settings', { icon: 'settings' }),
        mi('Exit', 'exit', { icon: 'exit' })
      ],
      edit: [
        mi('Undo', 'undo', { key: 'Ctrl+Z', icon: 'undo', disabled: () => !Store.canUndo() }),
        mi('Redo', 'redo', { key: 'Ctrl+Y', icon: 'redo', disabled: () => !Store.canRedo() }),
        SEP,
        mi('Find...', 'find', { key: 'Ctrl+F', icon: 'search' }),
        mi('Select all tasks', 'select-all', { key: 'Ctrl+A', icon: 'select-all' }),
        mi('Delete task', 'delete', { key: 'Delete', icon: 'trash', disabled: !hasSelection })
      ],
      task: [
        mi('Add task', 'task-add', { key: 'Insert', icon: 'task' }),
        mi('Add milestone', 'milestone-add', { icon: 'diamond' }),
        mi('Edit task...', 'task-edit', { key: 'F2', icon: 'pencil', disabled: !hasSelection }),
        mi('Duplicate task', 'duplicate', { icon: 'copy', disabled: !hasSelection }),
        mi('Delete task', 'delete', { icon: 'trash', disabled: !hasSelection }),
        SEP,
        mi('Indent', 'indent', { icon: 'indent', disabled: !hasSelection }),
        mi('Outdent', 'outdent', { icon: 'outdent', disabled: !hasSelection }),
        mi('Move up', 'move-up', { icon: 'up', disabled: !hasSelection }),
        mi('Move down', 'move-down', { icon: 'down', disabled: !hasSelection }),
        SEP,
        mi('Clear actual dates', 'clear-actuals', { icon: 'x' }),
        SEP,
        mi('Bar colour...', 'colours', { icon: 'palette', disabled: !hasSelection }),
        mi('Dependencies...', 'task-edit', { icon: 'link', disabled: !hasSelection })
      ],
      project: [
        mi('Edit project...', 'project-edit', { icon: 'pencil' }),
        SEP,
        mi('Resources...', 'resources', { icon: 'users' }),
        mi('Team calendar...', 'calendar', { icon: 'clock' }),
        mi('Bar colours...', 'colours', { icon: 'palette' }),
        SEP,
        mi('Capture baseline', 'capture-baseline', { icon: 'flag' }),
        mi('Clear baseline', 'clear-baseline', { icon: 'x' }),
        SEP,
        mi('Insert project here...', 'project-insert', { key: 'Ctrl+/', icon: 'plus' }),
        mi('Add project...', 'project-add', { icon: 'plus' }),
        mi('Archive project', 'archive-project', { icon: 'folder' }),
        mi('Unarchive project', 'unarchive-project', { icon: 'open' }),
        mi('Remove inserted projects...', 'project-unlink', { icon: 'trash' }),
        mi('Delete project...', 'project-delete', { icon: 'trash' }),
        mi('Dashboard', 'dashboard', { icon: 'dashboard' })
      ],
      view: [
        mi('Zoom: Day', 'zoom-day', { check: view.zoom === 'day' }),
        mi('Zoom: Week', 'zoom-week', { check: view.zoom === 'week' }),
        mi('Zoom: Month', 'zoom-month', { check: view.zoom === 'month' }),
        mi('Zoom: Quarter', 'zoom-quarter', { check: view.zoom === 'quarter' }),
        mi('Zoom: Half year', 'zoom-halfYear', { check: view.zoom === 'halfYear' }),
        mi('Zoom: Year', 'zoom-year', { check: view.zoom === 'year' }),
        SEP,
        mi('Go to today', 'today', { icon: 'calendar' }),
        mi('Dependencies', 'toggle-links', { icon: 'link', check: !!view.showLinks }),
        mi('Critical path', 'toggle-critical', { icon: 'flag', check: !!view.showCriticalPath }),
        SEP,
        mi('Expand all', 'expand-all', { icon: 'expand-all' }),
        mi('Collapse all', 'collapse-all', { icon: 'collapse-all' }),
        SEP,
        mi('Baseline bars', 'toggle-baseline', { icon: 'flag', check: !!view.showBaselineBars }),
        mi('Actual bars', 'toggle-actual', { icon: 'clock', check: !!view.showActualBars }),
        SEP,
        mi('Budget & cost', 'toggle-costs', { icon: 'palette', check: !!Store.settings().showCosts }),
        SEP,
        mi('Columns...', 'columns', { icon: 'dashboard' })
      ],
      help: [
        mi('Help contents', 'help', { icon: 'info' }),
        mi('Keyboard shortcuts', 'shortcuts', { key: 'F1', icon: 'keyboard' }),
        SEP,
        mi('Check for updates', 'update', { icon: 'clock' }),
        SEP,
        mi('About GanttDesk', 'about', { icon: 'info' })
      ]
    };
  }

  function closeMenu() {
    const layer = $('menuLayer');
    if (!layer) return;
    layer.classList.remove('open');
    layer.innerHTML = '';
    openMenuName = null;
    customItems = null;
    document.querySelectorAll('#menubar button').forEach((b) => b.classList.remove('open'));
  }

  function placeDropdown(anchor, dd) {
    const r = (anchor && anchor.clientX != null)
      ? { left: anchor.clientX, right: anchor.clientX, top: anchor.clientY, bottom: anchor.clientY }
      : anchor.getBoundingClientRect();
    const width = dd.offsetWidth || 240;
    const height = dd.offsetHeight || 260;
    let left = Math.max(6, Math.min(r.left, window.innerWidth - width - 8));
    let top = r.bottom + 3;
    if (top + height > window.innerHeight - 8) top = Math.max(6, r.top - height - 3);
    dd.style.left = left + 'px';
    dd.style.top = top + 'px';
  }

  function openMenu(name, anchor) {
    if (openMenuName === name && !customItems) { closeMenu(); return; }
    const layer = $('menuLayer');
    if (!layer) return;
    const items = menus()[name] || [];
    layer.classList.add('open');
    layer.innerHTML = '<div class="dropdown">' + items.map((it) => {
      if (it.sep) return '<div class="sep"></div>';
      const disabled = typeof it.disabled === 'function' ? it.disabled() : !!it.disabled;
      return '<button class="mi" data-menu-action="' + it.action + '"' + (disabled ? ' disabled' : '') + '>' +
        '<span class="mi-icon">' + (it.check ? '✓' : (it.icon ? U.icon(it.icon) : '')) + '</span>' +
        '<span class="mi-label">' + esc(it.label) + '</span>' +
        '<span class="mi-key">' + esc(it.key || '') + '</span></button>';
    }).join('') + '</div>';
    const dd = layer.querySelector('.dropdown');
    placeDropdown(anchor, dd);
    openMenuName = name;
    customItems = null;
    document.querySelectorAll('#menubar button').forEach((b) => b.classList.toggle('open', b.dataset.menu === name));
  }

  function openCustomMenu(anchor, items) {
    const layer = $('menuLayer');
    if (!layer) return;
    layer.classList.add('open');
    layer.innerHTML = '<div class="dropdown">' + items.map((it, i) => {
      if (it.sep) return '<div class="sep"></div>';
      return '<button class="mi" data-custom-index="' + i + '"><span class="mi-icon"></span>' +
        '<span class="mi-label">' + esc(it.label) + '</span><span class="mi-key"></span></button>';
    }).join('') + '</div>';
    const dd = layer.querySelector('.dropdown');
    placeDropdown(anchor, dd);
    openMenuName = '__custom';
    customItems = items;
    document.querySelectorAll('#menubar button').forEach((b) => b.classList.remove('open'));
  }

  // Rich popover used by the Gantt bar colour panel and dependency menu.
  function openMenuHtml(anchor, html, onMount) {
    const layer = $('menuLayer');
    if (!layer) return;
    layer.classList.add('open');
    layer.innerHTML = html;
    const dd = layer.firstElementChild;
    placeDropdown(anchor, dd);
    openMenuName = '__html';
    customItems = null;
    document.querySelectorAll('#menubar button').forEach((b) => b.classList.remove('open'));
    if (dd && onMount) onMount(dd);
  }

  function bindMenus() {
    const menubar = $('menubar');
    if (menubar) {
      menubar.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-menu]');
        if (!btn) return;
        e.stopPropagation();
        openMenu(btn.dataset.menu, btn);
      });
    }
    const layer = $('menuLayer');
    if (layer) {
      layer.addEventListener('click', (e) => {
        const item = e.target.closest('[data-menu-action]');
        if (item && !item.disabled) {
          const action = item.dataset.menuAction;
          closeMenu();
          runAction(action);
          return;
        }
        const custom = e.target.closest('[data-custom-index]');
        if (custom) {
          const it = customItems && customItems[Number(custom.dataset.customIndex)];
          closeMenu();
          if (it && it.action) it.action();
          return;
        }
        closeMenu();
      });
    }
    document.addEventListener('click', (e) => {
      if (e.target.closest('#menuLayer')) return;
      if (e.target.closest('#menubar')) return;
      if (e.target.closest('#tabMore')) return;
      closeMenu();
    });
  }

  // ---------- actions ----------
  function toggleSetting(key) {
    const active = tab();
    if (!active) return;
    const view = active.project.view;
    const value = !view[key];
    Store.updateSettings({ [key]: value });
    U.toast((key === 'showLinks' ? 'Dependencies ' : key === 'showCriticalPath' ? 'Critical path ' : 'View ') + (value ? 'on' : 'off'), 'ok', 1200);
  }

  function duplicateSelected() {
    const active = tab();
    const id = Store.selection()[0];
    if (!active || !id) { U.toast('Select a task first', 'warn'); return; }
    let newId = null;
    Store.mutate((p) => {
      const clone = Model.duplicateTask(p, id);
      if (clone) newId = clone.id;
    });
    if (newId) Store.setSelection([newId]);
    U.toast('Task duplicated', 'ok');
  }

  function deleteSelected() {
    const active = tab();
    const ids = Store.selection();
    if (!active || !ids.length) { U.toast('Select a task first', 'warn'); return; }
    const first = Model.getTask(active.project, ids[0]);
    if (!first) return;
    const label = ids.length > 1 ? ids.length + ' selected tasks' : '"' + first.name + '"';
    Dialogs.confirm('Delete task', 'Delete ' + label + ' and any subtasks? Dependencies attached to them are removed too.', { okLabel: 'Delete' })
      .then((ok) => {
        if (!ok) return;
        Store.mutate((p) => {
          ids.forEach((id) => { if (Model.getTask(p, id)) Model.deleteTask(p, id); });
        });
        Store.setSelection([]);
        U.toast('Task deleted', 'ok');
      });
  }

  // Reference another plan from the open one. Nothing is copied: the target
  // stores a link, and the rows are read from the source every time.
  function insertProjectIntoPlan() {
    const active = tab();
    if (!active) { U.toast('Open a project first', 'warn'); return; }
    const targetId = active.id;
    const linked = new Set((active.project.linkedProjects || []).map((l) => l.projectId));
    // Nothing to show in an empty plan, so it cannot be referenced. Order and
    // preselection live in the dialog.
    const candidates = Store.allProjects()
      .filter((p) => p.id !== targetId && !linked.has(p.id) && (p.project.tasks || []).length > 0);
    Dialogs.referenceProject({
      subtitle: active.project.name,
      candidates: candidates,
      onPick: (sourceId) => {
        const entry = Store.allProjects().find((p) => p.id === sourceId);
        if (!entry) return;
        // Store the project's own id (see Model.resolveLinkProject): records made
        // before this held the tab id, which no writer could resolve.
        const projectId = (entry.project && entry.project.id) || sourceId;
        Store.mutateProject(targetId, (p) => {
          // normalizeLinks stamps a fresh id; without one the phase row has no
          // stable identity and cannot be collapsed or removed.
          p.linkedProjects = Model.normalizeLinks(Model.normalizeLinks(p.linkedProjects)
            .concat([{ projectId }]));
        });
        U.toast('Referenced ' + entry.project.name, 'ok');
      }
    });
  }

  // Drop references without touching either plan: the tasks stay where they
  // live, only the "show it here too" record is removed.
  function removeInsertedProjects() {
    const active = tab();
    if (!active) return;
    const links = Model.normalizeLinks(active.project.linkedProjects);
    if (!links.length) { U.toast('This project has nothing inserted', 'ok'); return; }
    Dialogs.confirm(
      'Remove inserted projects',
      'Stop showing ' + links.length + (links.length === 1 ? ' referenced plan' : ' referenced plans') +
      ' in this one? Their tasks stay in their own projects — only the link is removed.',
      { okLabel: 'Remove links', cancelLabel: 'Keep' }
    ).then((ok) => {
      if (!ok) return;
      const pid = active.id;
      Store.mutateProject(pid, (p) => { p.linkedProjects = []; });
      U.toast('Inserted projects removed', 'ok');
    });
  }

  // One click clears actual start and finish: for the selection, or for the
  // whole open plan when nothing is selected.
  function clearActuals() {
    const active = tab();
    if (!active) return;
    const ids = Store.selection().filter((id) => Model.getTask(active.project, id));
    const scope = ids.length ? ids : active.project.tasks.map((t) => t.id);
    if (!scope.length) { U.toast('There are no tasks to clear', 'warn'); return; }
    const run = () => {
      Store.mutate((p) => {
        scope.forEach((id) => {
          const t = Model.getTask(p, id);
          if (!t) return;
          t.actualStart = null;
          t.actualEnd = null;
        });
      });
      U.toast('Actual dates cleared' + (ids.length ? ' on ' + ids.length + ' tasks' : ''), 'ok');
    };
    if (ids.length) { run(); return; }
    Dialogs.confirm('Clear actual dates',
      'Clear actual start and finish on all ' + scope.length + ' tasks in this plan?', { okLabel: 'Clear' })
      .then((ok) => { if (ok) run(); });
  }

  // Indent / outdent / move up / move down work on the whole selection. A
  // referenced row has no task in this plan, so it simply drops out of the
  // batch instead of failing the rest.
  function outlineOp(name) {
    const active = tab();
    if (!active) return;
    const ids = Store.selection().filter((id) => Model.getTask(active.project, id));
    if (!ids.length) { U.toast('Select a task first', 'warn'); return; }
    let ok = false;
    Store.mutate((p) => {
      if (name === 'indent') ok = Model.batchIndent(p, ids);
      else if (name === 'outdent') ok = Model.batchOutdent(p, ids);
      else if (name === 'move-up') ok = Model.batchMove(p, ids, -1);
      else if (name === 'move-down') ok = Model.batchMove(p, ids, 1);
    });
    if (!ok) U.toast('That move is not possible here', 'warn');
    else if (ids.length > 1) U.toast('Applied to ' + ids.length + ' tasks', 'ok', 1200);
  }

  // Every save entry point writes the whole workspace to one file. The name is
  // fixed so a save from any project page produces the same document.
  const WORKSPACE_FILE = 'ProjectPlan.dplan';

  async function saveWorkspace() {
    const entries = Store.allProjects();
    if (!entries.length) { U.toast('There are no projects to save', 'warn'); return; }
    if (typeof TauriBridge !== 'undefined' && TauriBridge.available()) {
      const ok = await TauriBridge.save(Store.workspacePayload());
      if (!ok) { U.toast('Could not write ProjectPlan.dplan beside the app', 'warn', 4000); return; }
      Store.markAllSaved();
      Store.addRecent(WORKSPACE_FILE);
      U.toast('Saved ' + WORKSPACE_FILE + ' beside the app \u2014 ' + entries.length +
        (entries.length === 1 ? ' project' : ' projects'), 'ok', 3000);
      return;
    }
    const savedAt = new Date().toISOString();
    const payload = {
      app: 'GanttDesk',
      kind: 'workspace',
      version: 1,
      savedAt,
      projects: entries.map((entry) => {
        const openTab = Store.tabs().find((t) => t.id === entry.id);
        return {
          open: !!entry.open,
          pinned: !!(openTab && openTab.pinned),
          project: Object.assign({}, entry.project, { updatedAt: savedAt })
        };
      })
    };
    U.download(WORKSPACE_FILE, JSON.stringify(payload, null, 2), 'application/json');
    Store.markAllSaved();
    Store.addRecent(WORKSPACE_FILE);
    U.toast('Saved ' + WORKSPACE_FILE + ' \u2014 ' + entries.length +
      (entries.length === 1 ? ' project' : ' projects'), 'ok', 3000);
  }

  // In the desktop build "Open..." reads the same ProjectPlan.dplan that Save
  // writes, so the two never pick different files. In a browser it keeps the
  // normal file chooser.
  async function openWorkspace() {
    if (typeof TauriBridge === 'undefined' || !TauriBridge.available()) {
      chooseFile('open');
      return;
    }
    const data = await TauriBridge.load();
    if (!data) { U.toast('No ProjectPlan.dplan beside the app yet — save once first', 'warn', 3600); return; }
    if (!Store.replaceWorkspace(data)) { U.toast('ProjectPlan.dplan could not be read', 'warn', 3600); return; }
    Store.addRecent(WORKSPACE_FILE);
    U.toast('Opened ' + WORKSPACE_FILE, 'ok');
  }

  function closeActiveTab() {
    const active = tab();
    if (active) closeTabById(active.id);
  }

  function closeTabById(id) {
    const target = Store.tabs().find((t) => t.id === id);
    if (!target) return;
    if (target.pinned) { U.toast('The Overview page cannot be closed', 'ok', 2200); return; }
    if (target.dirty) {
      Dialogs.confirm('Close tab', '“' + target.name + '” has changes. Closing only hides the tab — the project stays in the workspace and can be referenced from another plan.', { okLabel: 'Close tab', cancelLabel: 'Keep open' })
        .then((ok) => { if (ok) closeTabNow(id); });
    } else {
      closeTabNow(id);
    }
  }

  function closeTabNow(id) {
    Store.closeTab(id);
  }

  // Close every project tab in one go; the projects stay in the workspace, so
  // the strip ends up holding only the pinned Overview page.
  function closeAllTabs() {
    const open = Store.tabs().filter((t) => !t.pinned);
    if (!open.length) { U.toast('No project tabs to close', 'ok'); return; }
    const dirty = open.filter((t) => t.dirty);
    const message = dirty.length
      ? dirty.length + ' of ' + open.length + ' tabs have unsaved changes. Closing only hides the tabs — the projects stay in the workspace and can be referenced from another plan.'
      : 'Close all ' + open.length + ' project tabs? The projects stay in the workspace and can be referenced from another plan.';
    Dialogs.confirm('Close all tabs', message, { okLabel: 'Close all tabs', cancelLabel: 'Keep open' })
      .then((ok) => {
        if (!ok) return;
        open.forEach((t) => Store.closeTab(t.id));
        U.toast(open.length + ' tabs closed', 'ok');
      });
  }

  function deleteProjectById(id) {
    const target = Store.allProjects().find((t) => t.id === id);
    if (!target) return;
    const openTab = Store.tabs().find((t) => t.id === id);
    if (openTab && openTab.pinned) { U.toast('The Overview page cannot be deleted', 'warn', 2400); return; }
    Dialogs.confirm(
      'Delete project',
      'Delete “' + target.name + '” permanently from this browser? Tasks, resources and its saved workspace will be removed. This cannot be undone.',
      { okLabel: 'Delete project', cancelLabel: 'Cancel' }
    ).then((ok) => {
      if (!ok) return;
      Store.removeProject(id);
      U.toast('Project deleted', 'ok');
    });
  }

  function deleteActiveProject() {
    const active = tab();
    if (active) deleteProjectById(active.id);
  }

  function renameActiveTab() {
    const active = tab();
    if (!active) return;
    Dialogs.promptText('Rename tab', 'Project no.', Model.tabLabel(active.project), { okLabel: 'Rename' }).then((name) => {
      if (name != null) Store.renameTabLabel(name);
    });
  }

  function captureBaseline() {
    const active = tab();
    if (!active) return;
    Dialogs.confirm('Capture baseline', 'Store the current dates and costs as the baseline for every task?', { okLabel: 'Capture baseline', danger: false })
      .then((ok) => {
        if (!ok) return;
        Store.mutate((p) => Model.captureBaseline(p));
        U.toast('Baseline captured', 'ok');
      });
  }

  function clearBaseline() {
    const active = tab();
    if (!active) return;
    Dialogs.confirm('Clear baseline', 'Remove the baseline dates and costs from every task?', { okLabel: 'Clear baseline' })
      .then((ok) => {
        if (!ok) return;
        Store.mutate((p) => {
          p.tasks.forEach((t) => {
            t.baselineStart = null;
            t.baselineEnd = null;
            t.baselineCost = null;
          });
          p.baselineBudget = null;
        });
        U.toast('Baseline cleared', 'ok');
      });
  }

  function focusSearch() {
    const input = $('searchInput');
    if (input) { input.focus(); input.select(); }
  }

  function chooseFile(mode) {
    const input = $('fileInput');
    if (!input) return;
    input.value = '';
    input.dataset.mode = mode || 'open';
    input.accept = mode === 'import'
      ? '.csv,.tsv,.txt,.xlsx,.xlsm,.xls,.dplan,.gxp,.json'
      : '.dplan,.gxp,.json,application/json';
    input.click();
  }

  async function handleFile(file) {
    if (!file) return;
    const ext = (String(file.name).split('.').pop() || '').toLowerCase();
    try {
      if (ext === 'dplan' || ext === 'gxp' || ext === 'json') {
        const text = await U.readFileText(file);
        let data = null;
        try { data = JSON.parse(text); }
        catch (e) { throw new Error('The file is not valid JSON.'); }
        // The desktop sidecar is a full workspace; opening it in the browser
        // restores the same tabs, settings and active page.
        if (data && Array.isArray(data.tabs)) {
          if (!Store.replaceWorkspace(data)) throw new Error('No project data found in this file.');
          U.toast('Opened ' + file.name, 'ok');
          return;
        }
        // A workspace file written by Save: every project it holds is restored.
        if (data && Array.isArray(data.projects)) {
          const list = data.projects
            .map((entry) => ({
              pinned: !!(entry && entry.pinned),
              project: entry && entry.project ? entry.project : entry
            }))
            .filter((e) => e.project && typeof e.project === 'object' && !Array.isArray(e.project));
          if (!list.length) throw new Error('No project data found in this file.');
          const known = new Set(Store.allProjects().map((p) => p.project && p.project.id).filter(Boolean));
          let added = 0, skipped = 0, restored = 0;
          list.forEach(({ pinned, project }) => {
            // The pinned page is part of the workspace; its data goes back into
            // the tab that is already there instead of a duplicate page.
            if (pinned) { Store.replaceOverviewProject(project); restored += 1; return; }
            if (project.id && known.has(project.id)) { skipped += 1; return; }
            Store.importProject(project, { name: project.name || Importer.cleanName(file.name), path: file.name });
            if (project.id) known.add(project.id);
            added += 1;
          });
          U.toast('Opened ' + file.name + ' \u2014 ' + added +
            (added === 1 ? ' project' : ' projects') +
            (restored ? ' \u00b7 Overview restored' : '') +
            (skipped ? ' \u00b7 ' + skipped + ' already in the workspace' : ''), 'ok', 3600);
          return;
        }
        const raw = data && data.project ? data.project : (data && data.plan && data.plan.project ? data.plan.project : (data && data.plan ? data.plan : data));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('No project data found in this file.');
        Store.importProject(raw, { name: raw.name || Importer.cleanName(file.name), path: file.name });
        U.toast('Opened ' + file.name, 'ok');
        return;
      }
      if (['csv', 'tsv', 'txt', 'xlsx', 'xlsm', 'xls'].includes(ext)) {
        const result = await Importer.readFile(file);
        const project = Importer.buildProject(result.rows, result.name);
        Store.importProject(project, { name: project.name, path: file.name });
        U.toast('Imported ' + project.tasks.length + ' tasks from ' + file.name, 'ok', 3500);
        return;
      }
      throw new Error('Unsupported file type: .' + ext);
    } catch (err) {
      Dialogs.alert('Could not open file', (err && err.message) || String(err));
    }
  }

  function exitApp() {
    Dialogs.confirm('Exit GanttDesk', 'Your workspace is saved in this browser. Close the app window?', { okLabel: 'Exit', danger: false })
      .then((ok) => {
        if (!ok) return;
        Store.saveNow();
        window.close();
        setTimeout(() => U.toast('Close this window to exit GanttDesk', 'ok'), 200);
      });
  }

  function runAction(name) {
    if (!name) return;
    closeMenu();
    const active = tab();
    switch (name) {
      case 'new': Dialogs.project(); break;
      case 'open': openWorkspace(); break;
      case 'new-tab': Store.newBlankTab(); break;
      case 'duplicate-tab': if (active) Store.duplicateTab(active.id); break;
      case 'rename-tab': renameActiveTab(); break;
      case 'close-tab': closeActiveTab(); break;
      case 'close-all-tabs': closeAllTabs(); break;
      case 'save': saveWorkspace(); break;
      case 'save-as': saveWorkspace(); break;
      case 'import': chooseFile('import'); break;
      case 'export-pdf':
        if (active) Dialogs.printProject(active.project);
        break;
      case 'export-png': if (active) Dialogs.exportImage(); break;
      case 'export-excel': if (active) Dialogs.downloadXls(active.project, { costs: true, baseline: true, notes: true }); break;
      case 'export': Dialogs.exportDialog(); break;
      case 'settings': Dialogs.settings(); break;
      case 'columns': Dialogs.columns(); break;
      case 'exit': exitApp(); break;
      case 'undo': if (Store.undo()) U.toast('Undo', 'ok', 1000); break;
      case 'redo': if (Store.redo()) U.toast('Redo', 'ok', 1000); break;
      case 'find': focusSearch(); break;
      case 'select-all': if (active) Store.setSelection(active.project.tasks.map((t) => t.id)); break;
      case 'delete': deleteSelected(); break;
      case 'task-add': Dialogs.task(null, { type: 'task' }); break;
      case 'milestone-add': Dialogs.task(null, { type: 'milestone' }); break;
      case 'task-edit': {
        const id = Store.selection()[0];
        if (!id) U.toast('Select a task first', 'warn');
        else Dialogs.task(id);
        break;
      }
      case 'duplicate': duplicateSelected(); break;
      case 'indent': case 'outdent': case 'move-up': case 'move-down': outlineOp(name); break;
      case 'clear-actuals': clearActuals(); break;
      case 'project-edit': if (active) Dialogs.project({ project: active.project }); break;
      case 'project-add': Dialogs.project(); break;
      case 'project-insert': insertProjectIntoPlan(); break;
      case 'project-unlink': removeInsertedProjects(); break;
      case 'project-delete': deleteActiveProject(); break;
      case 'resources': Dialogs.resources(); break;
      case 'calendar': Dialogs.calendar(); break;
      case 'colours': Dialogs.colours(Store.selection()); break;
      case 'dashboard': Dashboard.toggleCollapsed(); break;
      case 'projects': Dialogs.projects(); break;
      case 'capture-baseline': captureBaseline(); break;
      case 'clear-baseline': clearBaseline(); break;
      case 'zoom-day': case 'zoom-week': case 'zoom-month': case 'zoom-quarter': case 'zoom-halfYear': case 'zoom-year':
        Gantt.setZoom(name.slice(5));
        break;
      case 'today': Gantt.scrollToToday(); break;
      case 'toggle-links': toggleSetting('showLinks'); break;
      case 'toggle-costs':
        // Mirrors onto the open project like every other view switch, so the
        // cost columns actually appear instead of only changing the default.
        Store.updateSettings({ showCosts: !Store.settings().showCosts });
        break;
      case 'archive-project': if (active) Store.setArchived(active.id, true); break;
      case 'unarchive-project': if (active) Store.setArchived(active.id, false); break;
      case 'toggle-critical': toggleSetting('showCriticalPath'); break;
      case 'toggle-baseline': toggleSetting('showBaselineBars'); break;
      case 'toggle-actual': toggleSetting('showActualBars'); break;
      case 'expand-all': Gantt.expandAll(); break;
      case 'collapse-all': Gantt.collapseAll(); break;
      case 'help': Dialogs.help(); break;
      case 'shortcuts': Dialogs.shortcuts(); break;
      case 'about': Dialogs.about(); break;
      case 'update': U.toast('GanttDesk is up to date (offline build 1.0.0)', 'ok'); break;
      default: break;
    }
  }

  // ---------- events ----------
  function bindChrome() {
    const tabs = $('tabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const close = e.target.closest('[data-tab-close]');
        if (close) {
          e.stopPropagation();
          closeTabById(close.dataset.tabClose);
          return;
        }
        const t = e.target.closest('[data-tab-id]');
        if (t) {
          Store.setActive(t.dataset.tabId);
        }
      });
      tabs.addEventListener('dblclick', (e) => {
        if (e.target.closest('[data-tab-name]')) renameActiveTab();
      });
      tabs.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const t = e.target.closest('[data-tab-id]');
        if (t) { e.preventDefault(); closeTabById(t.dataset.tabId); }
      });
    }

    const tabAdd = $('tabAdd');
    if (tabAdd) tabAdd.addEventListener('click', () => Store.newBlankTab());

    const tabMore = $('tabMore');
    if (tabMore) {
      tabMore.addEventListener('click', (e) => {
        e.stopPropagation();
        openCustomMenu(tabMore, [
          { label: 'New tab', action: () => Store.newBlankTab() },
          { label: 'Duplicate tab', action: () => { const t = tab(); if (t) Store.duplicateTab(t.id); } },
          { label: 'Rename tab...', action: renameActiveTab },
          SEP,
          { label: 'Close tab (stays in Overview)', action: closeActiveTab },
          { label: 'Close all tabs', action: closeAllTabs },
          { label: 'Archive project', action: () => { const t = tab(); if (t) Store.setArchived(t.id, true); } },
          { label: 'Delete project...', action: deleteActiveProject }
        ]);
      });
    }

    // Desktop-style app: never show the browser's native context menu.
    document.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el) return;
      if (el.closest('.modal-root')) return;
      e.preventDefault();
      runAction(el.dataset.action);
    });

    document.querySelectorAll('#zoomButtons button').forEach((b) => {
      b.addEventListener('click', () => Gantt.setZoom(b.dataset.zoom));
    });

    document.querySelectorAll('[data-toggle]').forEach((b) => {
      b.addEventListener('click', () => toggleSetting(b.dataset.toggle));
    });

    const search = $('searchInput');
    if (search) {
      const apply = U.debounce(() => Gantt.setSearch(search.value), 150);
      search.addEventListener('input', apply);
    }
    const filter = $('filterSelect');
    if (filter) filter.addEventListener('change', () => Gantt.setFilter(filter.value));
    const resourceSelect = $('resourceFilter');
    if (resourceSelect) {
      resourceSelect.addEventListener('change', () => Gantt.setResourceFilter(resourceSelect.value));
    }

    const ratioField = $('zoomRatio');
    if (ratioField) {
      const commit = () => {
        const digits = String(ratioField.value).replace(/[^0-9]/g, '');
        if (digits) Gantt.setZoomPercent(Number(digits));
        else ratioField.value = Gantt.zoomPercent() + '%';
        ratioField.blur();
      };
      ratioField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); ratioField.value = Gantt.zoomPercent() + '%'; ratioField.blur(); }
      });
      ratioField.addEventListener('blur', () => {
        const digits = String(ratioField.value).replace(/[^0-9]/g, '');
        if (!digits || Number(digits) === Gantt.zoomPercent()) {
          ratioField.value = Gantt.zoomPercent() + '%';
          return;
        }
        Gantt.setZoomPercent(Number(digits));
      });
    }

    const splitter = $('splitter');
    if (splitter) {
      splitter.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const pane = $('taskPane');
        if (!pane) return;
        const startX = e.clientX;
        const startWidth = pane.getBoundingClientRect().width;
        const onMove = (ev) => {
          const width = U.clamp(startWidth + ev.clientX - startX, 260, Math.min(900, window.innerWidth * 0.7));
          pane.style.flexBasis = width + 'px';
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
          const width = Math.round(pane.getBoundingClientRect().width);
          Store.settings().gridPaneWidth = width;
          Store.persist();
        };
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      splitter.addEventListener('dblclick', () => {
        Store.settings().gridPaneWidth = 700;
        Store.persist();
        Gantt.render();
      });
    }

    const input = $('fileInput');
    if (input) input.addEventListener('change', () => { const file = input.files && input.files[0]; if (file) handleFile(file); input.value = ''; });

    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeMenu(); return; }
      const modal = $('modalRoot');
      if (modal && modal.classList.contains('open')) return;
      if (isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = String(e.key || '').toLowerCase();
      if (mod && key === 'n') { e.preventDefault(); runAction('new'); return; }
      if (mod && key === 'o') { e.preventDefault(); runAction('open'); return; }
      if (mod && key === 's') { e.preventDefault(); runAction(e.shiftKey ? 'save-as' : 'save'); return; }
      if (mod && key === 'p') { e.preventDefault(); runAction('export-pdf'); return; }
      if (mod && key === 'w') { e.preventDefault(); runAction('close-tab'); return; }
      if (mod && key === 'f') { e.preventDefault(); focusSearch(); return; }
      // Same action as typing "/" in the add row, for when focus is elsewhere.
      if (mod && key === '/') { e.preventDefault(); runAction('project-insert'); return; }
      if (mod && key === 'a') { e.preventDefault(); runAction('select-all'); return; }
      if (mod && key === 'z') { e.preventDefault(); runAction(e.shiftKey ? 'redo' : 'undo'); return; }
      if (mod && key === 'y') { e.preventDefault(); runAction('redo'); return; }
      if (key === 'delete') { e.preventDefault(); runAction('delete'); return; }
      if (key === 'insert') { e.preventDefault(); runAction('task-add'); return; }
      if (key === 'f2') { e.preventDefault(); runAction('task-edit'); return; }
      if (key === 'f1') { e.preventDefault(); runAction('shortcuts'); return; }
      if (key === 'tab') return;
    });
  }

  async function init() {
    if (initialized) return;
    initialized = true;
    // The desktop shell keeps the workspace beside the exe. Wait for that read
    // before the first paint so the page never flashes the bootstrap samples.
    let preloaded = null;
    if (typeof TauriBridge !== 'undefined' && TauriBridge.available()) {
      preloaded = await TauriBridge.load();
      TauriBridge.bindWindowControls();
    }
    Store.init(preloaded);
    Dashboard.init();
    bindMenus();
    bindChrome();
    Gantt.init();
    renderAll();
    window.addEventListener('store:change', renderAll);
    // The persisted active id is the page the user left, and a refresh opens
    // exactly that page. An empty outline is not a reason to jump elsewhere:
    // the plan may be empty on purpose or hold only referenced projects.
  }

  function openMenuAt(point, items) {
    openCustomMenu(point, items);
  }

  // The strip can be repainted on its own when only the selection changes.
  function refreshTabs() { renderTabs(); }

  return { init, renderAll, refreshTabs, runAction, openMenuAt, openMenuHtml, applyPalette, previewPalette };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', App.init);
} else {
  App.init();
}
