'use strict';

const Model = (() => {
  const COLUMNS = [
    { key: 'wbs', label: 'WBS', width: 52, always: true },
    { key: 'name', label: 'TASK', width: 230, always: true },
    { key: 'start', label: 'START', width: 88 },
    { key: 'end', label: 'END', width: 88 },
    { key: 'duration', label: 'DURATION', width: 80 },
    // Bar (min 34) + gap (6) + value (26) + cell padding (14) + border (1)
    // leaves 19px of slack: below this the bar and the number start clipping.
    { key: 'progress', label: 'PROGRESS', width: 147, minWidth: 100 },
    { key: 'resources', label: 'RESOURCES', width: 122 },
    { key: 'cost', label: 'COST', width: 92 },
    { key: 'priority', label: 'PRIORITY', width: 78 },
    { key: 'status', label: 'STATUS', width: 82 },
    { key: 'baselineStart', label: 'BASELINE START', width: 100 },
    { key: 'baselineEnd', label: 'BASELINE END', width: 96 },
    { key: 'actualStart', label: 'ACTUAL START', width: 96 },
    { key: 'actualEnd', label: 'ACTUAL END', width: 96 },
    { key: 'daysLate', label: 'DAYS LATE', width: 72 },
    { key: 'work', label: 'WORK', width: 64 },
    { key: 'estimatedCost', label: 'EST. COST', width: 88 },
    { key: 'actualCost', label: 'ACTUAL COST', width: 88 },
    { key: 'lateStart', label: 'LATE START', width: 90 },
    { key: 'lateFinish', label: 'LATE FINISH', width: 90 },
    { key: 'totalFloat', label: 'FLOAT', width: 58 },
    { key: 'freeSlack', label: 'FREE SLACK', width: 78 },
    { key: 'critical', label: 'CRITICAL', width: 66 },
    { key: 'notes', label: 'NOTES', width: 190 },
    { key: 'baselineDurationMinutes', label: 'BASELINE DURATION', width: 110 }
  ];
  // Hidden wholesale while the budget & cost switch is off.
  const COST_COLUMNS = ['cost', 'estimatedCost', 'actualCost', 'resourceCost', 'baselineCost'];
  const DEFAULT_HIDDEN = [
    'baselineStart', 'baselineEnd', 'baselineDurationMinutes', 'actualStart', 'actualEnd',
    'actualDurationMinutes', 'daysLate', 'work', 'resourceCost', 'baselineCost', 'estimatedCost',
    'actualCost', 'lateStart', 'lateFinish', 'totalFloat', 'freeSlack', 'critical', 'status'
  ];
  const PRIORITIES = [
    { id: 'high', label: 'High', colour: '#d9534f' },
    { id: 'normal', label: 'Normal', colour: '#4d86c9' },
    { id: 'low', label: 'Low', colour: '#7d93aa' }
  ];
  // Roughly the number of columns the original planner keeps in view for each
  // granularity. The calendar window grows as the unit gets coarser instead of
  // shrinking to the task span (which would leave a nearly empty timeline).
  const RANGE_COLUMNS = { hour: 96, day: 90, week: 30, month: 27, quarter: 20, halfYear: 16, year: 12 };
  const UNIT_DAYS = { hour: 1 / 24, day: 1, week: 7, month: 30.4375, quarter: 91.3125, halfYear: 182.625, year: 365.25 };
  // Every preset carries the high / normal / low priority colours too, so one
  // click in the theme dialog sets both the palette and the priority ramp.
  const THEMES = [
    { id: 'bright-sky', label: 'Bright sky', accent: '#1a6fd1', head: '#0f63c8', bar: '#4d86c9', bar2: '#2f6bb1', ms: '#d98a26',
      high: '#d9534f', normal: '#4d86c9', low: '#7d93aa' },
    { id: 'forest', label: 'Forest', accent: '#2f7d5a', head: '#256b4c', bar: '#5aa17c', bar2: '#3b7f5e', ms: '#cf9026',
      high: '#c15a42', normal: '#5aa17c', low: '#89a696' },
    { id: 'sunset', label: 'Sunset', accent: '#c45a28', head: '#a8481d', bar: '#e08a55', bar2: '#bd6533', ms: '#a85c1c',
      high: '#c33c2e', normal: '#e08a55', low: '#a8907d' },
    { id: 'slate', label: 'Slate', accent: '#4e6b88', head: '#3f586f', bar: '#7e95ad', bar2: '#5e7791', ms: '#c08a3a',
      high: '#c25a55', normal: '#7e95ad', low: '#909aa4' },
    { id: 'plum', label: 'Plum', accent: '#7652a8', head: '#62418f', bar: '#9a7ac4', bar2: '#7957a4', ms: '#c4813f',
      high: '#b8446b', normal: '#9a7ac4', low: '#9a8bae' },
    { id: 'teal', label: 'Teal', accent: '#0f7d86', head: '#0b6670', bar: '#3fa7ac', bar2: '#1d8790', ms: '#d08a30',
      high: '#cf5a4a', normal: '#3fa7ac', low: '#7d9d9e' },
    { id: 'rose', label: 'Rose', accent: '#b8448a', head: '#9d3475', bar: '#d97cae', bar2: '#b5588f', ms: '#b3762f',
      high: '#c0392b', normal: '#d97cae', low: '#a98a97' },
    { id: 'sand', label: 'Sand', accent: '#96742f', head: '#7f5f22', bar: '#c3a26a', bar2: '#a3864f', ms: '#a8802a',
      high: '#bf5b3b', normal: '#c3a26a', low: '#a3947b' },
    { id: 'graphite', label: 'Graphite', accent: '#4a4f57', head: '#3a3f46', bar: '#7b828c', bar2: '#5c636c', ms: '#c08a40',
      high: '#c25450', normal: '#7b828c', low: '#8b9098' },
    { id: 'indigo', label: 'Indigo', accent: '#3b4791', head: '#303b7d', bar: '#6b76bd', bar2: '#4e5aa3', ms: '#c98a35',
      high: '#c14b6b', normal: '#6b76bd', low: '#8b90b5' }
  ];
  const BAR_STYLES = [
    { id: 'raised', label: 'Raised' },
    { id: 'flat', label: 'Flat' },
    { id: 'rounded', label: 'Rounded' },
    { id: 'outline', label: 'Outline' },
    { id: 'pill', label: 'Pill' }
  ];

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Project number shown on the tab; older files without one fall back to the
  // project name.
  function tabLabel(project) {
    const custom = project && String(project.tabName || '').trim();
    return custom || (project && project.name) || 'project';
  }

  // ---------- palette helpers ----------
  function hexToRgb(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }

  // '#1a6fd1' -> 'rgba(26,111,209,0.14)': a translucent version of a palette
  // colour, used for tab tints, chips and avatar backgrounds.
  function alphaOn(hex, alpha, fallback) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
    if (!m) return 'rgba(' + (fallback || '77,134,201') + ',' + alpha + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + alpha + ')';
  }

  function mixHex(a, b, t) {
    const pa = hexToRgb(a), pb = hexToRgb(b);
    if (!pa || !pb) return a;
    const ch = (i) => Math.round(pa[i] + (pb[i] - pa[i]) * t).toString(16).padStart(2, '0');
    return '#' + ch(0) + ch(1) + ch(2);
  }

  function themeOf(project) {
    const id = project && project.appearance && project.appearance.themeId;
    return THEMES.find((t) => t.id === id) || THEMES[0];
  }

  const PALETTE_KEYS = ['accent', 'head', 'bar', 'bar2', 'summary', 'progress', 'milestone'];

  // Colours a preset stands for, before any project-level override.
  function paletteFromTheme(id) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    return {
      accent: t.accent,
      head: t.head,
      bar: t.bar,
      bar2: t.bar2,
      summary: t.head,
      progress: mixHex(t.bar2, '#ffffff', 0.55),
      milestone: t.ms
    };
  }

  // Priority ramp a preset stands for, before any project-level override.
  function priorityFromTheme(id) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    return { high: t.high, normal: t.normal, low: t.low };
  }

  // Effective palette: preset first, then appearance.customPalette on top.
  function paletteOf(project) {
    const base = paletteFromTheme(themeOf(project).id);
    const custom = (project && project.appearance && project.appearance.customPalette) || {};
    const out = {};
    PALETTE_KEYS.forEach((k) => {
      out[k] = (typeof custom[k] === 'string' && /^#[0-9a-f]{6}$/i.test(custom[k])) ? custom[k] : base[k];
    });
    return out;
  }

  function defaultView() {
    return {
      hiddenColumns: DEFAULT_HIDDEN.slice(),
      columnOrder: [],
      gridColumnWidths: {},
      timelineColumnWidths: {},
      barLabelFields: ['name'],
      dashboardPanels: ['complete', 'cost', 'status'],
      progressMode: 'manual',
      dateFormat: 'dd-mmm-yy',
      showTimes: false,
      showBaselineBars: true,
      showActualBars: true,
      showLinks: true,
      showCriticalPath: false,
      // null inherits the app-wide budget & cost switch; true/false opts this
      // project in or out on its own.
      showCosts: null,
      zoom: 'day'
    };
  }
  function makeCalendar(name = 'Standard') {
    const times = [];
    for (let i = 0; i < 7; i++) {
      times.push(i >= 1 && i <= 5 ? [{ from: '08:00', to: '12:00' }, { from: '13:00', to: '17:00' }] : []);
    }
    return {
      id: U.uid(), name,
      workingWeekdays: [false, true, true, true, true, true, false],
      workingTimes: times,
      holidays: [],
      worksThrough: []
    };
  }
  function blankProject(name = 'project') {
    const cal = makeCalendar();
    return {
      schemaVersion: 1,
      id: U.uid(),
      name,
      // Project number shown on the tab. Empty only survives in older files
      // and sample projects; the project name itself stays the document title.
      tabName: '',
      // Projects shown inside this one. Each entry is a reference, never a
      // copy: rows are read from the source project whenever the plan is drawn.
      linkedProjects: [],
      notes: '',
      lead: '',
      startDate: U.todayISO(),
      defaultCalendarId: cal.id,
      hoursPerDay: 8,
      hoursPerWeek: 40,
      defaultDurationUnit: 'd',
      lengthFrom: 'duration',
      currency: '¥',
      money: { numbers: 'comma-point', symbol: 'before', decimals: 2 },
      estimatedBudget: null,
      baselineBudget: null,
      appearance: {
        themeId: 'bright-sky',
        barStyle: 'raised',
        headerStyle: 'banner',
        defaultBarColour: null,
        defaultProgressColour: null,
        priorityColours: { high: null, normal: null, low: null },
        customPalette: null,
        // Leaf bars can take the colour of their first assigned resource; tasks
        // that are past due without finishing can be flagged in a colour of
        // their own (chosen in the theme-colour dialog). Both are off until the
        // project opts in.
        colourFromPeople: false,
        overdueOn: false,
        overdueColour: '#d9534f'
      },
      view: defaultView(),
      customColumns: [],
      revision: 0,
      updatedAt: new Date().toISOString(),
      tasks: [],
      links: [],
      resources: [],
      calendars: [cal]
    };
  }

  function normalizeCalendar(c) {
    const out = Object.assign(makeCalendar(c && c.name ? c.name : 'Standard'), c || {});
    out.id = out.id || U.uid();
    if (!Array.isArray(out.workingWeekdays) || out.workingWeekdays.length < 7) {
      out.workingWeekdays = [false, true, true, true, true, true, false];
    } else if (out.workingWeekdays.some((v) => typeof v === 'number')) {
      const wd = out.workingWeekdays.map(Number);
      out.workingWeekdays = [0, 1, 2, 3, 4, 5, 6].map((i) => wd.includes(i) || wd.includes(i + 1));
    }
    out.workingWeekdays = out.workingWeekdays.slice(0, 7).map(Boolean);
    if (!Array.isArray(out.workingTimes) || out.workingTimes.length < 7) {
      out.workingTimes = [0, 1, 2, 3, 4, 5, 6].map((i) => out.workingWeekdays[i] ? [{ from: '08:00', to: '17:00' }] : []);
    }
    out.workingTimes = out.workingTimes.slice(0, 7).map((t) => Array.isArray(t) ? t : []);
    out.holidays = (out.holidays || []).map((h) => typeof h === 'string' ? { date: h, name: '' } : { date: h.date, name: h.name || '' }).filter((h) => h.date);
    out.worksThrough = (out.worksThrough || []).map((h) => typeof h === 'string' ? h : h.date).filter(Boolean);
    return out;
  }

  function normalizeTask(t, project, index) {
    const type = (t.type === 'milestone' || t.milestone) ? 'milestone' : (t.type === 'summary' ? 'summary' : 'task');
    let duration = t.duration;
    let unit = t.durationUnit || project.defaultDurationUnit || 'd';
    if (duration == null) {
      if (t.durationMinutes != null) {
        duration = (Number(t.durationMinutes) / 60) / (Number(project.hoursPerDay) || 8);
        unit = 'd';
      } else if (t.durationHours != null) {
        duration = Number(t.durationHours);
        unit = 'h';
      } else {
        duration = type === 'milestone' ? 0 : 1;
      }
    }
    const start = t.start || t.startDate || t.begin || project.startDate;
    let end = t.end || t.endDate || t.finish || null;
    const percent = t.percentComplete != null ? Number(t.percentComplete) : (t.progress != null ? Number(t.progress) : 0);
    let resources = t.resources || t.resourceIds || [];
    if (Array.isArray(resources)) {
      resources = resources.map((r) => typeof r === 'string' ? { resourceId: r, units: 100 } : {
        resourceId: r.resourceId || r.id || r.resource, units: r.units == null ? 100 : Number(r.units)
      }).filter((r) => r.resourceId);
    } else resources = [];
    return {
      id: t.id || U.uid(),
      name: t.name || t.title || ('Task ' + (index + 1)),
      notes: t.notes || t.description || '',
      parentId: t.parentId || (t.parent && t.parent !== 'null' ? t.parent : null),
      type,
      order: t.order != null ? t.order : index,
      start: start || project.startDate,
      end,
      duration: duration == null ? null : Math.max(0, Number(duration) || 0),
      durationUnit: unit,
      percentComplete: U.clamp(percent, 0, 100),
      priority: t.priority || 'normal',
      color: t.color || t.colour || null,
      progressColor: t.progressColor || t.progressColour || null,
      calendarId: t.calendarId || null,
      resources,
      cost: t.cost != null ? Number(t.cost) : (t.resourceCost != null ? Number(t.resourceCost) : null),
      estimatedCost: t.estimatedCost != null ? Number(t.estimatedCost) : null,
      actualCost: t.actualCost != null ? Number(t.actualCost) : null,
      baselineCost: t.baselineCost != null ? Number(t.baselineCost) : null,
      baselineStart: t.baselineStart || null,
      baselineEnd: t.baselineEnd || null,
      actualStart: t.actualStart || null,
      actualEnd: t.actualEnd || null,
      lateStart: t.lateStart || null,
      lateFinish: t.lateFinish || null,
      totalFloat: t.totalFloat != null ? Number(t.totalFloat) : null,
      freeSlack: t.freeSlack != null ? Number(t.freeSlack) : null,
      critical: !!t.critical,
      status: t.status || null,
      collapsed: !!t.collapsed,
      manual: !!t.manual,
      custom: t.custom || {}
    };
  }

  function normalizeProject(raw, fallbackName = 'project') {
    if (!raw || typeof raw !== 'object') raw = {};
    if (raw.project && typeof raw.project === 'object') raw = raw.project;
    const base = blankProject(raw.name || fallbackName);
    const p = Object.assign(base, raw);
    p.id = raw.id || base.id;
    p.schemaVersion = raw.schemaVersion || 1;
    p.name = raw.name || fallbackName;
    p.tabName = String(raw.tabName || '').trim();
    p.notes = raw.notes || '';
    p.lead = raw.lead || '';
    p.startDate = raw.startDate || raw.start || U.todayISO();
    p.hoursPerDay = Number(raw.hoursPerDay) || 8;
    p.hoursPerWeek = Number(raw.hoursPerWeek) || 40;
    p.defaultDurationUnit = raw.defaultDurationUnit || 'd';
    p.currency = raw.currency || (raw.money && raw.money.currency) || '¥';
    p.money = Object.assign({ numbers: 'comma-point', symbol: 'before', decimals: 2 }, raw.money || {});
    p.estimatedBudget = raw.estimatedBudget != null ? Number(raw.estimatedBudget) : null;
    p.baselineBudget = raw.baselineBudget != null ? Number(raw.baselineBudget) : null;
    p.appearance = Object.assign({
      themeId: 'bright-sky', barStyle: 'raised', headerStyle: 'banner', defaultBarColour: null,
      defaultProgressColour: null, priorityColours: { high: null, normal: null, low: null }, customPalette: null,
      colourFromPeople: false, overdueOn: false, overdueColour: '#d9534f'
    }, raw.appearance || {});
    p.view = Object.assign(defaultView(), raw.view || {});
    if (Array.isArray(raw.hiddenColumns) && raw.hiddenColumns.length) p.view.hiddenColumns = raw.hiddenColumns.slice();
    if (p.view.zoom === 'hour') p.view.zoom = 'day';
    p.view.showCosts = (raw.view && typeof raw.view.showCosts === 'boolean') ? raw.view.showCosts : null;
    p.view.dashboardPanels = Array.isArray(p.view.dashboardPanels) && p.view.dashboardPanels.length ? p.view.dashboardPanels : ['complete', 'cost', 'status'];
    p.view.barLabelFields = Array.isArray(p.view.barLabelFields) && p.view.barLabelFields.length ? p.view.barLabelFields : ['name'];
    p.customColumns = Array.isArray(raw.customColumns) ? raw.customColumns : [];
    p.revision = Number(raw.revision) || 0;
    p.updatedAt = raw.updatedAt || new Date().toISOString();

    let calendars = Array.isArray(raw.calendars) ? raw.calendars : [];
    if (!calendars.length) calendars = [makeCalendar()];
    p.calendars = calendars.map(normalizeCalendar);
    if (!p.defaultCalendarId || !p.calendars.some((c) => c.id === p.defaultCalendarId)) p.defaultCalendarId = p.calendars[0].id;

    p.linkedProjects = normalizeLinks(raw.linkedProjects).filter((l) => l.projectId !== p.id);
    p.resources = (Array.isArray(raw.resources) ? raw.resources : []).map((r) => ({
      id: r.id || U.uid(),
      name: r.name || r.title || 'Resource',
      role: r.role || r.jobTitle || '',
      email: r.email || '',
      rate: r.rate != null ? Number(r.rate) : (r.costPerHour != null ? Number(r.costPerHour) * p.hoursPerDay : 0),
      rateUnit: r.rateUnit || 'd',
      colour: r.colour || r.color || '#4d86c9',
      notes: r.notes || ''
    }));
    const resIds = new Set(p.resources.map((r) => r.id));
    p.tasks = (Array.isArray(raw.tasks) ? raw.tasks : []).map((t, i) => normalizeTask(t, p, i));
    p.tasks.forEach((t, i) => {
      if (t.parentId && !p.tasks.some((x) => x.id === t.parentId)) t.parentId = null;
      if (t.order == null) t.order = i;
      t.resources = (t.resources || []).filter((r) => resIds.has(r.resourceId) || !p.resources.length);
    });
    const taskIds = new Set(p.tasks.map((t) => t.id));
    p.links = (Array.isArray(raw.links) ? raw.links : []).map((l) => {
      let lag = Number(l.lag) || 0;
      if (l.lagMinutes != null) lag = (Number(l.lagMinutes) / 60) / (Number(p.hoursPerDay) || 8);
      return {
        id: l.id || U.uid(),
        from: l.from || l.fromId || l.predecessorId || l.source,
        to: l.to || l.toId || l.successorId || l.target,
        type: String(l.type || l.linkType || 'FS').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'FS',
        lag,
        lagUnit: l.lagUnit || 'd'
      };
    }).filter((l) => taskIds.has(l.from) && taskIds.has(l.to) && l.from !== l.to);
    reschedule(p);
    return p;
  }

  // A reference row: { id, projectId, collapsed }. Kept tiny on purpose —
  // everything else is looked up live. `collapsed` must survive the trip: this
  // function runs on every write, and dropping the flag made a collapsed
  // referenced block spring open again after a repaint or a reload.
  function normalizeLinks(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((l) => l && l.projectId).map((l) => ({
      id: l.id || U.uid(),
      projectId: l.projectId,
      collapsed: !!l.collapsed
    }));
  }

  // Which entry a reference points at. Records are written with the source
  // project's id, but older ones carry the tab id: both resolve here, which is
  // what keeps a reference editable after an upgrade.
  function resolveLinkProject(link, all) {
    if (!link || !link.projectId) return null;
    const list = all || [];
    return list.find((p) => p.project && p.project.id === link.projectId) ||
      list.find((p) => p.id === link.projectId) || null;
  }

  function calendarFor(project, task) {
    return project.calendars.find((c) => c.id === (task && task.calendarId)) ||
      project.calendars.find((c) => c.id === project.defaultCalendarId) || project.calendars[0];
  }
  // Parent -> children in one pass. Callers that walk the whole tree pass the
  // index in; the two-argument form still works for one-off lookups.
  function childIndex(project) {
    const map = new Map();
    project.tasks.forEach((t) => {
      const key = t.parentId || null;
      const list = map.get(key);
      if (list) list.push(t);
      else map.set(key, [t]);
    });
    return map;
  }
  function childrenOf(project, parentId, index) {
    const map = index || childIndex(project);
    return map.get(parentId || null) || [];
  }
  function hasChildren(project, taskId) {
    return project.tasks.some((t) => t.parentId === taskId);
  }
  function descendantIds(project, taskId) {
    const out = [];
    const walk = (id) => {
      project.tasks.forEach((t) => {
        if (t.parentId === id) { out.push(t.id); walk(t.id); }
      });
    };
    walk(taskId);
    return out;
  }
  function subtreeIds(project, taskId) { return [taskId].concat(descendantIds(project, taskId)); }
  function subtreeTasks(project, taskId) {
    const ids = new Set(subtreeIds(project, taskId));
    return project.tasks.filter((t) => ids.has(t.id));
  }
  function getTask(project, id) { return project.tasks.find((t) => t.id === id) || null; }

  function flatten(project, opts) {
    opts = opts || {};
    const includeCollapsed = !!opts.includeCollapsed;
    const index = childIndex(project);
    const rows = [];
    const seen = new Set();
    // A root is a top-level task, or one whose parent is no longer in the plan.
    const ids = new Set(project.tasks.map((t) => t.id));
    const roots = project.tasks.filter((t) => !t.parentId || !ids.has(t.parentId));
    const markSubtree = (list) => {
      list.forEach((task) => {
        if (seen.has(task.id)) return;
        seen.add(task.id);
        const kids = index.get(task.id);
        if (kids && kids.length) markSubtree(kids);
      });
    };
    const walk = (list, level, prefix) => {
      list.forEach((task, idx) => {
        if (seen.has(task.id)) return;
        seen.add(task.id);
        const wbs = prefix ? prefix + '.' + (idx + 1) : String(idx + 1);
        const kids = index.get(task.id) || [];
        rows.push({ task, level, wbs, hasChildren: kids.length > 0, collapsed: !!task.collapsed });
        if (!kids.length) return;
        if (includeCollapsed || !task.collapsed) walk(kids, level + 1, wbs);
        // Children of a collapsed phase stay hidden, but must not fall through
        // to the orphan pass below.
        else markSubtree(kids);
      });
    };
    walk(roots, 0, '');
    // orphan tasks (cycles) still shown
    project.tasks.forEach((t) => {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        rows.push({ task: t, level: 0, wbs: String(rows.length + 1), hasChildren: false, collapsed: false });
      }
    });
    return rows;
  }

  function durationDays(project, task) {
    return U.durationToDays(task.duration, task.durationUnit || 'd', project.hoursPerDay, 5);
  }
  function setDurationFromDays(project, task, days) {
    if (task.durationUnit === 'h') { task.duration = U.round(days * project.hoursPerDay, 2); }
    else if (task.durationUnit === 'w') { task.duration = U.round(days / 5, 2); }
    else { task.duration = U.round(days, 2); task.durationUnit = 'd'; }
  }

  function forwardSchedule(project) {
    const byId = new Map(project.tasks.map((t) => [t.id, t]));
    const all = flatten(project, { includeCollapsed: true });
    const leaf = all.filter((r) => !r.hasChildren).map((r) => r.task);
    const leafIds = new Set(leaf.map((t) => t.id));
    const preds = new Map(leaf.map((t) => [t.id, []]));
    const succs = new Map(leaf.map((t) => [t.id, []]));
    project.links.forEach((l) => {
      if (preds.has(l.to) && leafIds.has(l.from)) preds.get(l.to).push(l);
      if (succs.has(l.from) && leafIds.has(l.to)) succs.get(l.from).push(l);
    });
    const indeg = new Map(leaf.map((t) => [t.id, preds.get(t.id).length]));
    const queue = leaf.filter((t) => indeg.get(t.id) === 0);
    const order = [];
    // A moving head beats shift(): shift() reindexes the array every time and
    // turned this sort quadratic on plans with hundreds of tasks.
    for (let head = 0; head < queue.length; head += 1) {
      const t = queue[head];
      order.push(t);
      const outs = succs.get(t.id);
      for (let i = 0; i < outs.length; i += 1) {
        const next = indeg.get(outs[i].to) - 1;
        indeg.set(outs[i].to, next);
        if (next === 0) queue.push(byId.get(outs[i].to));
      }
    }
    // Whatever is left sits in a dependency cycle; keep it in outline order.
    const placed = new Set(order);
    leaf.forEach((t) => { if (!placed.has(t)) order.push(t); });
    order.forEach((task) => {
      const cal = calendarFor(project, task);
      const isMilestone = task.type === 'milestone';
      let dur = isMilestone ? 0 : durationDays(project, task);
      if (!isMilestone && task.duration == null && task.end && task.start && U.diffDays(task.start, task.end) >= 0) {
        dur = Math.max(0, U.workingDaysBetween(task.start, task.end, cal));
        setDurationFromDays(project, task, dur);
      }
      if (!isMilestone && task.duration == null) dur = 1;
      const links = preds.get(task.id) || [];
      if (!task.start) task.start = project.startDate;
      if (links.length && !task.manual) {
        const candidates = [];
        links.forEach((l) => {
          const pred = byId.get(l.from);
          if (!pred) return;
          const lag = Number(l.lag) || 0;
          if (l.type === 'FS') candidates.push(U.nextWorkdayAfter(U.addDays(pred.end || pred.start, lag), cal));
          else if (l.type === 'SS') candidates.push(U.addWorkingDays(pred.start, lag + 1, cal));
          else if (l.type === 'FF') {
            const end = U.addWorkingDays(pred.end || pred.start, lag + 1, cal);
            candidates.push(U.subWorkingDays(end, Math.max(1, Math.ceil(dur)), cal));
          } else if (l.type === 'SF') {
            const end = U.addWorkingDays(pred.start, lag + 1, cal);
            candidates.push(U.subWorkingDays(end, Math.max(1, Math.ceil(dur)), cal));
          }
        });
        if (candidates.length) {
          candidates.sort((a, b) => U.diffDays(b, a));
          task.start = candidates[candidates.length - 1];
        }
      }
      if (!task.start) task.start = project.startDate;
      // duration is authoritative: finish is always derived from start + duration
      if (isMilestone || dur <= 0) {
        task.duration = 0;
        task.end = task.start;
      } else {
        task.end = U.endFromDuration(task.start, dur, cal);
        if (task.duration == null) setDurationFromDays(project, task, dur);
      }
      if (!isMilestone && (project.view.progressMode || 'manual') === 'auto') {
        const today = U.todayISO();
        if (U.diffDays(task.end, today) > 0) task.percentComplete = 100;
        else if (U.diffDays(today, task.start) > 0) task.percentComplete = 0;
        else {
          const total = U.workingDaysBetween(task.start, task.end, cal);
          const elapsed = U.workingDaysBetween(task.start, U.addDays(today, -1), cal);
          task.percentComplete = total ? U.clamp(Math.round(elapsed / total * 100), 0, 99) : 0;
        }
      }
      task.critical = false;
      task.totalFloat = null; task.freeSlack = null;
      task.lateStart = null; task.lateFinish = null;
      task.status = statusFor(task);
    });

    // roll up summary tasks post-order
    const kidsIndex = childIndex(project);
    const roll = (task, kids) => {
      if (!kids || !kids.length) return;
      kids.forEach((k) => roll(k, kidsIndex.get(k.id)));
      const cal = calendarFor(project, task);
      const starts = kids.map((k) => k.start).filter(Boolean);
      const ends = kids.map((k) => k.end || k.start).filter(Boolean);
      if (starts.length) task.start = starts.sort((a, b) => U.diffDays(b, a))[0];
      if (ends.length) task.end = ends.sort((a, b) => U.diffDays(b, a))[ends.length - 1];
      let weight = 0, done = 0;
      kids.forEach((k) => {
        const w = Math.max(0.5, durationDays(project, k));
        weight += w; done += w * (k.percentComplete || 0) / 100;
      });
      task.percentComplete = weight ? U.round(done / weight * 100) : 0;
      task.duration = Math.max(1, U.workingDaysBetween(task.start, task.end, cal));
      task.durationUnit = 'd';
      task.type = 'task';
      task.estimatedCost = sumField(kids, 'estimatedCost') || sumField(kids, 'cost');
      task.cost = sumField(kids, 'cost');
      task.actualCost = sumField(kids, 'actualCost');
      task.baselineCost = sumField(kids, 'baselineCost');
      task.status = statusFor(task);
    };
    project.tasks.forEach((t) => {
      const kids = kidsIndex.get(t.id);
      if (kids && kids.length) roll(t, kids);
    });
    return order;
  }

  function sumField(tasks, field) {
    const vals = tasks.map((t) => t[field]).filter((v) => v != null && isFinite(Number(v)));
    return vals.length ? vals.reduce((a, b) => a + Number(b), 0) : null;
  }

  function statusFor(task) {
    if (Number(task.percentComplete) >= 100) return 'done';
    if (Number(task.percentComplete) > 0 || task.actualStart) return 'underway';
    if (task.end && U.diffDays(task.end, U.todayISO()) > 0) return 'late';
    return 'planned';
  }

  // Past its finish and not complete — whether or not work has started. The
  // status field above marks a started-but-late task as "underway", so the
  // overdue highlight cannot depend on status alone.
  function isOverdue(task) {
    if (!task) return false;
    if (Number(task.percentComplete) >= 100) return false;
    const end = task.end || task.start;
    return !!end && U.diffDays(end, U.todayISO()) > 0;
  }

  function computeCritical(project) {
    const rows = flatten(project, { includeCollapsed: true });
    const leaf = rows.filter((r) => !r.hasChildren).map((r) => r.task);
    if (!leaf.length) return;
    const byId = new Map(leaf.map((t) => [t.id, t]));
    const succ = new Map(leaf.map((t) => [t.id, []]));
    project.links.forEach((l) => { if (byId.has(l.from) && byId.has(l.to)) succ.get(l.from).push(l); });
    const finish = leaf.map((t) => t.end || t.start).sort((a, b) => U.diffDays(b, a)).pop();
    if (!finish) return;
    const order = [];
    const seen = new Set();
    const visit = (t) => {
      if (!t || seen.has(t.id)) return;
      seen.add(t.id);
      succ.get(t.id).forEach((l) => visit(byId.get(l.to)));
      order.push(t);
    };
    leaf.forEach(visit); // reverse topological-ish (succ first)
    const late = new Map();
    order.forEach((task) => {
      const cal = calendarFor(project, task);
      const dur = Math.max(0, Math.ceil(durationDays(project, task)));
      let lf = null;
      const out = succ.get(task.id);
      if (!out.length) lf = finish;
      else {
        out.forEach((l) => {
          const s = late.get(l.to);
          if (!s) return;
          const lag = Number(l.lag) || 0;
          let cand = null;
          if (l.type === 'FS') cand = U.subWorkingDays(s.ls, 1 + Math.max(1, lag + 1), cal);
          else if (l.type === 'SS') cand = U.subWorkingDays(s.ls, lag + 1, cal);
          else if (l.type === 'FF') cand = U.subWorkingDays(s.lf, lag + 1, cal);
          else if (l.type === 'SF') cand = U.subWorkingDays(s.ls, 1 + Math.max(1, lag + 1), cal);
          if (cand && (!lf || U.diffDays(cand, lf) > 0)) lf = cand;
        });
      }
      if (!lf) lf = finish;
      const ls = dur <= 0 ? lf : U.subWorkingDays(lf, Math.max(1, dur), cal);
      late.set(task.id, { ls, lf });
    });
    leaf.forEach((task) => {
      const cal = calendarFor(project, task);
      const l = late.get(task.id) || { ls: task.start, lf: task.end };
      task.lateStart = l.ls;
      task.lateFinish = l.lf;
      const float = Math.max(0, U.workingDaysBetween(task.start, l.ls, cal) - 1);
      task.totalFloat = float;
      const outs = succ.get(task.id);
      if (outs.length) {
        let minSuccStart = null;
        outs.forEach((l) => {
          const s = getTask(project, l.to);
          if (s && (!minSuccStart || U.diffDays(minSuccStart, s.start) < 0)) minSuccStart = s.start;
        });
        task.freeSlack = minSuccStart ? Math.max(0, U.workingDaysBetween(task.end, minSuccStart, cal) - 1) : 0;
      } else task.freeSlack = Math.max(0, U.workingDaysBetween(task.end, finish, cal) - 1);
      task.critical = float <= 0;
    });
    // any summary containing a critical child is critical itself
    project.tasks.filter((t) => hasChildren(project, t.id)).forEach((t) => {
      t.critical = subtreeTasks(project, t.id).some((k) => k.id !== t.id && !hasChildren(project, k.id) && k.critical);
      const kids = subtreeTasks(project, t.id).filter((k) => k.id !== t.id && !hasChildren(project, k.id));
      if (kids.length) t.totalFloat = Math.min.apply(null, kids.map((k) => k.totalFloat == null ? 0 : k.totalFloat));
    });
  }

  function reschedule(project) {
    project.calendars = (project.calendars || []).map(normalizeCalendar);
    project.tasks.forEach((t) => {
      if (!t.id) t.id = U.uid();
      if (t.type === 'milestone') t.duration = 0;
      else if (t.duration == null && !t.end) t.duration = 1;
      if (!t.start) t.start = project.startDate;
      t.color = t.color || null;
      t.resources = Array.isArray(t.resources) ? t.resources : [];
    });
    const order = forwardSchedule(project);
    computeCritical(project);
    project.revision = (project.revision || 0) + 1;
    project.updatedAt = new Date().toISOString();
    return order;
  }

  function stats(project) {
    const rows = flatten(project, { includeCollapsed: true });
    const leaves = rows.filter((r) => !r.hasChildren).map((r) => r.task);
    const taskCount = leaves.length;
    let weight = 0, doneW = 0;
    leaves.forEach((t) => {
      const w = Math.max(0.5, durationDays(project, t));
      weight += w; doneW += w * (Number(t.percentComplete) || 0) / 100;
    });
    const percent = weight ? U.round(doneW / weight * 100) : 0;
    const allStarts = leaves.map((t) => t.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const allEnds = leaves.map((t) => t.end || t.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const first = allStarts[0] || project.startDate;
    const last = allEnds[allEnds.length - 1] || first;
    const cal = project.calendars.find((c) => c.id === project.defaultCalendarId) || project.calendars[0];
    const today = U.todayISO();
    const span = U.workingDaysBetween(first, last, cal);
    const elapsed = U.workingDaysBetween(first, U.diffDays(last, today) > 0 ? last : today, cal);
    const planned = span ? U.clamp(U.round(elapsed / span * 100), 0, 100) : 0;
    const done = leaves.filter((t) => t.status === 'done').length;
    const underway = leaves.filter((t) => t.status === 'underway').length;
    const late = leaves.filter((t) => t.status === 'late').length;
    const plannedCount = leaves.filter((t) => t.status === 'planned').length;
    const estimated = leaves.reduce((a, t) => a + Number(t.estimatedCost != null ? t.estimatedCost : (t.cost != null ? t.cost : resourceCost(project, t)) || 0), 0);
    const actual = leaves.reduce((a, t) => a + (Number(t.actualCost) || 0), 0);
    const baseline = leaves.reduce((a, t) => a + (Number(t.baselineCost) || 0), 0);
    const budget = project.estimatedBudget != null ? Number(project.estimatedBudget) : (estimated || project.baselineBudget || 0);
    const milestones = leaves.filter((t) => t.type === 'milestone' && t.start && U.diffDays(today, t.start) >= 0)
      .sort((a, b) => U.diffDays(b.start, a.start));
    const phases = flatten(project, { includeCollapsed: true }).filter((r) => r.hasChildren).map((r) => ({
      name: r.task.name, percent: r.task.percentComplete || 0, start: r.task.start, end: r.task.end
    }));
    return {
      percent, planned, pointsBehind: Math.max(0, Math.round(planned - percent)),
      taskCount, done, underway, plannedCount, late,
      estimated, actual, baseline, budget,
      costPercent: budget ? U.clamp(U.round(actual / budget * 100), 0, 100) : 0,
      first, last, milestones, phases,
      remaining: Math.max(0, budget - actual)
    };
  }

  // The same summary as stats(), but over the open project plus every plan it
  // references. The dashboard reads this so a reference-only page reports the
  // work it actually shows instead of 0 % / 0 tasks / 0 people.
  function statsWithReferences(project, allProjects) {
    const today = U.todayISO();
    const groups = [{ project, rows: flatten(project, { includeCollapsed: true }) }];
    normalizeLinks(project.linkedProjects).forEach((link) => {
      const entry = resolveLinkProject(link, allProjects);
      if (entry && entry.project !== project) {
        groups.push({ project: entry.project, rows: flatten(entry.project, { includeCollapsed: true }) });
      }
    });
    const leaves = [];
    groups.forEach((g) => {
      g.rows.forEach((row) => {
        if (!row.hasChildren) leaves.push({ task: row.task, owner: g.project });
      });
    });

    let weight = 0, doneW = 0;
    leaves.forEach(({ task, owner }) => {
      const w = Math.max(0.5, durationDays(owner, task));
      weight += w;
      doneW += w * (Number(task.percentComplete) || 0) / 100;
    });
    const percent = weight ? U.round(doneW / weight * 100) : 0;
    const starts = leaves.map((x) => x.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const ends = leaves.map((x) => x.task.end || x.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const first = starts[0] || project.startDate || today;
    const last = ends[ends.length - 1] || first;
    const cal = calendarFor(project, null);
    const span = U.workingDaysBetween(first, last, cal);
    const elapsed = U.workingDaysBetween(first, U.diffDays(last, today) > 0 ? last : today, cal);
    const planned = span ? U.clamp(U.round(elapsed / span * 100), 0, 100) : 0;
    const done = leaves.filter((x) => x.task.status === 'done').length;
    const underway = leaves.filter((x) => x.task.status === 'underway').length;
    const plannedCount = leaves.filter((x) => x.task.status === 'planned').length;
    const late = leaves.filter((x) => x.task.status === 'late').length;

    let estimated = 0, actual = 0, baseline = 0;
    leaves.forEach(({ task, owner }) => {
      estimated += Number(task.estimatedCost != null ? task.estimatedCost
        : (task.cost != null ? task.cost : resourceCost(owner, task)) || 0);
      actual += Number(task.actualCost) || 0;
      baseline += Number(task.baselineCost) || 0;
    });
    const owners = [];
    groups.forEach((g) => { if (owners.indexOf(g.project) < 0) owners.push(g.project); });
    let budget = 0, hasBudget = false;
    owners.forEach((p) => {
      if (p.estimatedBudget != null) {
        budget += Number(p.estimatedBudget) || 0;
        hasBudget = true;
      }
    });
    if (!hasBudget) budget = estimated || Number(project.baselineBudget) || 0;

    const milestones = leaves
      .filter((x) => x.task.type === 'milestone' && x.task.start && U.diffDays(today, x.task.start) >= 0)
      .map((x) => x.task)
      .sort((a, b) => U.diffDays(b.start, a.start));

    // People are merged by name: the same person has a different roster id in
    // every plan, so ids would split them into separate rows.
    const peopleMap = new Map();
    leaves.forEach(({ task, owner }) => {
      const byId = new Map((owner.resources || []).map((r) => [r.id, r]));
      (task.resources || []).forEach((a) => {
        const res = byId.get(a.resourceId);
        if (!res) return;
        const name = res.name || 'Unassigned';
        const key = String(name).trim().toLowerCase();
        let rec = peopleMap.get(key);
        if (!rec) {
          rec = { id: key, name, role: res.role || '', tasks: 0, done: 0, active: 0, late: 0, percent: 0, hours: 0, next: '' };
          peopleMap.set(key, rec);
        }
        const pct = U.clamp(Number(task.percentComplete) || 0, 0, 100);
        rec.tasks += 1;
        rec.percent += pct;
        if (task.status === 'done' || pct >= 100) rec.done += 1;
        else if (task.start && U.diffDays(task.start, today) >= 0 && U.diffDays(today, task.end || task.start) >= 0) rec.active += 1;
        if (task.status === 'late') rec.late += 1;
        const units = a.units == null ? 100 : Number(a.units);
        rec.hours += durationDays(owner, task) * (Number(owner.hoursPerDay) || 8) * units / 100;
        if (!rec.next && task.end && U.diffDays(today, task.end) >= 0) rec.next = task.end;
      });
    });
    const people = [...peopleMap.values()].map((rec) => Object.assign({}, rec, {
      completion: rec.tasks ? U.round(rec.percent / rec.tasks) : 0
    })).sort((a, b) => b.tasks - a.tasks || String(a.name).localeCompare(String(b.name)));

    return {
      percent, planned, pointsBehind: Math.max(0, Math.round(planned - percent)),
      taskCount: leaves.length, done, underway, plannedCount, late,
      estimated, actual, baseline, budget,
      costPercent: budget ? U.clamp(U.round(actual / budget * 100), 0, 100) : 0,
      first, last, milestones,
      phases: flatten(project, { includeCollapsed: true }).filter((r) => r.hasChildren).map((r) => ({
        name: r.task.name, percent: r.task.percentComplete || 0, start: r.task.start, end: r.task.end
      })),
      remaining: Math.max(0, budget - actual),
      people
    };
  }

  function resourceCost(project, task) {
    let cost = 0;
    (task.resources || []).forEach((a) => {
      const r = project.resources.find((x) => x.id === a.resourceId);
      if (!r) return;
      const rate = Number(r.rate) || 0;
      const days = durationDays(project, task);
      const factor = r.rateUnit === 'h' ? days * project.hoursPerDay : (r.rateUnit === 'w' ? days / 5 : days);
      cost += rate * factor * ((a.units == null ? 100 : Number(a.units)) / 100);
    });
    return U.round(cost, 2);
  }

  function timelineRange(project, zoom) {
    const all = project.tasks;
    const starts = all.map((t) => t.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const ends = all.map((t) => t.end || t.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    // The visible plan starts on the Monday of the week before the project
    // start date, as in the original planner.
    const baseStart = project.startDate || (starts.length ? starts[0] : U.todayISO());
    const mondayBefore = U.addDays(baseStart, -7);
    const monday = U.addDays(mondayBefore, -((U.weekday(mondayBefore) + 6) % 7));
    const min = monday;
    let max = ends.length ? ends[ends.length - 1] : U.addDays(min, 30);
    if (U.diffDays(min, max) < 0) max = min;
    const columns = RANGE_COLUMNS[zoom] || RANGE_COLUMNS.day;
    const budget = Math.max(1, Math.round(columns * (UNIT_DAYS[zoom] || 1)));
    const span = U.diffDays(min, max) + 1;
    if (span < budget) max = U.addDays(max, budget - span);
    return { start: min, end: max, days: Math.max(1, U.diffDays(min, max) + 1) };
  }
  // ---------- outline operations ----------
  function insertionIndexAfterSubtree(project, taskId) {
    const ids = subtreeIds(project, taskId);
    let idx = -1;
    project.tasks.forEach((t, i) => { if (ids.includes(t.id)) idx = Math.max(idx, i); });
    return idx < 0 ? project.tasks.length : idx + 1;
  }
  function addTask(project, opts) {
    opts = opts || {};
    const ref = opts.refId ? getTask(project, opts.refId) : null;
    let parentId = null, insertAt = project.tasks.length;
    if (ref) {
      if (hasChildren(project, ref.id)) { parentId = ref.id; insertAt = insertionIndexAfterSubtree(project, ref.id); }
      else { parentId = ref.parentId || null; insertAt = insertionIndexAfterSubtree(project, ref.id); }
    }
    const start = opts.start || (ref ? ref.start : project.startDate) || U.todayISO();
    const task = {
      id: U.uid(), name: opts.name || (opts.type === 'milestone' ? 'New milestone' : 'New task'),
      notes: '', parentId, type: opts.type === 'milestone' ? 'milestone' : 'task', order: insertAt,
      start, end: start, duration: opts.type === 'milestone' ? 0 : 1, durationUnit: 'd',
      percentComplete: 0, priority: 'normal', color: null, progressColor: null, calendarId: project.defaultCalendarId || null,
      resources: [], cost: null, estimatedCost: null, actualCost: null, baselineCost: null,
      baselineStart: null, baselineEnd: null, actualStart: null, actualEnd: null,
      lateStart: null, lateFinish: null, totalFloat: null, freeSlack: null, critical: false,
      status: 'planned', collapsed: false, manual: true, custom: {}
    };
    project.tasks.splice(insertAt, 0, task);
    reschedule(project);
    return task;
  }
  function duplicateTask(project, taskId) {
    const src = getTask(project, taskId);
    if (!src) return null;
    const subtree = subtreeTasks(project, taskId);
    const idMap = new Map();
    const clones = subtree.map((t) => {
      const id = U.uid(); idMap.set(t.id, id);
      const c = clone(t); c.id = id;
      c.name = t.id === taskId ? t.name + ' (copy)' : t.name;
      c.critical = false;
      return c;
    });
    clones.forEach((c) => { if (c.parentId && idMap.has(c.parentId)) c.parentId = idMap.get(c.parentId); });
    if (src.parentId && !idMap.has(src.parentId)) clones[0].parentId = src.parentId;
    const insertAt = insertionIndexAfterSubtree(project, taskId);
    project.tasks.splice(insertAt, 0, ...clones);
    reschedule(project);
    return clones[0];
  }
  function deleteTask(project, taskId) {
    const ids = new Set(subtreeIds(project, taskId));
    project.tasks = project.tasks.filter((t) => !ids.has(t.id));
    project.links = project.links.filter((l) => !ids.has(l.from) && !ids.has(l.to));
    reschedule(project);
  }
  function toggleCollapse(project, taskId) {
    const t = getTask(project, taskId);
    if (!t || !hasChildren(project, taskId)) return;
    t.collapsed = !t.collapsed;
  }
  // Move `block` so it sits immediately after the subtree of `anchorId`.
  // The block is taken out of the list first: measuring the insert point on the
  // untouched list over-counts by the block itself (it lives inside the anchor
  // subtree), which used to fling promoted tasks to the bottom of the plan.
  function moveBlockAfter(project, anchorId, block) {
    const blockIds = new Set(block.map((b) => b.id));
    const rest = project.tasks.filter((t) => !blockIds.has(t.id));
    const anchorIds = new Set(subtreeIds(project, anchorId));
    blockIds.forEach((id) => anchorIds.delete(id));
    let at = rest.length;
    rest.forEach((t, i) => { if (anchorIds.has(t.id)) at = i + 1; });
    rest.splice(at, 0, ...block);
    project.tasks = rest;
  }

  function indentTask(project, taskId) {
    const t = getTask(project, taskId);
    if (!t) return false;
    const siblings = childrenOf(project, t.parentId);
    const idx = siblings.findIndex((x) => x.id === taskId);
    if (idx <= 0) return false;
    const prev = siblings[idx - 1];
    const block = subtreeTasks(project, taskId);
    t.parentId = prev.id;
    moveBlockAfter(project, prev.id, block);
    reschedule(project);
    return true;
  }
  function outdentTask(project, taskId) {
    const t = getTask(project, taskId);
    if (!t || !t.parentId) return false;
    const parent = getTask(project, t.parentId);
    if (!parent) return false;
    const block = subtreeTasks(project, taskId);
    t.parentId = parent.parentId || null;
    moveBlockAfter(project, parent.id, block);
    reschedule(project);
    return true;
  }
  // Swap a task (with its subtree) with its previous/next sibling. Working on
  // the flat array keeps every other row untouched, which is what the outline
  // redraws from: the old version rebuilt the list from filtered blocks and
  // could splice the two blocks back into the same order, reporting success
  // while nothing had moved.
  function moveTask(project, taskId, dir) {
    const t = getTask(project, taskId);
    if (!t) return false;
    const siblings = childrenOf(project, t.parentId);
    const idx = siblings.findIndex((x) => x.id === taskId);
    const otherIdx = idx + dir;
    if (otherIdx < 0 || otherIdx >= siblings.length) return false;
    const other = siblings[otherIdx];

    const mine = subtreeTasks(project, t.id).map((x) => x.id);
    const theirs = subtreeTasks(project, other.id).map((x) => x.id);
    const mineSet = new Set(mine);
    const theirsSet = new Set(theirs);

    // Locate both blocks in document order, then rewrite the slice they span.
    let lo = -1, hi = -1;
    project.tasks.forEach((x, i) => {
      if (mineSet.has(x.id) || theirsSet.has(x.id)) {
        if (lo < 0) lo = i;
        hi = i;
      }
    });
    if (lo < 0) return false;

    const byId = new Map(project.tasks.map((x) => [x.id, x]));
    const first = dir > 0 ? theirs : mine;
    const second = dir > 0 ? mine : theirs;
    const replacement = first.concat(second).map((id) => byId.get(id)).filter(Boolean);
    if (!replacement.length) return false;
    project.tasks.splice(lo, hi - lo + 1, ...replacement);
    reschedule(project);
    return true;
  }
  // ---------- links ----------
  function addLink(project, fromId, toId, type = 'FS', lag = 0) {
    if (!fromId || !toId || fromId === toId) return null;
    if (!getTask(project, fromId) || !getTask(project, toId)) return null;
    if (project.links.some((l) => l.from === fromId && l.to === toId)) return null;
    if (createsCycle(project, fromId, toId)) return null;
    const link = { id: U.uid(), from: fromId, to: toId, type, lag: Number(lag) || 0, lagUnit: 'd' };
    project.links.push(link);
    const succ = getTask(project, toId); if (succ) succ.manual = false;
    reschedule(project);
    return link;
  }
  function createsCycle(project, fromId, toId) {
    const seen = new Set();
    const walk = (id) => {
      if (id === fromId) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return project.links.filter((l) => l.from === id).some((l) => walk(l.to));
    };
    return walk(toId);
  }
  function removeLink(project, linkId) {
    project.links = project.links.filter((l) => l.id !== linkId);
    reschedule(project);
  }
  function predecessors(project, taskId) {
    return project.links.filter((l) => l.to === taskId).map((l) => ({ link: l, task: getTask(project, l.from) })).filter((x) => x.task);
  }
  function linkTypeLabel(t) { return ({ FS: 'Finish → Start', SS: 'Start → Start', FF: 'Finish → Finish', SF: 'Start → Finish' })[t] || t; }

  function captureBaseline(project) {
    project.tasks.filter((t) => !hasChildren(project, t.id)).forEach((t) => {
      t.baselineStart = t.start;
      t.baselineEnd = t.end;
      t.baselineCost = t.estimatedCost != null ? t.estimatedCost : (t.cost != null ? t.cost : resourceCost(project, t));
    });
    project.baselineBudget = project.estimatedBudget != null ? Number(project.estimatedBudget) : stats(project).estimated;
    reschedule(project);
  }

  function moveTaskRelative(project, taskId, targetId, after) {
    const task = getTask(project, taskId);
    const target = getTask(project, targetId);
    if (!task || !target || taskId === targetId) return false;
    if (descendantIds(project, taskId).includes(targetId)) return false;
    const block = subtreeTasks(project, taskId);
    const blockIds = new Set(block.map((x) => x.id));
    const rest = project.tasks.filter((x) => !blockIds.has(x.id));
    const targetIds = new Set(subtreeTasks(project, targetId).map((x) => x.id));
    let at;
    if (after) {
      at = rest.reduce((last, x, i) => (targetIds.has(x.id) ? i : last), -1) + 1;
    } else {
      at = rest.findIndex((x) => x.id === targetId);
    }
    if (at < 0) at = rest.length;
    task.parentId = target.parentId || null;
    rest.splice(Math.min(at, rest.length), 0, ...block);
    project.tasks = rest;
    reschedule(project);
    return true;
  }

  function moveTaskToParent(project, taskId, parentId) {
    const t = getTask(project, taskId);
    if (!t || taskId === parentId) return false;
    if (parentId && (parentId === taskId || descendantIds(project, taskId).includes(parentId))) return false;
    t.parentId = parentId || null;
    const block = subtreeTasks(project, taskId);
    project.tasks = project.tasks.filter((x) => !block.some((b) => b.id === x.id));
    const insertAt = parentId ? insertionIndexAfterSubtree(project, parentId) : project.tasks.length;
    project.tasks.splice(Math.min(insertAt, project.tasks.length), 0, ...block);
    reschedule(project);
    return true;
  }

  // ---------- batch outline operations ----------
  // A selection can contain a parent and its children. Only the outermost rows
  // act, because a child already travels with its parent; moving it again would
  // pull it out of the block the user selected.
  function outlineRoots(project, ids) {
    const set = new Set(ids || []);
    return project.tasks.filter((t) => set.has(t.id)).filter((t) => {
      let parentId = t.parentId;
      while (parentId) {
        if (set.has(parentId)) return false;
        const parent = getTask(project, parentId);
        parentId = parent ? parent.parentId : null;
      }
      return true;
    });
  }

  // The selected rows move together under the sibling above the first one,
  // which keeps a run of selected rows as siblings instead of nesting them.
  // Rows from different parents fall back to indenting one by one.
  function batchIndent(project, ids) {
    const roots = outlineRoots(project, ids);
    if (!roots.length) return false;
    if (roots.length === 1) return indentTask(project, roots[0].id);
    const parentId = roots[0].parentId || null;
    if (!roots.every((t) => (t.parentId || null) === parentId)) {
      let moved = false;
      roots.forEach((t) => { if (indentTask(project, t.id)) moved = true; });
      return moved;
    }
    const siblings = childrenOf(project, parentId);
    const idx = siblings.findIndex((x) => x.id === roots[0].id);
    if (idx <= 0) return false;
    const anchor = siblings[idx - 1];
    const block = roots.reduce((acc, t) => acc.concat(subtreeTasks(project, t.id)), []);
    roots.forEach((t) => { t.parentId = anchor.id; });
    moveBlockAfter(project, anchor.id, block);
    reschedule(project);
    return true;
  }

  // Mirror of batchIndent: the whole run steps up to the grandparent and sits
  // after the parent's subtree, so its internal order is untouched.
  function batchOutdent(project, ids) {
    const roots = outlineRoots(project, ids);
    if (!roots.length) return false;
    if (roots.length === 1) return outdentTask(project, roots[0].id);
    const parents = new Set(roots.map((t) => t.parentId || null));
    if (parents.size !== 1 || parents.has(null)) {
      let moved = false;
      roots.forEach((t) => { if (outdentTask(project, t.id)) moved = true; });
      return moved;
    }
    const parent = getTask(project, roots[0].parentId);
    if (!parent) return false;
    const block = roots.reduce((acc, t) => acc.concat(subtreeTasks(project, t.id)), []);
    roots.forEach((t) => { t.parentId = parent.parentId || null; });
    moveBlockAfter(project, parent.id, block);
    reschedule(project);
    return true;
  }

  // Each selected block takes one sibling step in the same direction. Walking
  // from the edge the selection is heading to makes a contiguous run slide as
  // one unit, and scattered picks simply each move on their own.
  function batchMove(project, ids, dir) {
    const roots = outlineRoots(project, ids);
    if (!roots.length) return false;
    if (roots.length === 1) return moveTask(project, roots[0].id, dir);
    const ordered = dir < 0 ? roots : roots.slice().reverse();
    let moved = false;
    ordered.forEach((t) => { if (moveTask(project, t.id, dir)) moved = true; });
    return moved;
  }

  // User-defined outline columns live on project.customColumns as
  // { id, label, width } entries and are addressed by the "custom.<id>" key.
  function customColumnDefs(project) {
    const list = (project && Array.isArray(project.customColumns)) ? project.customColumns : [];
    return list.filter((c) => c && c.id && c.label).map((c) => ({
      id: c.id,
      key: 'custom.' + c.id,
      label: String(c.label),
      width: Math.max(60, Number(c.width) || 120),
      minWidth: 60,
      custom: true,
      customId: c.id
    }));
  }

  function columnDefs(project) {
    return COLUMNS.concat(customColumnDefs(project));
  }

  // Budgets and costs are opt-in: the app switch is off by default and each
  // project can override it from Project settings.
  function costVisible(project) {
    if (project && project.view && typeof project.view.showCosts === 'boolean') return project.view.showCosts;
    // Store is a top-level const, so it is not a window property.
    const s = (typeof Store !== 'undefined' && Store && Store.settings) ? Store.settings() : null;
    return !!(s && s.showCosts);
  }

  // Per-resource load inside one project, used by the dashboard people panel.
  function peopleStats(project) {
    const today = U.todayISO();
    const map = new Map();
    flatten(project, { includeCollapsed: true }).forEach((row) => {
      if (row.hasChildren) return;
      const t = row.task;
      (t.resources || []).forEach((a) => {
        const res = (project.resources || []).find((x) => x.id === a.resourceId);
        if (!res) return;
        let rec = map.get(res.id);
        if (!rec) {
          rec = { id: res.id, name: res.name || 'Unassigned', role: res.role || '', tasks: 0, done: 0, active: 0, late: 0, percent: 0, hours: 0, next: '' };
          map.set(res.id, rec);
        }
        const pct = U.clamp(Number(t.percentComplete) || 0, 0, 100);
        rec.tasks += 1;
        rec.percent += pct;
        if (t.status === 'done' || pct >= 100) rec.done += 1;
        else if (t.start && U.diffDays(t.start, today) >= 0 && U.diffDays(today, t.end || t.start) >= 0) rec.active += 1;
        if (t.status === 'late') rec.late += 1;
        const units = a.units == null ? 100 : Number(a.units);
        rec.hours += durationDays(project, t) * (Number(project.hoursPerDay) || 8) * units / 100;
        if (!rec.next && t.end && U.diffDays(today, t.end) >= 0) rec.next = t.end;
      });
    });
    return [...map.values()].map((rec) => Object.assign({}, rec, {
      completion: rec.tasks ? U.round(rec.percent / rec.tasks) : 0
    })).sort((a, b) => b.tasks - a.tasks || String(a.name).localeCompare(String(b.name)));
  }

  function visibleColumns(project) {
    const hidden = new Set(project.view.hiddenColumns || []);
    const showCost = costVisible(project);
    let cols = columnDefs(project).filter((c) => {
      if (c.always) return true;
      if (hidden.has(c.key)) return false;
      if (!showCost && COST_COLUMNS.indexOf(c.key) >= 0) return false;
      return true;
    });
    const order = project.view.columnOrder || [];
    if (order.length) {
      cols.sort((a, b) => {
        const ia = order.indexOf(a.key), ib = order.indexOf(b.key);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    }
    return cols;
  }

  return {
    COLUMNS, DEFAULT_HIDDEN, PRIORITIES, THEMES,
    clone, blankProject, normalizeProject, normalizeCalendar, makeCalendar, defaultView,
    resolveLinkProject, calendarFor, normalizeLinks, childrenOf, hasChildren, descendantIds, subtreeIds, subtreeTasks, getTask, flatten,
    durationDays, setDurationFromDays, reschedule, stats, statsWithReferences, resourceCost, timelineRange,
    addTask, duplicateTask, deleteTask, toggleCollapse, indentTask, outdentTask, moveTask, moveTaskRelative, moveTaskToParent,
    batchIndent, batchOutdent, batchMove,
    addLink, removeLink, createsCycle, predecessors, linkTypeLabel, captureBaseline,
    visibleColumns, columnDefs, customColumnDefs, costVisible, peopleStats, COST_COLUMNS,
    themeOf, alphaOn, paletteOf, paletteFromTheme, priorityFromTheme, mixHex, PALETTE_KEYS, BAR_STYLES, tabLabel,
    statusFor, isOverdue
  };
})();
