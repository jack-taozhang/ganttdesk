'use strict';

const Store = (() => {
  // Kept from earlier builds so an existing browser workspace still loads.
  const LS_KEY = 'plancraft.state.v1';
  // The Overview is a real project page, pinned at the head of the strip. Its
  // id is fixed so a reload finds the same page and it can never be closed.
  const OVERVIEW_ID = 'overview';
  let state = null;
  let saveTimer = null;

  function defaultSettings() {
    return {
      appTheme: 'light',
      language: 'en',
      lastView: 'overview',
      planZoom: 100,
      gridPaneWidth: 700,
      dashboardExpanded: true,
      dashboardExtra: false,
      dashboardPanels: ['complete', 'cost', 'status'],
      dateFormat: 'dd-mmm-yy',
      barStyle: 'raised',
      headerStyle: 'banner',
      showTimes: false,
      progressMode: 'manual',
      showBaselineBars: true,
      showActualBars: true,
      showLinks: true,
      showCriticalPath: false,
      showCosts: false,
      barLabelFields: ['name'],
      hiddenColumns: Model.DEFAULT_HIDDEN.slice(),
      recent: []
    };
  }

  function makeTab(project, opts) {
    opts = opts || {};
    return {
      id: U.uid(),
      project,
      name: Model.tabLabel(project) || opts.name || 'project',
      sample: !!opts.sample,
      dirty: !!opts.dirty,
      pinned: !!opts.pinned,
      history: [],
      future: [],
      selection: [],
      scrollLeft: 0,
      scrollTop: 0
    };
  }

  function blankTab(name) {
    const p = Model.blankProject(name || 'project');
    p.view.dashboardPanels = ['complete', 'cost', 'status'];
    return makeTab(p, { name: p.name });
  }

  // The pinned page: an ordinary blank project, created once and kept forever.
  // It is a normal project page in every respect except that it cannot close.
  function overviewTab() {
    const p = Model.blankProject('Overview');
    p.view.dashboardPanels = ['complete', 'cost', 'status'];
    const tab = makeTab(p, { name: 'Overview', pinned: true });
    tab.id = OVERVIEW_ID;
    return tab;
  }

  function bootstrap() {
    const overview = overviewTab();
    const blank = blankTab('project');
    const riverside = makeTab(Samples.riverside(), { name: 'Riverside Office Fit-out', sample: true });
    const northwind = makeTab(Samples.northwind(), { name: 'Northwind ERP Rollout', sample: true });
    state = {
      tabs: [overview, blank, riverside, northwind],
      // A brand-new workspace opens on a plan with work in it; after that the
      // saved active id is what a reload returns to.
      activeId: riverside.id,
      shelf: [],
      settings: defaultSettings(),
      recent: []
    };
  }

  function normalizeTab(raw) {
    const p = Model.normalizeProject(raw.project, raw.name || 'project');
    const tab = makeTab(p, {
      name: raw.name, sample: raw.sample, dirty: raw.dirty,
      pinned: raw.pinned || raw.id === OVERVIEW_ID
    });
    tab.id = raw.id || tab.id;
    tab.pinned = tab.pinned || tab.id === OVERVIEW_ID;
    tab.selection = Array.isArray(raw.selection) ? raw.selection.filter((id) => p.tasks.some((t) => t.id === id)) : [];
    tab.scrollLeft = raw.scrollLeft || 0;
    tab.scrollTop = raw.scrollTop || 0;
    tab.gridScrollLeft = raw.gridScrollLeft || 0;
    return tab;
  }

  // A closed tab is not a deleted project: the plan moves to the shelf so the
  // portfolio can still report on it and it can be reopened at any time.
  function shelfEntry(tab) {
    return {
      id: tab.id,
      name: (tab.project && Model.tabLabel(tab.project)) || tab.name || 'project',
      sample: !!tab.sample,
      closedAt: new Date().toISOString(),
      project: tab.project
    };
  }

  function normalizeShelfEntry(raw) {
    const project = Model.normalizeProject(raw.project, raw.name || 'project');
    return {
      id: raw.id || project.id,
      name: raw.name || project.name || 'project',
      sample: !!raw.sample,
      closedAt: raw.closedAt || '',
      project
    };
  }

  function assembleState(tabs, activeId, shelf, settings, recent, masterPlan) {
    // The Overview page is part of the workspace and must always exist. A
    // workspace saved before it became a project tab gains one on the spot.
    let overview = tabs.find((t) => t.id === OVERVIEW_ID);
    if (!overview) {
      overview = overviewTab();
    } else {
      overview.pinned = true;
    }
    const rest = tabs.filter((t) => t.id !== OVERVIEW_ID);
    const st = {
      tabs: [overview].concat(rest),
      activeId,
      shelf: Array.isArray(shelf) ? shelf.filter((e) => e && e.project).map(normalizeShelfEntry) : [],
      settings: Object.assign(defaultSettings(), settings || {}),
      recent: Array.isArray(recent) ? recent : [],
      masterPlan: normalizeMasterPlan(masterPlan)
    };
    // A saved scale below the current floor (30% used to be allowed) is lifted
    // to it, otherwise the read-out would claim a value the wheel cannot reach.
    const zoom = Number(st.settings.planZoom);
    if (!(zoom >= 50)) st.settings.planZoom = 100;
    else if (zoom < 50) st.settings.planZoom = 50;
    // Early workspaces used $; the default currency is now RMB.
    st.tabs.forEach((t) => {
      if (t.project.currency === '$') t.project.currency = '¥';
    });
    if (!st.tabs.some((t) => t.id === st.activeId)) {
      const withTasks = st.tabs.find((t) => !t.pinned && t.project.tasks.length);
      st.activeId = ((withTasks || st.tabs[0] || {}).id) || null;
    }
    return st;
  }

  // One reader for every shape the sidecar can hold: the full workspace
  // (tabs/shelf/settings), a projects array from the browser export, or a
  // single project JSON.
  function stateFromData(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.tabs)) {
      const tabs = data.tabs.map(normalizeTab);
      return assembleState(tabs, data.activeId, data.shelf, data.settings, data.recent, data.masterPlan);
    }
    if (Array.isArray(data.projects)) {
      const tabs = [];
      data.projects.forEach((entry) => {
        const raw = entry && entry.project ? entry.project : entry;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
        const p = Model.normalizeProject(raw, raw.name || 'project');
        const tab = makeTab(p, { name: p.name, sample: false });
        if (entry && entry.pinned) { tab.pinned = true; tab.id = OVERVIEW_ID; }
        tabs.push(tab);
      });
      if (!tabs.length) return null;
      return assembleState(tabs, data.activeId, [], defaultSettings(), [], []);
    }
    const raw = data.project || data.plan || data;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw.name || raw.tasks)) {
      const p = Model.normalizeProject(raw, raw.name || 'project');
      return assembleState([makeTab(p, { name: p.name })], null, [], defaultSettings(), [], []);
    }
    return null;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) { bootstrap(); return; }
      const restored = stateFromData(JSON.parse(raw));
      if (!restored) { bootstrap(); return; }
      state = restored;
    } catch (e) {
      console.warn('Could not restore saved workspace', e);
      bootstrap();
    }
  }

  function init(preloaded) {
    if (preloaded) {
      const restored = stateFromData(preloaded);
      if (restored) state = restored;
      else if (!state) load();
    } else if (!state) {
      load();
    }
    if (!state) bootstrap();
    applyTheme();
    window.addEventListener('beforeunload', saveNow);
    // The Tauri build keeps its workspace in ProjectPlan.dplan beside the exe.
    // The first launch writes the initial or migrated workspace there.
    if (typeof TauriBridge !== 'undefined' && TauriBridge.available()) {
      TauriBridge.save(workspacePayload());
    }
    return state;
  }

  function applyTheme() {
    const setting = (state.settings && state.settings.appTheme) || 'light';
    const dark = setting === 'dark' || (setting === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }

  function serializeTab(tab) {
    return {
      id: tab.id, name: tab.name, sample: tab.sample, dirty: tab.dirty, pinned: !!tab.pinned,
      project: tab.project, selection: tab.selection || [],
      scrollLeft: tab.scrollLeft || 0, scrollTop: tab.scrollTop || 0
    };
  }

  // The overview's master plan is a list of rows the user placed by hand. A row
  // only references a project (and, for task rows, a task id), so the plan keeps
  // showing live data and never forks a copy of it.
  function normalizeMasterPlan(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((r) => r && r.projectId).map((r) => ({
      id: r.id || U.uid(),
      projectId: r.projectId,
      taskId: r.taskId || null,
      collapsed: !!r.collapsed
    }));
  }

  function masterPlan() { return (state.masterPlan || []).slice(); }

  function addMasterRows(rows) {
    const list = (state.masterPlan || []).slice();
    (rows || []).forEach((r) => {
      if (!r || !r.projectId) return;
      list.push({ id: U.uid(), projectId: r.projectId, taskId: r.taskId || null, collapsed: false });
    });
    state.masterPlan = list;
    persist(); notify('master');
  }

  function removeMasterRow(id) {
    state.masterPlan = (state.masterPlan || []).filter((r) => r.id !== id);
    persist(); notify('master');
  }

  function toggleMasterRow(id) {
    const row = (state.masterPlan || []).find((r) => r.id === id);
    if (!row) return;
    row.collapsed = !row.collapsed;
    persist(); notify('master');
  }

  function clearMasterPlan() {
    state.masterPlan = [];
    persist(); notify('master');
  }

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 220);
  }

  // The single payload stored in localStorage and in the Tauri sidecar file.
  function workspacePayload() {
    return {
      app: 'GanttDesk', version: 1,
      tabs: state.tabs.map(serializeTab),
      activeId: state.activeId,
      shelf: state.shelf.map((e) => ({ id: e.id, name: e.name, sample: e.sample, closedAt: e.closedAt, project: e.project })),
      settings: state.settings,
      recent: state.recent.slice(0, 12),
      masterPlan: state.masterPlan
    };
  }

  function saveNow() {
    clearTimeout(saveTimer);
    const payload = workspacePayload();
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch (e) {
      console.warn('Could not save workspace', e);
    }
    // The desktop build writes the same workspace beside the executable. This
    // is a fire-and-forget write; the async result is reported by File → Save.
    if (typeof TauriBridge !== 'undefined' && TauriBridge.available()) {
      TauriBridge.save(payload);
    }
  }

  // Replace the whole workspace from the sidecar (File → Open in Tauri).
  function replaceWorkspace(data) {
    const next = stateFromData(data);
    if (!next) return false;
    state = next;
    applyTheme();
    persist();
    notify('reset');
    return true;
  }

  function notify(type) {
    window.dispatchEvent(new CustomEvent('store:change', { detail: { type: type || 'change' } }));
  }

  // Which surface the workspace was left on, so a reload lands where the user
  // was instead of jumping back to the overview. Written quietly: switching
  // views is not a settings edit and must not trigger the settings redraw.
  function lastView() {
    return (state.settings && state.settings.lastView) === 'project' ? 'project' : 'overview';
  }
  function setLastView(view) {
    const next = view === 'project' ? 'project' : 'overview';
    if (state.settings.lastView === next) return;
    state.settings.lastView = next;
    persist();
  }

  function active() { return state.tabs.find((t) => t.id === state.activeId) || state.tabs[0] || null; }
  function tabs() { return state.tabs.slice(); }
  function settings() { return state.settings; }

  function setActive(id) {
    const t = state.tabs.find((x) => x.id === id);
    if (!t) return;
    state.activeId = id;
    persist();
    notify('tab');
  }

  function createTab(project, opts) {
    const tab = makeTab(project, opts || {});
    state.tabs.push(tab);
    state.activeId = tab.id;
    persist();
    notify('tab');
    return tab;
  }

  function newBlankTab() {
    const tab = blankTab('project');
    state.tabs.push(tab);
    state.activeId = tab.id;
    persist(); notify('tab');
    return tab;
  }

  function duplicateTab(id) {
    const src = state.tabs.find((t) => t.id === id);
    if (!src) return null;
    const p = Model.normalizeProject(JSON.parse(JSON.stringify(src.project)), src.project.name);
    p.name = src.project.name + ' copy';
    const tab = makeTab(p, { name: p.name, sample: false, dirty: true });
    tab.selection = [];
    state.tabs.splice(state.tabs.indexOf(src) + 1, 0, tab);
    state.activeId = tab.id;
    persist(); notify('tab');
    return tab;
  }

  // Every project that still exists: open tabs first, then the shelf.
  function allProjects() {
    const out = state.tabs.map((t) => ({
      id: t.id,
      name: (t.project && t.project.name) || t.name || 'project',
      project: t.project,
      open: true,
      sample: !!t.sample,
      closedAt: ''
    }));
    state.shelf.forEach((e) => {
      if (state.tabs.some((t) => t.id === e.id)) return;
      out.push({
        id: e.id,
        name: (e.project && e.project.name) || e.name || 'project',
        project: e.project,
        open: false,
        sample: !!e.sample,
        closedAt: e.closedAt || ''
      });
    });
    return out;
  }

  function openProject(id) {
    const t = state.tabs.find((x) => x.id === id);
    if (t) { state.activeId = id; persist(); notify('tab'); return t; }
    const idx = state.shelf.findIndex((e) => e.id === id);
    if (idx < 0) return null;
    const entry = state.shelf.splice(idx, 1)[0];
    const tab = makeTab(entry.project, { name: entry.name, sample: entry.sample });
    tab.id = entry.id;
    state.tabs.push(tab);
    state.activeId = tab.id;
    persist(); notify('tab');
    return tab;
  }

  function setArchived(id, archived) {
    const on = archived !== false;
    const tab = state.tabs.find((t) => t.id === id);
    if (tab) { tab.project.archived = on; tab.dirty = true; }
    const entry = state.shelf.find((e) => e.id === id);
    if (entry) entry.project.archived = on;
    persist(); notify('project');
  }

  // Silently drops several projects: one persist and one notification for the
  // whole batch instead of a redraw per item.
  function removeProjects(ids) {
    const pinned = new Set(state.tabs.filter((t) => t.pinned).map((t) => t.id));
    const set = new Set((ids || []).filter((id) => !pinned.has(id)));
    if (!set.size) return 0;
    const before = state.tabs.length;
    const removedActive = set.has(state.activeId);
    state.tabs = state.tabs.filter((t) => !set.has(t.id));
    state.shelf = state.shelf.filter((e) => !set.has(e.id));
    if (removedActive) state.activeId = state.tabs.length ? state.tabs[0].id : null;
    const removed = before - state.tabs.length;
    persist(); notify('tab');
    return removed;
  }

  function removeProject(id) {
    if (state.tabs.some((t) => t.id === id && t.pinned)) return;
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx >= 0) {
      state.tabs.splice(idx, 1);
      if (state.activeId === id) state.activeId = state.tabs.length ? state.tabs[Math.min(idx, state.tabs.length - 1)].id : null;
    }
    state.shelf = state.shelf.filter((e) => e.id !== id);
    persist(); notify('tab');
  }

  function closeTab(id) {
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = state.tabs[idx];
    // The Overview page is pinned: it has no close control and no close path.
    if (tab.pinned) return;
    state.tabs.splice(idx, 1);
    state.shelf = state.shelf.filter((e) => e.id !== tab.id);
    state.shelf.push(shelfEntry(tab));
    if (state.activeId === id) state.activeId = state.tabs.length ? state.tabs[Math.min(idx, state.tabs.length - 1)].id : null;
    persist(); notify('tab');
    if (tab.sample) U.toast('Sample tab closed — it is still available to reference', 'ok');
  }

  function renameActive(name) {
    const tab = active();
    if (!tab || !name) return;
    tab.project.name = name;
    tab.name = Model.tabLabel(tab.project);
    tab.dirty = true;
    persist(); notify('project');
  }

  // The tab shows the project's number. Clearing it is not allowed: a project
  // always has a number once the editor has been used, so an empty value is
  // ignored instead of falling back to the project name.
  function renameTabLabel(name) {
    const tab = active();
    if (!tab) return;
    const label = String(name || '').trim();
    if (!label) return;
    tab.project.tabName = label;
    tab.dirty = true;
    persist(); notify('project');
  }

  // ---------- history ----------
  function snapshotObject(project) { return JSON.stringify(project); }
  function pushHistory(tab) {
    tab.history.push(snapshotObject(tab.project));
    if (tab.history.length > 60) tab.history.shift();
    tab.future = [];
  }
  function begin() {
    const tab = active();
    if (tab) pushHistory(tab);
  }
  function commit(project, opts) {
    const tab = active();
    if (!tab) return;
    if (opts && opts.history && !opts._snapshotTaken) pushHistory(tab);
    tab.project = project || tab.project;
    tab.dirty = true;
    Model.reschedule(tab.project);
    tab.name = Model.tabLabel(tab.project);
    persist();
    notify('project');
  }
  // Mutate any project, open or on the shelf, by id: the overview edits people
  // across several plans, so the active tab is the wrong target there.
  // A project is reachable by two ids: the tab that holds it and the project's
  // own id. A reference stores the tab id, callers elsewhere pass the project
  // id, so both have to resolve or a write lands on nothing.
  function holderOf(id, kind) {
    const pool = kind === 'shelf' ? state.shelf : (kind === 'tab' ? state.tabs : null);
    const list = pool || state.tabs.concat(state.shelf);
    return list.find((t) => t.id === id) ||
      list.find((t) => t.project && t.project.id === id) || null;
  }

  function mutateProject(id, fn, opts) {
    if (opts && opts.silent) {
      // Only real tabs and shelf entries hold a project: an id that matches
      // neither is a bug, so it is reported instead of silently ignored.
      const holder = holderOf(id);
      if (!holder) {
        console.warn('mutateProject: no project with id', id);
        return;
      }
      fn(holder.project, holder);
      Model.reschedule(holder.project);
      holder.name = Model.tabLabel(holder.project);
      if (state.tabs.indexOf(holder) >= 0) holder.dirty = true;
      persist();
      return;
    }
    const tab = holderOf(id, 'tab');
    if (tab) {
      if (!opts || opts.history !== false) pushHistory(tab);
      fn(tab.project, tab);
      tab.dirty = true;
      Model.reschedule(tab.project);
      tab.name = Model.tabLabel(tab.project);
      persist(); notify('project');
      return;
    }
    const entry = holderOf(id, 'shelf');
    if (!entry) return;
    fn(entry.project);
    Model.reschedule(entry.project);
    persist(); notify('tab');
  }

  function mutate(fn, opts) {
    const tab = active();
    if (!tab) return;
    if (!opts || opts.history !== false) pushHistory(tab);
    fn(tab.project, tab);
    tab.dirty = true;
    Model.reschedule(tab.project);
    tab.name = Model.tabLabel(tab.project);
    persist();
    notify('project');
  }
  function undo() {
    const tab = active();
    if (!tab || !tab.history.length) return false;
    tab.future.push(snapshotObject(tab.project));
    tab.project = JSON.parse(tab.history.pop());
    tab.name = Model.tabLabel(tab.project);
    tab.dirty = true;
    Model.reschedule(tab.project);
    persist(); notify('undo');
    return true;
  }
  function redo() {
    const tab = active();
    if (!tab || !tab.future.length) return false;
    tab.history.push(snapshotObject(tab.project));
    tab.project = JSON.parse(tab.future.pop());
    tab.name = Model.tabLabel(tab.project);
    tab.dirty = true;
    Model.reschedule(tab.project);
    persist(); notify('redo');
    return true;
  }
  function canUndo() { const t = active(); return !!(t && t.history.length); }
  function canRedo() { const t = active(); return !!(t && t.future.length); }

  // Saving the open plan also settles the plans it references: editing a
  // referenced row writes into the source project, so leaving those dirty
  // would keep showing an unsaved dot for work that is already on disk.
  function markSaved() {
    const tab = active();
    if (!tab) return;
    tab.dirty = false;
    const links = Model.normalizeLinks(tab.project.linkedProjects);
    links.forEach((link) => {
      const source = state.tabs.find((t) => t.id === link.projectId);
      if (source) source.dirty = false;
    });
    persist(); notify('save');
  }

  // A workspace save writes every project at once, so every tab settles at the
  // same time — including the ones held by references.
  function markAllSaved() {
    state.tabs.forEach((t) => { t.dirty = false; });
    persist(); notify('save');
  }

  // Settings that also live on the open project's view. One list instead of
  // eleven hand-written branches: a key added here is mirrored from now on, so
  // a global switch can no longer silently skip a project (showCosts used to).
  const VIEW_SETTINGS = ['dateFormat', 'progressMode', 'showTimes', 'showBaselineBars',
    'showActualBars', 'showLinks', 'showCriticalPath', 'showCosts'];

  function updateSettings(patch, opts) {
    patch = patch || {};
    Object.assign(state.settings, patch);
    applyTheme();
    const tab = active();
    if (tab && (!opts || opts.projectView !== false)) {
      const v = tab.project.view;
      let touched = false;
      VIEW_SETTINGS.forEach((key) => {
        if (!(key in patch)) return;
        const value = patch[key];
        v[key] = Array.isArray(value) ? value.slice() : value;
        touched = true;
      });
      if (touched) tab.dirty = true;
      if ('progressMode' in patch) Model.reschedule(tab.project);
    }
    persist(); notify('settings');
  }

  function addRecent(path) {
    if (!path) return;
    state.recent = [path].concat(state.recent.filter((x) => x !== path)).slice(0, 12);
    persist();
  }

  function importProject(project, opts) {
    opts = opts || {};
    const p = Model.normalizeProject(project, opts.name || 'imported project');
    const tab = makeTab(p, { name: p.name, sample: false, dirty: true });
    state.tabs.push(tab);
    state.activeId = tab.id;
    if (opts.path) addRecent(opts.path);
    persist(); notify('tab');
    return tab;
  }

  function replaceActive(project) {
    const tab = active();
    if (!tab) return;
    pushHistory(tab);
    tab.project = project;
    tab.name = Model.tabLabel(project);
    tab.dirty = true;
    Model.reschedule(tab.project);
    persist(); notify('project');
  }

  // A workspace file carries the pinned Overview page too. Restoring it swaps
  // the project behind the pinned tab instead of adding a second page.
  function replaceOverviewProject(project) {
    const tab = state.tabs.find((t) => t.pinned);
    if (!tab) return importProject(project, { name: 'Overview' });
    pushHistory(tab);
    tab.project = Model.normalizeProject(project, 'Overview');
    tab.name = Model.tabLabel(tab.project);
    tab.dirty = true;
    Model.reschedule(tab.project);
    persist(); notify('project');
    return tab;
  }

  function setSelection(ids) {
    const tab = active();
    if (!tab) return;
    tab.selection = Array.from(new Set(ids || []));
    persist();
    notify('selection');
  }
  function selection() {
    const tab = active();
    return tab ? (tab.selection || []) : [];
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    bootstrap();
    applyTheme();
    saveNow();
    notify('reset');
    return state;
  }

  return {
    OVERVIEW_ID,
    init, active, tabs, allProjects, openProject, setArchived, removeProject, removeProjects, mutateProject,
    masterPlan, addMasterRows, removeMasterRow, toggleMasterRow, clearMasterPlan,
    settings, setActive, createTab, newBlankTab, duplicateTab, closeTab, renameActive, renameTabLabel,
    lastView, setLastView,
    begin, commit, mutate, undo, redo, canUndo, canRedo, markSaved, markAllSaved, updateSettings, addRecent,
    importProject, replaceActive, replaceOverviewProject, setSelection, selection, saveNow, persist, resetAll, notify,
    workspacePayload, replaceWorkspace,
    applyTheme
  };
})();
