'use strict';

/* Outline grid + timeline renderer and direct-manipulation interactions. */
const Gantt = (() => {
  const ROW_H = 24;
  // Bar geometry inside one row. A row is --row-h tall *including* its 1px
  // separator, so 23px are actually free. Every value here is a whole number:
  // with a fractional gap the browser rounded the two sides of a row in
  // opposite directions and the rails ended up 1px apart on one side only.
  // 23 = 2 + 3 + 1 + 11 + 1 + 3 + 2, so the three tracks sit 1px apart with
  // matching breathing room at the top and bottom of the row.
  const BAR_H = 11;
  const RAIL_H = 3;
  const TRACK_H = ROW_H - 1;
  const BAR_GAP = 1;
  const BASELINE_TOP = (TRACK_H - BAR_H - RAIL_H * 2 - BAR_GAP * 2) / 2;
  const PLAN_TOP = BASELINE_TOP + RAIL_H + BAR_GAP;
  const ACTUAL_TOP = PLAN_TOP + BAR_H + BAR_GAP;
  const ZOOM_BASE = { hour: 576, day: 28, week: 10, month: 3.5, quarter: 1.25, halfYear: 0.625, year: 0.3125 };
  // One floor and one ceiling for every way of changing the scale: the wheel,
  // the typed percentage and the presets all clamp to these.
  const MIN_PLAN_ZOOM = 50;
  const MAX_PLAN_ZOOM = 220;
  const STATUS_LABEL = { done: 'Done', underway: 'Under way', planned: 'Planned', late: 'Late' };
  const ZOOM_LABEL = { hour: 'Hour', day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', halfYear: 'Half year', year: 'Year' };
  // Dates, durations, percentages and resource names read best centred.
  const CENTER_COLUMNS = new Set(['start', 'end', 'duration', 'progress', 'resources']);
  // A printed plan always carries these seven columns, whether or not they are
  // hidden on screen, with widths that suit A3 landscape.
  const PRINT_COLUMNS = ['wbs', 'name', 'start', 'end', 'duration', 'progress', 'resources'];
  const PRINT_WIDTHS = { wbs: 42, name: 240, start: 88, end: 88, duration: 84, progress: 140, resources: 130 };

  let search = '';
  let filter = 'all';
  // Empty string = no resource filter. Combined with `filter` / `search` as AND.
  let resourceFilter = '';
  let lastSelected = null;
  let bound = false;
  let syncing = false;
  let suppressClickUntil = 0;
  let currentCell = null;
  let editing = null;
  let boundOutside = false;
  let dragGhost = null;
  let activeBarId = null;

  const $ = (id) => document.getElementById(id);

  function norm(s) { return String(s == null ? '' : s).toLowerCase(); }

  function selectionSet() { return new Set(Store.selection()); }

  // A referenced project is shown as one phase whose children are its tasks.
  // The phase is synthetic (it has no task of its own in this project), so it
  // carries the source id and the rows know where they really live.
  function linkedBlock(link) {
    const entry = Model.resolveLinkProject(link, Store.allProjects());
    return entry || null;
  }

  function linkedPhase(entry, link, wbs) {
    const stats = Model.stats(entry.project);
    // A referenced block identifies itself by project number first, then name.
    const no = String(entry.project.tabName || '').trim();
    const name = String(entry.project.name || '').trim() || 'project';
    const title = no && no !== name ? no + ' \u2022 ' + name : name;
    // A link saved before ids existed still has to behave: key it by project.
    const linkId = link.id || ('p-' + link.projectId);
    // The phase is a real row in the grid, so its WBS and duration must agree
    // with the dates it spans instead of showing an empty number and "0d".
    const cal = Model.calendarFor(entry.project, null);
    const span = (stats.first && stats.last) ? U.workingDaysBetween(stats.first, stats.last, cal) : 0;
    return {
      task: {
        id: 'link:' + linkId,
        name: title,
        type: 'task',
        start: stats.first,
        end: stats.last,
        duration: span,
        durationUnit: 'd',
        percentComplete: stats.percent,
        parentId: null,
        resources: [],
        linked: true,
        summary: true,
        sourceProject: entry.id
      },
      level: 0,
      wbs: wbs || '',
      hasChildren: true,
      collapsed: !!link.collapsed,
      linked: true,
      linkId: linkId,
      entry: entry
    };
  }

  function linkedRows(link, index, filtering) {
    const entry = linkedBlock(link);
    if (!entry) return [];
    // Keep the fallback identity stable and shared with linkedPhase.
    if (!link.id) link.id = 'p-' + link.projectId;
    const prefix = String(index || 1);
    // The source project's own outline, presented under the phase. With a
    // search or filter active, the same rules apply as to this plan's own rows;
    // the phase itself stays as the heading of whatever matched.
    const filtered = filtering ? Model.flatten(entry.project, { includeCollapsed: true }).filter((r) => matches(entry.project, r.task)) : null;
    const inner = (filtered || Model.flatten(entry.project)).map((r) => {
      // Task ids are only unique inside one project, so a referenced row is
      // keyed by "<project>|<task>" — that keeps it distinct from a task with
      // the same id in another plan, in this plan, or shown twice.
      const copy = Object.assign({}, r, {
        level: r.level + 1,
        linked: true,
        sourceProject: entry.id,
        entry: entry
      });
      copy.wbs = prefix + '.' + r.wbs;
      copy.task = Object.assign({}, r.task, {
        id: entry.id + '|' + r.task.id,
        realId: r.task.id,
        linked: true,
        sourceProject: entry.id
      });
      return copy;
    });
    const phase = linkedPhase(entry, link, prefix);
    if (filtering && !inner.length) return [];
    return [phase].concat(link.collapsed ? [] : inner);
  }

  function rowsFor(project) {
    const all = Model.flatten(project, { includeCollapsed: true });
    const normal = Model.flatten(project);
    if (!search && filter === 'all' && !resourceFilter) return withLinked(project, normal);
    const keep = new Set();
    all.forEach((r) => {
      if (matches(project, r.task)) {
        keep.add(r.task.id);
        let pid = r.task.parentId;
        let guard = 0;
        while (pid && guard++ < 100) {
          keep.add(pid);
          const parent = Model.getTask(project, pid);
          pid = parent ? parent.parentId : null;
        }
      }
    });
    return withLinked(project, all.filter((r) => keep.has(r.task.id)), true);
  }

  // Referenced projects come after this plan's own rows, each as a phase.
  function withLinked(project, rows, filtering) {
    const links = project.linkedProjects || [];
    if (!links.length) return rows;
    let out = rows.slice();
    // Referenced phases continue this plan's own top-level numbering, so the
    // WBS column reads 1, 2, 3 … across both plans without repeating a number.
    let next = rows.filter((r) => !r.task.parentId).length + 1;
    links.forEach((link) => {
      out = out.concat(linkedRows(link, next, filtering));
      next += 1;
    });
    return out;
  }

  // Which project actually owns a row. A referenced row is edited right here,
  // in place, exactly like a local one; the write is forwarded to the plan that
  // owns the task, so both views keep showing the same value.
  function ownerOf(project, task) {
    if (task && task.linked) {
      const entry = Store.allProjects().find((p) => p.id === task.sourceProject);
      return entry ? entry.project : null;
    }
    return project;
  }

  function matches(project, task) {
    if (search) {
      const q = norm(search);
      if (!(norm(task.name).includes(q) || norm(task.notes).includes(q))) return false;
    }
    // The filter is keyed by the resource NAME, not an id: a roster is local to
    // its project, so the same person in a referenced plan has a different id.
    // Looking names up through the owning plan makes the filter cover both the
    // open project's rows and every referenced block.
    if (resourceFilter) {
      const hit = resourceNames(project, task).some((name) => norm(String(name).trim()) === resourceFilter);
      if (!hit) return false;
    }
    const pct = Number(task.percentComplete) || 0;
    switch (filter) {
      case 'incomplete': return pct < 100;
      case 'complete': return pct >= 100;
      case 'milestones': return task.type === 'milestone';
      case 'critical': return !!task.critical;
      case 'late':
        return task.status === 'late' ||
          (task.end && U.diffDays(task.end, U.todayISO()) > 0 && pct < 100);
      default: return true;
    }
  }

  function highlight(text) {
    const safe = U.escapeHtml(text);
    if (!search) return safe;
    const q = U.escapeHtml(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { return safe.replace(new RegExp('(' + q + ')', 'ig'), '<mark>$1</mark>'); }
    catch (e) { return safe; }
  }

  function columnsFor(project) {
    const cols = Model.visibleColumns(project);
    const widths = cols.map((c) => {
      const stored = project.view.gridColumnWidths && project.view.gridColumnWidths[c.key];
      return Math.max(c.minWidth || 40, Number(stored) || c.width);
    });
    const total = widths.reduce((a, b) => a + b, 0);
    return { cols, widths, total, template: widths.map((w) => w + 'px').join(' ') };
  }

  // Outline for the printed / exported plan. It is built from the model rather
  // than cloned from the screen so the seven columns are always present, even
  // when the user has hidden one of them, and the referenced blocks come along.
  function printOutline(project) {
    const defs = new Map(Model.columnDefs(project).map((d) => [d.key, d]));
    const cols = PRINT_COLUMNS.map((key) => {
      const d = defs.get(key) || { key, label: key };
      return { key, label: d.label || key, width: PRINT_WIDTHS[key] || d.width || 80 };
    });
    const widths = cols.map((c) => c.width);
    const total = widths.reduce((a, b) => a + b, 0);
    const template = widths.map((w) => w + 'px').join(' ');
    const rows = rowsFor(project);
    const head = '<div class="task-head-row" style="width:' + total + 'px;grid-template-columns:' + template + '">' +
      cols.map((c) => '<div class="task-head-cell' + (CENTER_COLUMNS.has(c.key) ? ' center' : '') +
        '" data-col-key="' + c.key + '"><span>' + U.escapeHtml(String(c.label).toUpperCase()) + '</span></div>').join('') +
      '</div>';
    const body = rows.map((row) => {
      const t = row.task;
      const cls = 'task-row' + (row.linked ? ' linked' : '') + (row.hasChildren ? ' summary' : '') +
        (row.collapsed ? ' collapsed' : '');
      return '<div class="' + cls + '" data-task-id="' + U.escapeHtml(t.id) + '" style="width:' + total +
        'px;grid-template-columns:' + template + '">' +
        cols.map((c) => cellHtml(c, t, row, project)).join('') + '</div>';
    }).join('');
    return { cols, total, template, head, rows: body, count: rows.length, rowsData: rows };
  }

  // A ruler for the printed chart. The granularity is chosen from the pixels a
  // day gets: a compressed overview shows months/quarters instead of overlapping
  // day numbers.
  function printRuler(project, m) {
    const endEx = m.endIso;
    const cal = Model.calendarFor(project, null);
    let top, bottom;
    if (m.px >= 10) {
      top = monthSegments(m.range.start, endEx, m.px);
      bottom = daySegments(m.range.start, endEx, m.px, cal);
    } else if (m.px >= 2) {
      top = yearSegments(m.range.start, endEx, m.px);
      bottom = monthSegments(m.range.start, endEx, m.px, true);
    } else if (m.px >= 0.6) {
      top = yearSegments(m.range.start, endEx, m.px);
      bottom = quarterSegments(m.range.start, endEx, m.px);
    } else {
      top = yearSegments(m.range.start, endEx, m.px);
      bottom = halfSegments(m.range.start, endEx, m.px, true);
    }
    return '<div class="th-band th-top">' + top + '</div><div class="th-band th-bottom">' + bottom + '</div>';
  }

  // Render a complete timeline at an exact width. Export uses this instead of
  // cloning the on-screen canvas: the printed chart can therefore be narrower
  // than the working pane while still showing the whole plan — no blank months
  // stretching to the right and no horizontal page tiles.
  function printTimeline(project, width) {
    const rows = rowsFor(project);
    const starts = rows.map((r) => r.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const ends = rows.map((r) => r.task.end || r.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    if (!starts.length) return null;
    const first = starts[0];
    const last = ends[ends.length - 1];
    const from = U.addDays(first, -2);
    const to = U.addDays(last, 2);
    const days = Math.max(1, U.diffDays(from, to) + 1);
    const w = Math.max(120, Math.round(width));
    const px = w / days;
    const m = {
      zoom: 'day', scale: 1, px,
      range: { start: from, end: to, days },
      width: w,
      endIso: U.addDays(to, 1)
    };
    const height = Math.max(ROW_H, rows.length * ROW_H);
    const rowHtml = rows.map((row, i) => '<div class="tl-row' + (row.hasChildren ? ' summary' : '') +
      (row.linked ? ' linked' : '') +
      '" style="top:' + (i * ROW_H) + 'px" data-task-id="' + U.escapeHtml(row.task.id) + '"></div>').join('');
    const canvas = '<div class="timeline-canvas" style="width:' + w + 'px;height:' + height + 'px">' +
      backgroundBody(project, m, m.endIso) +
      '<div class="tl-rows" style="height:' + height + 'px">' + rowHtml + '</div>' +
      linksHtml(project, rows, m, height) +
      barsHtml(project, rows, m, new Set()) +
      '</div>';
    const head = '<div class="timeline-head' + (px < 14 ? ' dense' : '') + '" style="width:' + w + 'px">' +
      printRuler(project, m) + '</div>';
    return { head, canvas, width: w, height, px, first, last };
  }

  function projectMoney(project, task) {
    if (task.cost != null) return Number(task.cost);
    if (task.estimatedCost != null) return Number(task.estimatedCost);
    const rc = Model.resourceCost(project, task);
    return rc ? rc : null;
  }

  // Owners of a task. A referenced row belongs to another plan, whose roster is
  // what its assignments point at — looking them up in the open project finds
  // nothing and leaves the cell empty.
  function ownerProjectFor(task) {
    if (!task || !task.linked || !task.sourceProject) return null;
    const entry = Store.allProjects().find((p) => p.id === task.sourceProject);
    return entry ? entry.project : null;
  }

  function resourceNames(project, task) {
    const roster = ownerProjectFor(task) || project;
    const list = (roster.resources || []).concat(project.resources || []);
    return (task.resources || []).map((a) => {
      const r = list.find((x) => x.id === a.resourceId);
      return r ? r.name : null;
    }).filter(Boolean);
  }

  function lateDays(project, task) {
    const base = task.baselineEnd;
    const actual = task.actualEnd || task.end;
    if (!base || !actual) return 0;
    const d = U.diffDays(base, actual);
    return d > 0 ? d : 0;
  }

  function workHours(project, task) {
    return U.round(Model.durationDays(project, task) * (Number(project.hoursPerDay) || 8), 1);
  }

  function cellHtml(col, task, row, project) {
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const pct = Math.round(Number(task.percentComplete) || 0);
    const summary = row.hasChildren;
    switch (col.key) {
      case 'wbs':
        return '<div class="cell left muted">' + U.escapeHtml(row.wbs) + '</div>';
      case 'name': {
        const pad = 6 + row.level * 14;
        const twisty = row.hasChildren
          ? '<span class="twisty" data-twisty="' + task.id + '">' + U.icon('chevron') + '</span>'
          : '<span style="width:14px;flex:0 0 auto"></span>';
        const typeIcon = task.type === 'milestone'
          ? '<span class="diamond" title="Milestone"></span>'
          : (summary ? '<span class="bar-chip" title="Summary task"></span>' : '');
        const note = task.notes ? '<span class="note-dot" title="' + U.escapeHtml(task.notes) + '"></span>' : '';
        // Referenced tasks are staffed from their own plan's roster.
        const rosterFor = ownerProjectFor(task) || project;
        const avatarPool = (rosterFor.resources || []).concat(project.resources || []);
        const avatars = '<span class="res-avatars">' + (task.resources || []).slice(0, 3).map((a) => {
          const r = avatarPool.find((x) => x.id === a.resourceId);
          if (!r) return '';
          return '<i title="' + U.escapeHtml(r.name) + '" style="background:' + (r.colour || '#d7e4f3') + '22;color:' + (r.colour || '#3b5a7f') + '">' +
            U.escapeHtml(String(r.name || '?').trim().charAt(0)) + '</i>';
        }).join('') + '</span>';
        const refHint = row.linked && row.entry
          ? ' title="' + U.escapeHtml(task.name + ' \u00b7 ' + row.entry.project.name +
            ' \u2014 edit here, the change is saved in that plan') + '"'
          : ' title="' + U.escapeHtml(task.name) + '"';
        return '<div class="cell name" style="padding-left:' + pad + 'px"' + refHint + '>' +
          twisty + typeIcon + '<span class="task-name">' + highlight(task.name) + '</span>' + note + avatars + '</div>';
      }
      case 'start': return '<div class="cell num center">' + U.fmtDate(task.start, fmt) + '</div>';
      case 'end': return '<div class="cell num center">' + U.fmtDate(task.end || task.start, fmt) + '</div>';
      case 'duration':
        if (task.type === 'milestone') return '<div class="cell center muted">Milestone</div>';
        return '<div class="cell num center">' + U.formatDuration(Model.durationDays(project, task), project.hoursPerDay, task) + '</div>';
      case 'progress': {
        // Match the timeline bar so the outline and the chart read as one.
        const track = barTint(project, task, summary);
        return '<div class="cell num center" title="' + pct + '% complete">' +
          '<span class="pbar"><i style="width:' + pct + '%;background:' + track + '"></i></span>' +
          '<span class="pval">' + pct + '%</span></div>';
      }
      case 'resources': {
        const names = resourceNames(project, task);
        return '<div class="cell muted center" title="' + U.escapeHtml(names.join(', ')) + '">' + U.escapeHtml(names.join(', ') || '—') + '</div>';
      }
      case 'cost': {
        const money = projectMoney(project, task);
        return '<div class="cell num">' + (money == null ? '—' : U.formatMoney(money, project)) + '</div>';
      }
      case 'priority': {
        const pr = Model.PRIORITIES.find((x) => x.id === task.priority) || Model.PRIORITIES[1];
        return '<div class="cell"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:' +
          pr.colour + ';margin-right:5px;vertical-align:middle"></span>' + U.escapeHtml(pr.label) + '</div>';
      }
      case 'status': {
        const label = STATUS_LABEL[task.status] || STATUS_LABEL.planned;
        return '<div class="cell">' + U.escapeHtml(label) + '</div>';
      }
      case 'baselineStart': return '<div class="cell num">' + U.fmtDate(task.baselineStart, fmt) + '</div>';
      case 'baselineEnd': return '<div class="cell num">' + U.fmtDate(task.baselineEnd, fmt) + '</div>';
      case 'actualStart': return '<div class="cell num">' + U.fmtDate(task.actualStart, fmt) + '</div>';
      case 'actualEnd': return '<div class="cell num">' + U.fmtDate(task.actualEnd, fmt) + '</div>';
      case 'daysLate': {
        const d = lateDays(project, task);
        return '<div class="cell num' + (d > 0 ? ' danger-text' : '') + '">' + (d > 0 ? d + 'd' : '—') + '</div>';
      }
      case 'work': return '<div class="cell num">' + (summary ? '—' : workHours(project, task) + 'h') + '</div>';
      case 'estimatedCost': return '<div class="cell num">' + (task.estimatedCost == null ? '—' : U.formatMoney(task.estimatedCost, project)) + '</div>';
      case 'actualCost': return '<div class="cell num">' + (task.actualCost == null ? '—' : U.formatMoney(task.actualCost, project)) + '</div>';
      case 'lateStart': return '<div class="cell num">' + U.fmtDate(task.lateStart, fmt) + '</div>';
      case 'lateFinish': return '<div class="cell num">' + U.fmtDate(task.lateFinish, fmt) + '</div>';
      case 'totalFloat': return '<div class="cell num">' + (task.totalFloat == null ? '—' : task.totalFloat + 'd') + '</div>';
      case 'freeSlack': return '<div class="cell num">' + (task.freeSlack == null ? '—' : task.freeSlack + 'd') + '</div>';
      case 'critical': return '<div class="cell center">' + (task.critical ? 'Yes' : '—') + '</div>';
      case 'notes':
        return '<div class="cell muted" title="' + U.escapeHtml(task.notes) + '">' + U.escapeHtml(task.notes || '—') + '</div>';
      case 'baselineDurationMinutes': {
        if (!task.baselineStart || !task.baselineEnd) return '<div class="cell num muted">—</div>';
        const cal = Model.calendarFor(project, task);
        const days = U.workingDaysBetween(task.baselineStart, task.baselineEnd, cal);
        return '<div class="cell num">' + Math.round(days * (project.hoursPerDay || 8) * 60) + 'm</div>';
      }
      default: {
        if (col.key.indexOf('custom.') === 0) {
          const key = col.key.slice(7);
          return '<div class="cell">' + U.escapeHtml(task.custom && task.custom[key] != null ? task.custom[key] : '—') + '</div>';
        }
        return '<div class="cell"></div>';
      }
    }
  }

  // ---------- inline cell editing ----------
  function isEditableKey(project, task, key) {
    if (!task || !key) return false;
    const computed = ['wbs', 'status', 'work', 'daysLate', 'lateStart', 'lateFinish',
      'totalFloat', 'freeSlack', 'critical', 'baselineDurationMinutes'];
    if (computed.includes(key)) return false;
    if (Model.hasChildren(project, task.id)) return key === 'name' || key === 'notes' || key === 'priority';
    if (task.type === 'milestone') {
      return ['name', 'notes', 'priority', 'start', 'progress', 'resources', 'estimatedCost', 'actualCost',
        'actualStart', 'actualEnd', 'baselineStart', 'baselineEnd'].includes(key) || key.indexOf('custom.') === 0;
    }
    return ['name', 'notes', 'priority', 'start', 'end', 'duration', 'progress', 'resources',
      'cost', 'estimatedCost', 'actualCost', 'actualStart', 'actualEnd',
      'baselineStart', 'baselineEnd'].includes(key) || key.indexOf('custom.') === 0;
  }

  function rawDuration(task) {
    return U.round(task.duration == null ? 0 : task.duration, 2) + (task.durationUnit || 'd');
  }

  // U.addWorkingDays counts the starting day, so negative offsets need -1.
  function shiftWorkdays(iso, delta, cal) {
    if (!iso || !delta) return iso;
    return U.addWorkingDays(iso, delta > 0 ? delta : delta - 1, cal);
  }

  function cellFor(taskId, key) {
    return document.querySelector('#taskRows .task-row[data-task-id="' + taskId +
      '"] .cell[data-col-key="' + key + '"]');
  }

  function applyCellFocus() {
    const box = $('taskRows');
    if (!box) return;
    box.querySelectorAll('.cell.focus').forEach((c) => c.classList.remove('focus'));
    if (!currentCell) return;
    const cell = cellFor(currentCell.taskId, currentCell.key);
    if (cell) cell.classList.add('focus');
  }

  function addRowHtml(total) {
    return '<div class="add-row" data-add-row="1" style="width:' + total + 'px">' +
      U.icon('plus') +
      '<input class="add-input" id="quickAdd" type="text" placeholder="Type here to add a task…" autocomplete="off" spellcheck="false">' +
      '<span class="add-hint">Enter to add \u00b7 / to insert a project</span></div>';
  }

  function cancelEdit() {
    if (!editing) return;
    const state = editing;
    editing = null;
    state.done = true;
    // Force the row rebuild: the incremental path would keep the input mounted.
    invalidate();
    render();
    applyCellFocus();
    const grid = $('taskRows');
    if (grid) grid.focus({ preventScroll: true });
  }

  function commitEdit(move) {
    const state = editing;
    if (!state) return;
    const tab = Store.active();
    if (!tab) { editing = null; return; }
    const project = tab.project;
    let task = Model.getTask(project, state.taskId);
    // A referenced task is not in this project: it is edited in its own plan,
    // so the value is written back there and both views stay identical.
    const owner = task ? project : ownerProjectOfRow(state.taskId);
    const effective = task ? project : owner;
    const realId = realTaskId(state.taskId);
    if (owner) task = Model.getTask(owner, realId);
    if (!task) { editing = null; state.done = true; invalidate(); render(); return; }
    const key = state.key;
    const raw = String(state.editor.value == null ? '' : state.editor.value);
    let iso = null;
    let num = null;
    let parsed = null;
    // Every rejection below returns false, so the caller can drop the editor
    // instead of leaving a cell stuck in edit mode.
    // A refusal ends the edit. Leaving the input mounted made the cell look
    // "stuck": the value was rejected, nothing said so, and the next click
    // started a second editor on top of it.
    if (key === 'name' && !raw.trim()) return refuseEdit('Task name cannot be empty');
    if (['start', 'end', 'actualStart', 'actualEnd', 'baselineStart', 'baselineEnd'].includes(key)) {
      if (!(raw.trim() === '' && (key.indexOf('actual') === 0 || key.indexOf('baseline') === 0))) {
        iso = U.parseLooseDate(raw, null);
        if (!iso) return refuseEdit('Enter a valid date');
        if (key === 'end' && U.diffDays(task.start, iso) < 0) {
          return refuseEdit('Finish must be on or after start');
        }
      }
    }
    if (key === 'duration') {
      if (!/^\s*-?\d+(?:\.\d+)?\s*(?:h|d|w)?\s*$/i.test(raw)) {
        return refuseEdit('Use a duration such as 5d, 12h or 1w');
      }
      parsed = U.parseDuration(raw, 'd');
      if (!isFinite(parsed.value) || parsed.value < 0) {
        return refuseEdit('Duration must be zero or more');
      }
    }
    if (key === 'progress') {
      num = Number(raw);
      if (!isFinite(num)) return refuseEdit('Progress must be a number');
      num = U.clamp(num, 0, 100);
    }
    if (['cost', 'estimatedCost', 'actualCost'].includes(key) && raw.trim() !== '') {
      num = Number(raw);
      if (!isFinite(num)) return refuseEdit('Cost must be a number');
      num = Math.max(0, num);
    }
    state.done = true;
    editing = null;
    // A single field edit only needs this cell rebuilt; the render pass sees the
    // pending cell and patches it in place. Everything else (dates, duration)
    // cascades through the schedule, so those fall back to the full pass.
    const cellOnly = ['name', 'notes', 'priority', 'progress', 'cost', 'estimatedCost', 'actualCost']
      .indexOf(key) >= 0 || key.indexOf('custom.') === 0;
    if (cellOnly && effective === project) touchCell(state.taskId, key);
    if (effective !== project) {
      // Write through to the source project, then repaint this plan. An
      // untouched cell is not a change: it must not dirty the source plan nor
      // put a no-op on its undo stack, and it gets no message.
      const target = effective;
      const before = editSignature(Model.getTask(target, realId));
      Store.mutateProject(target.id, (p) => {
        const t = Model.getTask(p, realId);
        if (!t) return;
        applyEdit(p, realId, key, raw, iso, num, parsed);
        if (editSignature(Model.getTask(p, realId)) === before) return;
        Store.saveNow();
      }, { history: true });
      // Writing to another project does not change this plan's structure, so the
      // incremental path would only repaint highlights and leave the editor's
      // input mounted in the cell. Invalidate to force a real row rebuild.
      invalidate();
      render();
      return true;
    }
    Store.mutate((p) => {
      const t = Model.getTask(p, state.taskId);
      if (!t) return;
      switch (key) {
        case 'name': t.name = raw.trim(); break;
        case 'notes': t.notes = raw; break;
        case 'priority': t.priority = raw || 'normal'; break;
        case 'start': t.start = iso; t.manual = true; break;
        case 'end': {
          const cal = Model.calendarFor(p, t);
          Model.setDurationFromDays(p, t, Math.max(1, U.workingDaysBetween(t.start, iso, cal)));
          t.manual = true;
          break;
        }
        case 'duration': {
          if (parsed.unit === 'h') { t.duration = U.round(parsed.value, 2); t.durationUnit = 'h'; }
          else if (parsed.unit === 'w') { t.duration = U.round(parsed.value, 2); t.durationUnit = 'w'; }
          else { t.duration = U.round(parsed.value, 2); t.durationUnit = 'd'; }
          t.manual = true;
          break;
        }
        case 'progress':
          t.percentComplete = num;
          if (num > 0 && !t.actualStart) t.actualStart = t.start;
          if (num >= 100 && !t.actualEnd) t.actualEnd = t.end;
          break;
        case 'actualStart': t.actualStart = raw.trim() === '' ? null : iso; break;
        case 'actualEnd': t.actualEnd = raw.trim() === '' ? null : iso; break;
        case 'baselineStart': t.baselineStart = raw.trim() === '' ? null : iso; break;
        case 'baselineEnd': t.baselineEnd = raw.trim() === '' ? null : iso; break;
        case 'cost':
        case 'estimatedCost':
          t.cost = raw.trim() === '' ? null : num;
          t.estimatedCost = raw.trim() === '' ? null : num;
          break;
        case 'actualCost': t.actualCost = raw.trim() === '' ? null : num; break;
        case 'resources': {
          const names = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
          const list = [];
          names.forEach((name) => {
            let r = p.resources.find((x) => x.name.toLowerCase() === name.toLowerCase());
            if (!r) {
              r = { id: U.uid(), name, role: '', email: '', rate: 0, rateUnit: 'd', colour: '#4d86c9', notes: '' };
              p.resources.push(r);
            }
            if (!list.some((a) => a.resourceId === r.id)) list.push({ resourceId: r.id, units: 100 });
          });
          t.resources = list;
          break;
        }
        default:
          if (key.indexOf('custom.') === 0) {
            const ck = key.slice(7);
            t.custom = t.custom || {};
            if (raw.trim() === '') delete t.custom[ck]; else t.custom[ck] = raw;
          }
      }
    });
    // Enter commits and stops editing. It used to jump to the cell below,
    // which kept a fresh editor open and looked like the edit never finished —
    // especially for Finish, where the new date made the row rebuild too.
    // Tab still walks across cells, the way it does in a spreadsheet.
    if (move === 'next') navigateCell(0, 1);
    else if (move === 'prev') navigateCell(0, -1);
    else {
      applyCellFocus();
      const grid = $('taskRows');
      if (grid) grid.focus({ preventScroll: true });
    }
    return true;
  }

  // Resolve which project a rendered row belongs to (referenced rows carry it).
  // Which project a rendered row really lives in. Only the links of the open
  // project are searched, in order: ids are unique per project, not across all
  // projects, so scanning every project could match the wrong plan entirely.
  function ownerProjectOfRow(taskId) {
    const raw = String(taskId || '');
    const bar = raw.indexOf('|');
    if (bar > 0) {
      const pid = raw.slice(0, bar);
      const entry = Store.allProjects().find((p) => p.id === pid);
      if (entry) return entry.project;
    }
    // The bar itself knows which plan it came from, even when the id alone does
    // not resolve (a filter can hide the link this row belongs to).
    const el = document.querySelector('#taskRows .task-row[data-task-id="' + raw + '"]') ||
      document.querySelector('.tl-bars .gbar[data-task-id="' + raw + '"]');
    const src = el && (el.getAttribute('data-linked') || el.getAttribute('data-project'));
    if (src) {
      const owner = Store.allProjects().find((p) => p.id === src);
      if (owner) return owner.project;
    }
    const tab = Store.active();
    if (!tab) return null;
    const links = Model.normalizeLinks(tab.project.linkedProjects);
    for (let i = 0; i < links.length; i++) {
      const entry = Model.resolveLinkProject(links[i], Store.allProjects());
      if (entry && Model.getTask(entry.project, taskId)) return entry.project;
    }
    return null;
  }

  // The id a row really has inside its own project.
  function realTaskId(taskId) {
    const raw = String(taskId || '');
    const bar = raw.indexOf('|');
    return bar > 0 ? raw.slice(bar + 1) : raw;
  }

  // What a cell edit can touch, as one comparable string. Two identical
  // signatures mean the commit was a no-op.
  function editSignature(task) {
    if (!task) return '';
    return JSON.stringify([task.name, task.start, task.end, task.percentComplete,
      task.duration, task.durationUnit, task.notes, task.priority,
      task.estimatedCost, task.actualCost, task.resources || [], task.custom || {}]);
  }

  // The single place a cell edit is applied to a project's task.
  function applyEdit(p, taskId, key, raw, iso, num, parsed) {
    const t = Model.getTask(p, taskId);
    if (!t) return;
    switch (key) {
      case 'name': t.name = raw.trim(); break;
      case 'notes': t.notes = raw; break;
      case 'priority': t.priority = raw || 'normal'; break;
      case 'start': t.start = iso; t.manual = true; break;
      case 'end': t.end = iso; t.manual = true; break;
      case 'progress':
        t.percentComplete = U.clamp(num, 0, 100);
        if (t.percentComplete > 0 && !t.actualStart) t.actualStart = t.start;
        if (t.percentComplete >= 100 && !t.actualEnd) t.actualEnd = t.end;
        break;
      case 'duration': {
        if (parsed.unit === 'h') { t.duration = U.round(parsed.value, 2); t.durationUnit = 'h'; }
        else if (parsed.unit === 'w') { t.duration = U.round(parsed.value, 2); t.durationUnit = 'w'; }
        else { t.duration = U.round(parsed.value, 2); t.durationUnit = 'd'; }
        t.manual = true;
        break;
      }
      case 'actualStart': t.actualStart = raw.trim() === '' ? null : iso; break;
      case 'actualEnd': t.actualEnd = raw.trim() === '' ? null : iso; break;
      case 'baselineStart': t.baselineStart = raw.trim() === '' ? null : iso; break;
      case 'baselineEnd': t.baselineEnd = raw.trim() === '' ? null : iso; break;
      case 'cost':
      case 'estimatedCost':
        t.cost = raw.trim() === '' ? null : num;
        t.estimatedCost = raw.trim() === '' ? null : num;
        break;
      case 'actualCost': t.actualCost = raw.trim() === '' ? null : num; break;
      case 'resources': {
        // Same rule as a local row: a new name joins the roster of the project
        // that owns the task, never of the plan it is being viewed from.
        const names = raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        const list = [];
        names.forEach((name) => {
          let r = p.resources.find((x) => x.name.toLowerCase() === name.toLowerCase());
          if (!r) {
            r = { id: U.uid(), name, role: '', email: '', rate: 0, rateUnit: 'd', colour: '#4d86c9', notes: '' };
            p.resources.push(r);
          }
          if (!list.some((a) => a.resourceId === r.id)) list.push({ resourceId: r.id, units: 100 });
        });
        t.resources = list;
        break;
      }
      default:
        if (key.indexOf('custom.') === 0) {
          const ck = key.slice(7);
          t.custom = t.custom || {};
          if (raw.trim() === '') delete t.custom[ck]; else t.custom[ck] = raw;
        }
    }
  }

  function beginEdit(taskId, key, cell, seed) {
    if (!cell) return;
    const tab = Store.active();
    if (!tab) return;
    // A referenced row is keyed "<project>|<task>": resolve it against its own
    // project so the cell opens an editor instead of silently doing nothing.
    const owned = Model.getTask(tab.project, taskId) ? null : ownerProjectOfRow(taskId);
    const realId = owned ? realTaskId(taskId) : taskId;
    const project = owned || tab.project;
    const task = Model.getTask(project, realId);
    if (!task) return;
    if (!isEditableKey(project, task, key)) {
      if (!owned) Dialogs.task(realId);
      return;
    }
    if (editing) commitEdit('none');
    currentCell = { taskId, key };
    applyCellFocus();
    cell.classList.add('focus');
    let editor;
    if (key === 'priority') {
      editor = document.createElement('select');
      Model.PRIORITIES.forEach((pr) => {
        const opt = document.createElement('option');
        opt.value = pr.id;
        opt.textContent = pr.label;
        editor.appendChild(opt);
      });
      editor.value = task.priority || 'normal';
    } else {
      editor = document.createElement('input');
      if (['start', 'end', 'actualStart', 'actualEnd', 'baselineStart', 'baselineEnd'].includes(key)) editor.type = 'date';
      else if (key === 'progress') {
        editor.type = 'number'; editor.min = '0'; editor.max = '100'; editor.step = '1';
      } else if (['cost', 'estimatedCost', 'actualCost'].includes(key)) {
        editor.type = 'number'; editor.min = '0'; editor.step = '0.01';
      } else editor.type = 'text';
      let value = '';
      if (key === 'name') value = task.name;
      else if (key === 'notes') value = task.notes || '';
      else if (key === 'start') value = task.start || '';
      else if (key === 'end') value = task.end || task.start || '';
      else if (key === 'actualStart') value = task.actualStart || '';
      else if (key === 'actualEnd') value = task.actualEnd || '';
      else if (key === 'baselineStart') value = task.baselineStart || '';
      else if (key === 'baselineEnd') value = task.baselineEnd || '';
      else if (key === 'duration') value = rawDuration(task);
      else if (key === 'progress') value = String(Math.round(Number(task.percentComplete) || 0));
      else if (key === 'cost') value = task.estimatedCost == null ? (task.cost == null ? '' : task.cost) : task.estimatedCost;
      else if (key === 'estimatedCost') value = task.estimatedCost == null ? '' : task.estimatedCost;
      else if (key === 'actualCost') value = task.actualCost == null ? '' : task.actualCost;
      else if (key === 'resources') value = resourceNames(project, task).join(', ');
      else if (key.indexOf('custom.') === 0) {
        const ck = key.slice(7);
        value = task.custom && task.custom[ck] != null ? task.custom[ck] : '';
      }
      if (seed && editor.type !== 'date') value = seed;
      editor.value = value;
    }
    editor.className = 'inline-input';
    editor.setAttribute('aria-label', key);
    cell.innerHTML = '';
    cell.appendChild(editor);
    const state = { taskId, key, cell, editor, done: false };
    editing = state;
    editor.focus();
    if (seed && editor.setSelectionRange && editor.type !== 'date') {
      const pos = String(editor.value).length;
      try { editor.setSelectionRange(pos, pos); } catch (err) { /* ignore */ }
    } else if (editor.type !== 'date' && editor.select) editor.select();
    editor.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); commitEdit('down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commitEdit(e.shiftKey ? 'prev' : 'next'); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    });
    editor.addEventListener('blur', () => {
      if (editing === state && !state.done) commitEdit('none');
    });
  }

  function navigateCell(dRow, dCol) {
    const tab = Store.active();
    if (!tab) return;
    clearActiveBar();
    const project = tab.project;
    const rows = rowsFor(project);
    const cols = Model.visibleColumns(project);
    if (!rows.length || !cols.length) return;
    let ri = currentCell ? rows.findIndex((r) => r.task.id === currentCell.taskId) : 0;
    let ci = currentCell ? cols.findIndex((c) => c.key === currentCell.key) : 0;
    if (ri < 0) ri = 0;
    if (ci < 0) ci = 0;
    if (dRow) ri = U.clamp(ri + dRow, 0, rows.length - 1);
    if (dCol) {
      ci += dCol;
      if (ci < 0) { ci = cols.length - 1; ri = Math.max(0, ri - 1); }
      else if (ci >= cols.length) { ci = 0; ri = Math.min(rows.length - 1, ri + 1); }
    }
    currentCell = { taskId: rows[ri].task.id, key: cols[ci].key };
    applyCellFocus();
    const grid = $('taskRows');
    const cell = cellFor(currentCell.taskId, currentCell.key);
    // Scroll only inside the outline pane; scrollIntoView can shift the whole app.
    if (grid && cell) {
      const gridRect = grid.getBoundingClientRect();
      const row = cell.closest('.task-row');
      if (row) {
        const rowRect = row.getBoundingClientRect();
        const top = rowRect.top - gridRect.top + grid.scrollTop;
        const bottom = top + rowRect.height;
        if (top < grid.scrollTop) grid.scrollTop = top;
        else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
      }
      const cellRect = cell.getBoundingClientRect();
      const left = cellRect.left - gridRect.left + grid.scrollLeft;
      const right = left + cellRect.width;
      if (left < grid.scrollLeft) grid.scrollLeft = left;
      else if (right > grid.scrollLeft + grid.clientWidth) grid.scrollLeft = right - grid.clientWidth;
    }
    if (grid) grid.focus({ preventScroll: true });
  }

  function clearCellValue() {
    if (!currentCell || editing) return false;
    const tab = Store.active();
    if (!tab) return false;
    const task = Model.getTask(tab.project, currentCell.taskId);
    if (!task || !isEditableKey(tab.project, task, currentCell.key)) return false;
    const key = currentCell.key;
    const clearable = ['notes', 'cost', 'estimatedCost', 'actualCost', 'actualStart',
      'actualEnd', 'baselineStart', 'baselineEnd', 'progress', 'resources'].includes(key) ||
      key.indexOf('custom.') === 0;
    if (!clearable) return false;
    Store.mutate((p) => {
      const t = Model.getTask(p, currentCell.taskId);
      if (!t) return;
      if (key === 'notes') t.notes = '';
      else if (key === 'resources') t.resources = [];
      else if (key === 'progress') t.percentComplete = 0;
      else if (key === 'actualStart') t.actualStart = null;
      else if (key === 'actualEnd') t.actualEnd = null;
      else if (key === 'baselineStart') t.baselineStart = null;
      else if (key === 'baselineEnd') t.baselineEnd = null;
      else if (key === 'cost' || key === 'estimatedCost') { t.cost = null; t.estimatedCost = null; }
      else if (key === 'actualCost') t.actualCost = null;
      else if (key.indexOf('custom.') === 0) {
        t.custom = t.custom || {};
        delete t.custom[key.slice(7)];
      }
    });
    return true;
  }

  function showGhost(e, text) {
    if (!dragGhost) {
      dragGhost = document.createElement('div');
      dragGhost.className = 'drag-ghost';
      document.body.appendChild(dragGhost);
    }
    dragGhost.textContent = text;
    dragGhost.style.left = (e.clientX + 14) + 'px';
    dragGhost.style.top = (e.clientY + 16) + 'px';
  }
  function hideGhost() {
    if (dragGhost) { dragGhost.remove(); dragGhost = null; }
  }

  function barTitle(project, task, summary) {
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const lines = [task.name];
    if (summary) lines.push('Summary task');
    if (task.type === 'milestone') lines.push('Milestone · ' + U.fmtDate(task.start, fmt));
    else {
      lines.push('Start: ' + U.fmtDate(task.start, fmt));
      lines.push('Finish: ' + U.fmtDate(task.end || task.start, fmt));
      lines.push('Duration: ' + U.formatDuration(Model.durationDays(project, task), project.hoursPerDay, task));
    }
    if (task.type !== 'milestone') {
      const pctText = Math.round(Number(task.percentComplete) || 0) + '%';
      lines.push(summary ? 'Progress (rolled up): ' + pctText : 'Progress: ' + pctText);
    }
    const names = resourceNames(project, task);
    if (names.length) lines.push('Resources: ' + names.join(', '));
    if (task.notes) lines.push(task.notes);
    return lines.join('\n');
  }

  function renderTaskHead(project, headEl) {
    const head = headEl || $('taskHead');
    if (!head) return null;
    const layout = columnsFor(project);
    head.innerHTML = '<div class="task-head-row" style="width:' + layout.total + 'px;grid-template-columns:' + layout.template + '">' +
      layout.cols.map((c) => '<div class="task-head-cell' + (CENTER_COLUMNS.has(c.key) ? ' center' : '') +
        '" data-col-key="' + c.key + '" title="' + U.escapeHtml(c.label) + '">' +
        '<span>' + U.escapeHtml(String(c.label).toUpperCase()) + '</span>' +
        '<span class="col-resize" data-col-resize="' + c.key + '" title="Drag to resize · double-click to reset"></span></div>').join('') +
      '</div>';
    return layout;
  }

  // A full repaint replaces every cell, so the inline editor that lived in one
  // of them is gone. Keeping `editing` pointing at that detached input made the
  // next repaint re-insert the old element, and every further click added
  // another copy: three "open" editors at once. The state is dropped here and
  // the value is committed first, as a blur would have done.
  let droppingEditor = false;
  function dropEditorForRepaint() {
    if (!editing || droppingEditor) return;
    const state = editing;
    // Clear the slot before committing: commitEdit ends in render(), which would
    // come straight back here.
    editing = null;
    state.done = true;
    droppingEditor = true;
    try { commitEdit('none'); } catch (err) { /* the row may be gone */ }
    droppingEditor = false;
    if (state.editor && state.editor.parentNode) state.editor.parentNode.removeChild(state.editor);
  }

  function renderTaskRows(project, rows, layout, boxEl) {
    const box = boxEl || $('taskRows');
    if (!box) return;
    dropEditorForRepaint();
    const selected = selectionSet();
    const today = U.todayISO();
    if (currentCell && !Model.getTask(project, currentCell.taskId)) currentCell = null;
    if (!rows.length) {
      const hasLinks = (project.linkedProjects || []).length > 0;
      const message = (project.tasks.length || hasLinks)
        ? 'No tasks match the current search or filter.'
        : 'No tasks yet — type a task name above or use Add task.';
      box.innerHTML = addRowHtml(layout.total) +
        '<div class="empty-row">' + U.escapeHtml(message) + '</div>';
      applyCellFocus();
      return;
    }
    box.innerHTML = rows.map((row) => {
      const t = row.task;
      const isLate = t.status === 'late' || (t.end && U.diffDays(t.end, today) > 0 && (t.percentComplete || 0) < 100);
      const cls = 'task-row' +
        (row.linked ? ' linked' : '') +
        (row.hasChildren ? ' summary' : '') +
        (selected.has(t.id) ? ' selected' : '') +
        (isLate ? ' late' : '') +
        (row.collapsed ? ' collapsed' : '');
      return '<div class="' + cls + '" data-task-id="' + t.id + '"' +
        (row.linked ? ' data-linked="' + U.escapeHtml(t.sourceProject || '') + '"' : '') +
        ' style="width:' + layout.total +
        'px;grid-template-columns:' + layout.template + '">' +
        layout.cols.map((c) => cellHtml(c, t, row, project)).join('') + '</div>';
    }).join('') + addRowHtml(layout.total);
    Array.from(box.querySelectorAll('.task-row[data-task-id]')).forEach((row) => {
      Array.from(row.children).forEach((cell, i) => {
        const col = layout.cols[i];
        if (col && cell.classList.contains('cell')) cell.dataset.colKey = col.key;
      });
    });
    applyCellFocus();
  }

  // ---------- timeline geometry ----------
  function metrics(project) {
    const zoom = project.view.zoom || 'day';
    const scale = U.clamp(Number(Store.settings().planZoom) || 100, MIN_PLAN_ZOOM, MAX_PLAN_ZOOM) / 100;
    let px = Math.max(0.12, (ZOOM_BASE[zoom] || 28) * scale);
    const range = Model.timelineRange(project, zoom);
    const width = Math.max(120, range.days * px);
    return { zoom, scale, px, range, width };
  }

  // The scale on screen is exactly what is stored; nothing is stretched behind
  // the user's back.
  function zoomPercent() {
    return U.clamp(Math.round(Number(Store.settings().planZoom) || 100), MIN_PLAN_ZOOM, MAX_PLAN_ZOOM);
  }

  // The read-out doubles as the input: it is only rewritten when the user is not
  // typing in it, or the caret would jump on every redraw.
  function paintZoomLabel() {
    const field = $('zoomRatio');
    if (!field) return;
    const text = zoomPercent() + '%';
    if (document.activeElement === field) return;
    if (field.value !== text) field.value = text;
  }

  // Manual entry, clamped to the same floor and ceiling as the wheel.
  function setZoomPercent(value) {
    const tab = Store.active();
    if (!tab) return;
    const next = U.clamp(Math.round(Number(value) || 0), MIN_PLAN_ZOOM, MAX_PLAN_ZOOM);
    if (next === (Number(Store.settings().planZoom) || 100)) { paintZoomLabel(); return; }
    Store.settings().planZoom = next;
    Store.persist();
    render();
    paintZoomLabel();
  }
  function leftFor(m, iso) { return U.diffDays(m.range.start, iso) * m.px; }
  function dayNum(iso) { const d = U.parseDate(iso); return d ? d.getUTCDate() : ''; }
  function weekNumber(iso) {
    const d = U.parseDate(iso);
    if (!d) return 0;
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const shift = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - shift + 3);
    const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
    const firstShift = (firstThu.getUTCDay() + 6) % 7;
    return 1 + Math.round(((t - firstThu) / 86400000 - 3 + firstShift) / 7);
  }
  function seg(left, width, label, cls) {
    return '<div class="th-cell ' + (cls || '') + '" style="left:' + left + 'px;width:' + Math.max(1, width) + 'px">' + label + '</div>';
  }

  function monthSegments(start, endEx, px, noYear) {
    let cur = start;
    const out = [];
    let guard = 0;
    while (U.diffDays(cur, endEx) > 0 && guard++ < 600) {
      const monthEndEx = U.addDays(U.endOfMonth(cur), 1);
      const stop = U.diffDays(endEx, monthEndEx) > 0 ? endEx : monthEndEx;
      const days = U.diffDays(cur, stop);
      out.push(seg(U.diffDays(start, cur) * px, days * px,
        U.monthName(cur, false) + (noYear ? '' : ' ' + U.yearOf(cur)), ''));
      cur = stop;
    }
    return out.join('');
  }
  function yearSegments(start, endEx, px) {
    let cur = start;
    const out = [];
    let guard = 0;
    while (U.diffDays(cur, endEx) > 0 && guard++ < 300) {
      const year = U.yearOf(cur);
      const stop = U.diffDays(endEx, (year + 1) + '-01-01') > 0 ? endEx : (year + 1) + '-01-01';
      const days = U.diffDays(cur, stop);
      out.push(seg(U.diffDays(start, cur) * px, days * px, String(year), ''));
      cur = stop;
    }
    return out.join('');
  }
  function quarterSegments(start, endEx, px) {
    let cur = start;
    const out = [];
    let guard = 0;
    while (U.diffDays(cur, endEx) > 0 && guard++ < 300) {
      const q = U.quarterOf(cur);
      const year = U.yearOf(cur);
      const nextMonth = q * 3;
      const stopIso = nextMonth >= 12 ? (year + 1) + '-01-01' : year + '-' + String(nextMonth + 1).padStart(2, '0') + '-01';
      const stop = U.diffDays(endEx, stopIso) > 0 ? endEx : stopIso;
      out.push(seg(U.diffDays(start, cur) * px, U.diffDays(cur, stop) * px, 'Q' + q, ''));
      cur = stop;
    }
    return out.join('');
  }
  function halfSegments(start, endEx, px, short) {
    let cur = start;
    const out = [];
    let guard = 0;
    while (U.diffDays(cur, endEx) > 0 && guard++ < 300) {
      const year = U.yearOf(cur);
      const first = U.parseDate(cur).getUTCMonth() < 6;
      const stopIso = first ? year + '-07-01' : (year + 1) + '-01-01';
      const stop = U.diffDays(endEx, stopIso) > 0 ? endEx : stopIso;
      out.push(seg(U.diffDays(start, cur) * px, U.diffDays(cur, stop) * px, first ? 'H1' : 'H2', ''));
      cur = stop;
    }
    return out.join('');
  }
  function weekSegments(start, endEx, px) {
    let cur = start;
    const out = [];
    let guard = 0;
    while (U.diffDays(cur, endEx) > 0 && guard++ < 600) {
      const stop = U.diffDays(endEx, U.addDays(cur, 7)) > 0 ? endEx : U.addDays(cur, 7);
      out.push(seg(U.diffDays(start, cur) * px, U.diffDays(cur, stop) * px,
        'W' + String(weekNumber(cur)).padStart(2, '0'), ''));
      cur = stop;
    }
    return out.join('');
  }
  function daySegments(start, endEx, px, cal) {
    const hs = U.holidaySet(cal);
    const out = [];
    for (let i = 0; i < 4000; i++) {
      const iso = U.addDays(start, i);
      if (U.diffDays(iso, endEx) <= 0) break;
      const wd = U.weekday(iso);
      const nonwork = !U.isWorkingDay(iso, cal, hs);
      out.push(seg(i * px, px,
        '<b>' + dayNum(iso) + '</b><span>' + U.dayName(iso, true).slice(0, 2) + '</span>',
        'weekday' + (nonwork ? ' nonwork' : '') + ((wd === 0 || wd === 6) ? ' weekend' : '')));
    }
    return out.join('');
  }
  function dayHeaders(start, endEx, px) {
    const out = [];
    for (let i = 0; i < 1200; i++) {
      const iso = U.addDays(start, i);
      if (U.diffDays(iso, endEx) <= 0) break;
      out.push(seg(i * px, px, U.dayName(iso, true) + ' ' + dayNum(iso) + ' ' + U.monthName(iso, true), ''));
    }
    return out.join('');
  }
  function hourSegments(start, endEx, px) {
    const hourPx = px / 24;
    const out = [];
    for (let i = 0; i < 400; i++) {
      const iso = U.addDays(start, i);
      if (U.diffDays(iso, endEx) <= 0) break;
      for (let h = 0; h < 24; h++) {
        out.push(seg((i * 24 + h) * hourPx, hourPx,
          h % 3 === 0 ? String(h).padStart(2, '0') + ':00' : '', h === 0 ? 'weekday' : ''));
      }
    }
    return out.join('');
  }

  function paneWidth() {
    const scroll = $('timelineScroll');
    return scroll ? scroll.clientWidth : 0;
  }

  // The chart always runs to the right edge of the pane: the range simply
  // carries on past the last task, so zooming out never leaves a blank strip on
  // the right-hand side.
  function fillEnd(m) {
    const rangeEnd = U.addDays(m.range.end, 1);
    const paneW = paneWidth();
    if (!paneW || paneW <= m.width) return rangeEnd;
    // One extra day so the last column is clipped by the canvas rather than
    // leaving a sliver of empty pane on the right.
    return U.addDays(rangeEnd, Math.ceil((paneW - m.width) / m.px) + 1);
  }

  function headWidth(m) {
    return Math.max(m.width, paneWidth());
  }

  function renderTimelineHead(project, m) {
    const head = $('timelineHead');
    if (!head) return;
    const start = m.range.start;
    const endEx = fillEnd(m);
    const cal = Model.calendarFor(project, null);
    let top = '', bottom = '';
    switch (m.zoom) {
      case 'hour':
        top = dayHeaders(start, endEx, m.px); bottom = hourSegments(start, endEx, m.px); break;
      case 'day':
        top = monthSegments(start, endEx, m.px); bottom = daySegments(start, endEx, m.px, cal); break;
      case 'week':
        top = monthSegments(start, endEx, m.px); bottom = weekSegments(start, endEx, m.px); break;
      case 'month':
        top = yearSegments(start, endEx, m.px); bottom = monthSegments(start, endEx, m.px, true); break;
      case 'quarter':
        top = yearSegments(start, endEx, m.px); bottom = quarterSegments(start, endEx, m.px); break;
      case 'halfYear':
        top = yearSegments(start, endEx, m.px); bottom = halfSegments(start, endEx, m.px); break;
      case 'year':
        top = yearSegments(start, endEx, m.px); bottom = halfSegments(start, endEx, m.px, true); break;
      default:
        top = monthSegments(start, endEx, m.px); bottom = daySegments(start, endEx, m.px, cal);
    }
    head.style.width = headWidth(m) + 'px';
    // Past a certain narrowness a day column cannot hold its date and the ruler
    // turns into a smear of overlapping numbers, so the labels are dropped and
    // the grid carries the reading instead.
    head.classList.toggle('dense', m.px < 14);
    head.innerHTML = '<div class="th-band th-top">' + top + '</div><div class="th-band th-bottom">' + bottom + '</div>';
  }

  function backgroundHtml(project, m, endIso) { return backgroundBody(project, m, endIso) + todayLine(project, m); }

  // Reusable by the overview's people chart, which draws the same grid without
  // a today marker of its own.
  function backgroundBody(project, m, endIso) {
    const cal = Model.calendarFor(project, null);
    const hs = U.holidaySet(cal);
    const out = [];
    const endEx = endIso || fillEnd(m);
    const cell = (startIso, stopIso, cls) => {
      const left = U.diffDays(m.range.start, startIso) * m.px;
      const width = U.diffDays(startIso, stopIso) * m.px;
      out.push('<div class="tl-day ' + (cls || '') + '" style="left:' + left + 'px;width:' + Math.max(1, width) + 'px"></div>');
    };
    if (m.zoom === 'hour') {
      const hourPx = m.px / 24;
      for (let i = 0; i < 400; i++) {
        const iso = U.addDays(m.range.start, i);
        if (U.diffDays(iso, endEx) <= 0) break;
        const nonwork = !U.isWorkingDay(iso, cal, hs);
        for (let h = 0; h < 24; h++) {
          out.push('<div class="tl-day' + (nonwork ? ' nonwork' : '') + '" style="left:' +
            ((i * 24 + h) * hourPx) + 'px;width:' + hourPx + 'px"></div>');
        }
      }
    } else if (m.zoom === 'day') {
      for (let i = 0; i < 5000; i++) {
        const iso = U.addDays(m.range.start, i);
        if (U.diffDays(iso, endEx) <= 0) break;
        const nonwork = !U.isWorkingDay(iso, cal, hs);
        cell(iso, U.addDays(iso, 1), (nonwork ? 'nonwork' : '') + (dayNum(iso) === 1 ? ' month-start' : ''));
      }
    } else if (m.zoom === 'week') {
      let cur = m.range.start;
      for (let i = 0; i < 600 && U.diffDays(cur, endEx) > 0; i++) {
        const stop = U.diffDays(endEx, U.addDays(cur, 7)) > 0 ? endEx : U.addDays(cur, 7);
        cell(cur, stop, 'tl-week-cell');
        cur = stop;
      }
    } else if (m.zoom === 'month') {
      let cur = m.range.start;
      for (let i = 0; i < 300 && U.diffDays(cur, endEx) > 0; i++) {
        const next = U.addDays(U.endOfMonth(cur), 1);
        const stop = U.diffDays(endEx, next) > 0 ? endEx : next;
        cell(cur, stop, 'tl-month-cell');
        cur = stop;
      }
    } else if (m.zoom === 'quarter') {
      let cur = m.range.start;
      for (let i = 0; i < 200 && U.diffDays(cur, endEx) > 0; i++) {
        const q = U.quarterOf(cur);
        const year = U.yearOf(cur);
        const nextMonth = q * 3;
        const next = nextMonth >= 12 ? (year + 1) + '-01-01' : year + '-' + String(nextMonth + 1).padStart(2, '0') + '-01';
        const stop = U.diffDays(endEx, next) > 0 ? endEx : next;
        cell(cur, stop, 'tl-quarter-cell');
        cur = stop;
      }
    } else if (m.zoom === 'halfYear') {
      let cur = m.range.start;
      for (let i = 0; i < 120 && U.diffDays(cur, endEx) > 0; i++) {
        const y = U.yearOf(cur);
        const next = U.parseDate(cur).getUTCMonth() < 6 ? y + '-07-01' : (y + 1) + '-01-01';
        const stop = U.diffDays(endEx, next) > 0 ? endEx : next;
        cell(cur, stop, 'tl-half-cell');
        cur = stop;
      }
    } else {
      let cur = m.range.start;
      for (let i = 0; i < 120 && U.diffDays(cur, endEx) > 0; i++) {
        const y = U.yearOf(cur);
        const next = (y + 1) + '-01-01';
        const stop = U.diffDays(endEx, next) > 0 ? endEx : next;
        cell(cur, stop, 'tl-year-cell');
        cur = stop;
      }
    }
    return '<div class="tl-bg">' + out.join('') + '</div>';
  }

  function todayLine(project, m) {
    const today = U.todayISO();
    const inside = U.diffDays(m.range.start, today) >= 0 && U.diffDays(today, m.range.end) >= 0;
    return inside ? '<div class="tl-today" style="left:' + leftFor(m, today) + 'px"></div>' : '';
  }

  // Leaf bar colour. Precedence, most specific first:
  //   1. the task's own colour,
  //   2. the overdue colour when the task is past due and unfinished,
  //   3. the first assigned resource's colour (project setting),
  //   4. the priority colour, then the project default.
  function barColour(project, task) {
    if (task.color) return task.color;
    const app = project.appearance || {};
    if (app.overdueOn && Model.isOverdue(task)) return app.overdueColour || '#d9534f';
    if (app.colourFromPeople) {
      const roster = ownerProjectFor(task) || project;
      const pool = (roster.resources || []).concat(project.resources || []);
      const assigned = (task.resources || []).map((a) => pool.find((r) => r.id === a.resourceId)).filter(Boolean);
      const withColour = assigned.find((r) => r.colour);
      if (withColour) return withColour.colour;
    }
    const prefs = app.priorityColours;
    if (prefs && prefs[task.priority]) return prefs[task.priority];
    return app.defaultBarColour || null;
  }

  function milestoneColour(project) {
    return Model.paletteOf(project).milestone || 'var(--ms)';
  }

  function progressColour(project, task) {
    if (task.progressColor) return task.progressColor;
    return (project.appearance && project.appearance.defaultProgressColour) || null;
  }

  // Resolved bar colour, shared by the timeline bar and the outline PROGRESS
  // column so both surfaces always tint the same task the same way.
  function barTint(project, task, summary) {
    const explicit = summary ? (task.color || null) : barColour(project, task);
    if (explicit) return explicit;
    if (project.view.showCriticalPath && task.critical) return 'var(--critical)';
    return summary ? 'var(--summary)' : 'var(--bar)';
  }

  function barLabel(project, task) {
    const fields = project.view.barLabelFields || ['name'];
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const names = resourceNames(project, task);
    return fields.map((f) => {
      switch (f) {
        case 'name': return task.name;
        case 'start': return U.fmtDate(task.start, fmt);
        case 'end': return U.fmtDate(task.end || task.start, fmt);
        case 'duration': return U.formatDuration(Model.durationDays(project, task), project.hoursPerDay, task);
        case 'resource': return names.join(', ');
        case 'percent': return (Math.round(Number(task.percentComplete) || 0)) + '%';
        case 'cost': { const c = projectMoney(project, task); return c == null ? '' : U.formatMoney(c, project); }
        default: return '';
      }
    }).filter(Boolean).join(' · ');
  }

  // Pixel box for an arbitrary date span. The plan bar, the baseline rail and
  // the actual rail all go through this, so two identical date ranges always
  // render at exactly the same width.
  function spanBox(m, fromIso, toIso, minWidth) {
    const left = leftFor(m, fromIso);
    const right = leftFor(m, toIso || fromIso);
    return { left: left, width: Math.max(minWidth, right - left + m.px) };
  }

  function barBox(project, task, m, startLeft, endLeft, isMilestone) {
    if (isMilestone) return { left: startLeft + m.px / 2 - 5.5, width: 11 };
    if (m.zoom === 'hour') {
      const hpd = Number(project.hoursPerDay) || 8;
      const hours = Math.max(0, Model.durationDays(project, task) * hpd);
      if (hours > 0 && hours <= hpd) {
        return { left: startLeft + (8 / 24) * m.px, width: Math.max(4, hours * (m.px / 24)) };
      }
    }
    return { left: startLeft, width: Math.max(3, endLeft - startLeft + m.px) };
  }

  function barsHtml(project, rows, m, selected) {
    const today = U.todayISO();
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const showBaseline = !!project.view.showBaselineBars;
    const showActual = !!project.view.showActualBars;
    const showCritical = !!project.view.showCriticalPath;
    const style = (project.appearance && project.appearance.barStyle) || Store.settings().barStyle || 'raised';
    const parts = [];

    rows.forEach((row, idx) => {
      const t = row.task;
      const top = idx * ROW_H;
      const isSummary = row.hasChildren;
      const isMilestone = t.type === 'milestone';
      const startLeft = leftFor(m, t.start);
      const endLeft = leftFor(m, t.end || t.start);
      const box = barBox(project, t, m, startLeft, endLeft, isMilestone);
      const left = box.left;
      const width = box.width;
      const critical = showCritical && t.critical;
      // Summary bars use one theme colour only; per-task / priority / default
      // colours are for leaf task bars and milestones.
      // Milestones have a colour of their own: the palette's milestone slot
      // instead of the leaf-bar ramp, so diamonds stay readable even when a
      // priority ramp paints every bar the same shade.
      const colour = isSummary ? (t.color || null)
        : isMilestone ? (t.color || milestoneColour(project))
        : barColour(project, t);
      // Parent bars draw their end caps with ::before/::after, which cannot read
      // an inline background, so the fill is published as a custom property that
      // the bar, its caps and the rolled-up label all share.
      const summaryFill = isSummary ? barTint(project, t, true) : null;
      let cls = 'gbar';
      if (isSummary) cls += ' summary';
      else if (isMilestone) cls += ' milestone';
      if (!isSummary && !isMilestone) {
        // Bar style ids map onto the .gbar modifiers, prefixed so they never
        // collide with unrelated app classes (e.g. the .pill chip).
        if (['flat', 'rounded', 'outline', 'pill'].indexOf(style) >= 0) cls += ' bar-' + style;
      }
      if (critical) cls += ' critical';
      if (t.id === activeBarId && !isSummary) cls += ' bar-active';
      const barTop = top + (isSummary ? 9 : PLAN_TOP);
      const inline = 'left:' + left + 'px;top:' + barTop + 'px;width:' + (isSummary || isMilestone ? width : Math.max(6, width)) + 'px' +
        (colour ? ';background-color:' + U.escapeHtml(colour) + ';border-color:' + U.escapeHtml(colour) : '') +
        (summaryFill ? ';--sum-fill:' + U.escapeHtml(summaryFill) : '');
      const pct = U.clamp(Number(t.percentComplete) || 0, 0, 100);
      const labelText = U.escapeHtml(barLabel(project, t));
      const label = labelText ? '<span class="bar-label">' + labelText + '</span>' : '';
      const fillColour = progressColour(project, t);
      const fillStyle = 'width:' + pct + '%' + (fillColour ? ';background:' + U.escapeHtml(fillColour) : '');
      // A completed fill reaches the far cap. It needs the bar's own corners or
      // its square right edge flattens the rounded end.
      const fillCls = pct >= 100 ? 'fill full' : 'fill';
      // A parent (summary) bar has no actual-progress fill: the rolled-up value
      // is written in the middle of the plan bar instead. Leaf bars keep the
      // familiar fill plus a label over the completed part.
      const pctLabel = (!isMilestone && (pct > 0 || isSummary))
        ? '<span class="bar-progress-label' + (isSummary ? ' summary' : '') +
          '" style="left:' + (isSummary ? 50 : pct / 2) + '%">' + pct + '%</span>'
        : '';
      parts.push('<div class="' + cls + '" data-task-id="' + t.id + '" style="' + inline + '" title="' +
        U.escapeHtml(barTitle(project, t, isSummary)) + '">' +
        (isMilestone || isSummary ? '' : '<div class="' + fillCls + '" style="' + fillStyle + '"></div>') +
        label + pctLabel +
        (isSummary || isMilestone ? '' :
          '<span class="link-handle left" data-link-side="left" title="Start connector — drop on a start (SS) or finish (SF)"></span>' +
          '<span class="link-handle right" data-link-side="right" title="Finish connector — drop on a start (FS) or finish (FF)"></span>') +
        (isSummary || isMilestone ? '' :
          '<span class="resize left" data-handle="left" title="Drag to change start"></span>' +
          '<span class="resize right" data-handle="right" title="Drag to change duration"></span>') +
        (!isSummary && !isMilestone && pct > 0 && pct < 100
          ? '<span class="progress-handle" style="left:' + pct + '%" title="Drag to set progress"></span>' : '') +
        '</div>');

      // Baseline sits above the plan bar; actual progress sits directly below it.
      // A milestone is a single instant, so a baseline rail under its diamond
      // has nothing to show. Only real bars get one.
      if (showBaseline && t.baselineStart && !isSummary && !isMilestone) {
        const bBox = spanBox(m, t.baselineStart, t.baselineEnd || t.baselineStart, 6);
        parts.push('<div class="gbar baseline" data-task-id="' + t.id + '" data-no-drag="1" style="left:' + bBox.left +
          'px;top:' + (top + BASELINE_TOP) + 'px;width:' + bBox.width + 'px" title="Baseline: ' +
          U.fmtDate(t.baselineStart, project.view.dateFormat || 'dd-mmm-yy') + ' → ' +
          U.fmtDate(t.baselineEnd || t.baselineStart, project.view.dateFormat || 'dd-mmm-yy') + '"></div>');
      }
      if (showActual && t.actualStart && !isSummary && !isMilestone) {
        const aEndIso = t.actualEnd || (U.diffDays(t.actualStart, today) >= 0 ? today : t.actualStart);
        const aBox = spanBox(m, t.actualStart, aEndIso, 6);
        parts.push('<div class="gbar actual" data-task-id="' + t.id + '" data-no-drag="1" style="left:' + aBox.left +
          'px;top:' + (top + ACTUAL_TOP) + 'px;width:' + aBox.width + 'px" title="Actual"></div>');
      }
    });
    return '<div class="tl-bars">' + parts.join('') + '</div>';
  }

  // Route a dependency with as few bends as possible. When the direct "Z" route
  // would have to travel back through the source bar, fall back to a channel in
  // the row gap (used only for overlapping / backward links).
  function linkPath(sx, sy, tx, ty, sourceEnd, targetEnd) {
    const EXIT = 4;       // short stub leaving the source bar
    const APPROACH = 14;  // minimum visible run before the arrowhead
    const exitDir = sourceEnd === 'start' ? -1 : 1;
    const fromLeft = targetEnd === 'start';
    const exitLane = sx + exitDir * EXIT;
    const lane = fromLeft ? Math.min(exitLane, tx - APPROACH) : Math.max(exitLane, tx + APPROACH);
    if ((lane - sx) * exitDir >= 0) {
      return 'M ' + sx + ' ' + sy + ' L ' + lane + ' ' + sy + ' L ' + lane + ' ' + ty + ' L ' + tx + ' ' + ty;
    }
    // Tight / backward links: drop straight into the row gap, cross, then use the
    // same fixed approach length so the arrow stays clearly visible.
    const channelY = sy < ty ? ty - ROW_H / 2 - 2 : ty + ROW_H / 2 + 2;
    const entryStub = tx + (fromLeft ? -APPROACH : APPROACH);
    return 'M ' + sx + ' ' + sy + ' L ' + sx + ' ' + channelY +
      ' L ' + entryStub + ' ' + channelY + ' L ' + entryStub + ' ' + ty + ' L ' + tx + ' ' + ty;
  }

  function linksHtml(project, rows, m, height) {
    if (!project.view.showLinks) return '';
    const index = new Map();
    rows.forEach((r, i) => index.set(r.task.id, i));
    // Referenced rows are keyed "<project>|<task>", so their own links are
    // looked up by the real id and their geometry uses the real task.
    rows.forEach((r, i) => {
      if (!r.linked || r.task.realId) index.set(r.task.realId || realTaskId(r.task.id), i);
    });
    const taskFor = (row, id) => {
      if (!row || !row.linked) return Model.getTask(project, id);
      const owner = Store.allProjects().find((p) => p.id === row.task.sourceProject);
      return owner ? Model.getTask(owner.project, realTaskId(row.task.id)) : null;
    };
    const geo = (task, idx) => {
      const isMilestone = task.type === 'milestone';
      const start = leftFor(m, task.start);
      const end = leftFor(m, task.end || task.start);
      const box = barBox(project, task, m, start, end, isMilestone);
      return {
        left: box.left, right: box.left + box.width,
        center: box.left + box.width / 2,
        y: idx * ROW_H + ROW_H / 2,
        milestone: isMilestone
      };
    };
    const paths = [];
    // Transparent twins of every line: same geometry, wide stroke, no paint.
    // They are the actual click targets (see .tl-link-hits in the stylesheet).
    const hits = [];
    const showCritical = !!project.view.showCriticalPath;
    // This plan's links plus the links of every referenced plan, so a block of
    // another project shows its own dependencies instead of looking empty. A
    // link stores ids from ITS OWN plan, so it is keyed for this outline first:
    // local ids stay as they are, a referenced plan's ids gain its prefix.
    const linkSets = [{ project: project, links: project.links || [], key: (id) => id }];
    (project.linkedProjects || []).forEach((link) => {
      const owner = Model.resolveLinkProject(link, Store.allProjects());
      if (owner) {
        linkSets.push({ project: owner.project, links: owner.project.links || [], key: (id) => owner.id + '|' + id });
      }
    });
    const allLinks = [];
    linkSets.forEach((set) => set.links.forEach((l) => allLinks.push({ link: l, set })));
    allLinks.forEach((entry) => {
      const l = entry.link;
      if (!l.from || !l.to) return;
      const fromKey = entry.set.key(l.from);
      const toKey = entry.set.key(l.to);
      if (!index.has(fromKey) || !index.has(toKey)) return;
      const rowA = rows[index.get(fromKey)];
      const rowB = rows[index.get(toKey)];
      const a = taskFor(rowA, fromKey);
      const b = taskFor(rowB, toKey);
      if (!a || !b) return;
      const ga = geo(a, index.get(fromKey));
      const gb = geo(b, index.get(toKey));
      const type = l.type || 'FS';
      const sourceEnd = (type === 'FS' || type === 'FF') ? 'finish' : 'start';
      const targetEnd = (type === 'FS' || type === 'SS') ? 'start' : 'finish';
      const sx = sourceEnd === 'finish' ? ga.right : ga.left;
      const tx = targetEnd === 'start' ? gb.left : gb.right;
      const d = linkPath(sx, ga.y, tx, gb.y, sourceEnd, targetEnd);
      const critical = showCritical && a.critical && b.critical;
      const hot = !!activeBarId && (fromKey === activeBarId || toKey === activeBarId);
      const cls = [critical ? 'critical' : '', hot ? 'hot' : '',
        entry.set === linkSets[0] ? '' : 'ref-link'].filter(Boolean).join(' ');
      paths.push('<path d="' + d + '" data-link-id="' + l.id + '" data-from="' + fromKey + '" data-to="' + toKey +
        '"' + (cls ? ' class="' + cls + '"' : '') +
        (critical ? ' marker-end="url(#pc-arr-crit)"' : ' marker-end="url(#pc-arr)"') + '/>');
      hits.push('<path class="tl-link-hit" d="' + d + '" data-link-id="' + l.id +
        '" data-from="' + fromKey + '" data-to="' + toKey + '"/>');
    });
    if (!paths.length) return '';
    // The hit layer goes FIRST so the visible lines paint on top of it; being
    // earlier in the DOM also keeps a wide hit area from stealing a click meant
    // for a bar that happens to overlap a line.
    return '<svg class="tl-links" width="' + m.width + '" height="' + height +
      '" style="width:' + m.width + 'px;height:' + height + 'px" viewBox="0 0 ' + m.width + ' ' + height + '">' +
      '<g class="tl-link-hits">' + hits.join('') + '</g>' +
      '<defs>' +
      '<marker id="pc-arr" viewBox="0 0 5 5" refX="4.5" refY="2.5" markerWidth="5" markerHeight="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse">' +
      '<path d="M0 0 5 2.5 0 5z" style="fill:#627b95;stroke:none"/></marker>' +
      '<marker id="pc-arr-crit" viewBox="0 0 5 5" refX="4.5" refY="2.5" markerWidth="5" markerHeight="5" markerUnits="userSpaceOnUse" orient="auto-start-reverse">' +
      '<path d="M0 0 5 2.5 0 5z" style="fill:#cf3f3f;stroke:none"/></marker>' +
      '</defs>' + paths.join('') + '</svg>';
  }

  function renderTimeline(project, rows, target) {
    const canvas = target || $('timelineCanvas');
    if (!canvas) return;
    if (activeBarId && !Model.getTask(project, activeBarId)) activeBarId = null;
    const m = metrics(project);
    const selected = selectionSet();
    const height = rows.length ? rows.length * ROW_H : 140;
    const rowHtml = rows.map((row, i) => {
      const cls = 'tl-row' + (row.hasChildren ? ' summary' : '') + (row.linked ? ' linked' : '') +
        (selected.has(row.task.id) ? ' selected' : '');
      return '<div class="' + cls + '" style="top:' + (i * ROW_H) + 'px" data-task-id="' + row.task.id + '"></div>';
    }).join('');
    // Only an actually empty outline is "no tasks yet": a plan whose own task
    // list is empty but that shows referenced blocks still has rows to draw,
    // so the empty hint must not sit on top of them.
    const hasLinks = (project.linkedProjects || []).length > 0;
    const empty = rows.length === 0
      ? ((project.tasks.length || hasLinks)
        ? '<div class="tl-empty">No tasks match the current search or filter.</div>'
        : '<div class="tl-empty">No tasks yet — use <b>Add task</b> or open a sample tab.</div>')
      : '';

    const endIso = fillEnd(m);
    canvas.style.width = headWidth(m) + 'px';
    canvas.style.height = height + 'px';
    canvas.innerHTML =
      backgroundHtml(project, m, endIso) +
      '<div class="tl-rows" style="height:' + (rows.length * ROW_H) + 'px">' + rowHtml + '</div>' +
      linksHtml(project, rows, m, height) +
      barsHtml(project, rows, m, selected) +
      todayLine(project, m) +
      empty;

    renderTimelineHead(project, m);
    applyScrollFromTab();
  }

  // Incremental hooks. A full pass rebuilds every row's markup, which costs
  // about 150ms on a 400-row plan even when nothing structural changed. The
  // cheap path keeps the nodes and only rewrites what moved: the selection
  // classes, and (after an inline edit) the single cell that was edited.
  let lastSignature = '';
  let pendingCell = null;

  function invalidate() { lastSignature = ''; }

  // Everything that changes which rows exist, how they are shaped or what the
  // grid looks like. Anything missing here would show as stale markup, so the
  // list stays deliberately broad.
  function structureSignature(project, rows, layout) {
    return [
      Store.active() ? Store.active().id : '',
      rows.length,
      layout.total,
      layout.template,
      project.view.zoom || 'day',
      search, filter, resourceFilter,
      project.view.showBaselineBars ? 1 : 0,
      project.view.showActualBars ? 1 : 0,
      project.view.showCriticalPath ? 1 : 0,
      project.view.showLinks ? 1 : 0,
      Math.round(Number(Store.settings().planZoom) || 100),
      Math.round(paneWidth())
    ].join('|');
  }

  function paneWidth() {
    const scroll = $('timelineScroll');
    return scroll ? scroll.clientWidth : 0;
  }

  // Marks one cell for an in-place refresh after the next render pass.
  function touchCell(taskId, key) { pendingCell = { taskId, key }; }

  function refreshCell(taskId, key) {
    const tab = Store.active();
    if (!tab) return false;
    const project = tab.project;
    const rows = rowsFor(project);
    const idx = rows.findIndex((r) => r.task.id === taskId);
    if (idx < 0) return false;
    const layout = columnsFor(project);
    const ci = layout.cols.findIndex((c) => c.key === key);
    if (ci < 0) return false;
    const row = document.querySelector('#taskRows .task-row[data-task-id="' + taskId + '"]');
    if (!row || !row.children[ci]) return false;
    row.children[ci].outerHTML = cellHtml(layout.cols[ci], rows[idx].task, rows[idx], project);
    const fresh = document.querySelector('#taskRows .task-row[data-task-id="' + taskId + '"]');
    if (fresh && fresh.children[ci]) fresh.children[ci].dataset.colKey = key;
    return true;
  }

  // ---------- master plan builders ----------
  // The overview shows every project under one date axis. Rather than invent a
  // second renderer, these helpers expose the planner's own pieces: the outline
  // columns, the row markup, the bars and the ruler. A master row is just a
  // planner row rendered against a shared scale.
  function masterLayout() {
    // Column set and widths come from the first project, so the master plan
    // matches whatever the user configured in their plans.
    const first = Store.active() ? Store.active().project : null;
    return first ? columnsFor(first) : columnsFor(Model.blankProject('project'));
  }

  function masterMetrics(range, width) {
    const days = Math.max(1, U.diffDays(range.start, range.end) + 1);
    const m = {
      zoom: 'day',
      scale: 1,
      px: Math.max(0.12, Number(width) / days),
      range: { start: range.start, end: range.end, days: days },
      width: 0
    };
    m.width = m.range.days * m.px;
    // Fill a little past the last day so the final bar is not clipped.
    m.endIso = U.addDays(range.end, 1);
    return m;
  }

  function masterHead(layout, m) {
    return '<div class="task-head-row" style="width:' + layout.total + 'px;grid-template-columns:' + layout.template + '">' +
      layout.cols.map((c) => '<div class="task-head-cell' + (CENTER_COLUMNS.has(c.key) ? ' center' : '') +
        '" data-col-key="' + c.key + '" title="' + U.escapeHtml(c.label) + '">' +
        '<span>' + U.escapeHtml(String(c.label).toUpperCase()) + '</span></div>').join('') +
      '</div>';
  }

  // The two-band date ruler, borrowed from the timeline header.
  function masterRuler(m) {
    const top = monthSegments(m.range.start, m.endIso, m.px);
    const bottom = daySegments(m.range.start, m.endIso, m.px, null);
    return '<div class="th-band th-top">' + top + '</div><div class="th-band th-bottom">' + bottom + '</div>';
  }

  // The working-day shading for one project, sized to the shared axis. The
  // master plan is neutral about weekends, but each row is still drawn with the
  // calendar of the plan it belongs to.
  function masterShade(project, m) {
    const cal = Model.calendarFor(project, null);
    const hs = U.holidaySet(cal);
    const out = [];
    const days = Math.max(1, m.range.days);
    const px = m.width / days;
    for (let i = 0; i < days; i++) {
      const iso = U.addDays(m.range.start, i);
      if (U.isWorkingDay(iso, cal, hs)) continue;
      out.push('<i style="position:absolute;left:' + (i * px) + 'px;top:0;bottom:0;width:' + px +
        'px;background:var(--nonwork)"></i>');
    }
    return out.join('');
  }

  function masterRow(layout, project, task, row, m, opts) {
    const t = task;
    const isLate = t.status === 'late' || (t.end && U.diffDays(t.end, U.todayISO()) > 0 && (t.percentComplete || 0) < 100);
    const cls = 'task-row' + (row.hasChildren ? ' summary' : '') + (isLate ? ' late' : '') +
      (opts && opts.cls ? ' ' + opts.cls : '');
    return '<div class="' + cls + '" data-task-id="' + U.escapeHtml(t.id) + '" style="width:' + layout.total +
      'px;grid-template-columns:' + layout.template + '">' +
      layout.cols.map((c) => cellHtml(c, t, row, project)).join('') + '</div>';
  }

  // A bar drawn against the shared axis. `summary` renders the planner's parent
  // rail (no caps, no progress fill) instead of a task capsule.
  function masterBar(project, task, m, summary) {
    const isMs = task.type === 'milestone';
    const startLeft = leftFor(m, task.start);
    const endLeft = leftFor(m, task.end || task.start);
    const box = barBox(project, task, m, startLeft, endLeft, isMs);
    const pct = U.clamp(Number(task.percentComplete) || 0, 0, 100);
    const colour = summary ? (task.color || milestoneColour(project))
      : isMs ? milestoneColour(project) : barColour(project, task);
    const cls = 'gbar' + (summary ? ' summary' : '') + (isMs ? ' milestone' : '');
    const fillCls = pct >= 100 ? 'fill full' : 'fill';
    const pctLabel = (!isMs && (pct > 0 || summary))
      ? '<span class="bar-progress-label' + (summary ? ' summary' : '') + '">' + pct + '%</span>' : '';
    const style = 'left:' + box.left + 'px;top:' + (summary ? 9 : PLAN_TOP) + 'px;width:' +
      (summary || isMs ? box.width : Math.max(6, box.width)) + 'px' +
      (colour ? ';background-color:' + U.escapeHtml(colour) + ';border-color:' + U.escapeHtml(colour) : '') +
      (summary ? ';--sum-fill:' + U.escapeHtml(colour) : '');
    return '<div class="' + cls + '" data-task-id="' + U.escapeHtml(task.id) +
      '" data-project="' + U.escapeHtml(project.id || '') + '" style="' + style + '" title="' +
      U.escapeHtml(task.name + '  \u00b7  ' + U.fmtDate(task.start, 'dd-mmm-yy') + ' \u2192 ' +
        U.fmtDate(task.end || task.start, 'dd-mmm-yy')) + '">' +
      (isMs || summary ? '' : '<div class="' + fillCls + '" style="width:' + pct + '%"></div>') + pctLabel + '</div>';
  }

  // Render one project into a caller-provided set of containers. Used by the
  // master plan so it draws with exactly the planner's markup and geometry.
  function mount(project, refs, range) {
    if (!project || !refs) return null;
    const layout = columnsFor(project);
    const width = Math.max(240, refs.width || 600);
    const span = range || metrics(project).range;
    const m = masterMetrics(span, width);
    if (refs.head) renderTaskHead(project, refs.head);
    renderTaskRows(project, rowsFor(project), layout, refs.rows);
    renderTimeline(project, rowsFor(project), refs.canvas);
    if (refs.headScale) {
      const scale = refs.headScale;
      scale.innerHTML = '<div class="th-band th-top">' + monthSegments(m.range.start, m.endIso, m.px) +
        '</div><div class="th-band th-bottom">' + daySegments(m.range.start, m.endIso, m.px, Model.calendarFor(project, null)) +
        '</div>';
      scale.style.width = m.width + 'px';
    }
    return { layout: layout, m: m };
  }

  // A native date picker keeps focus (and the popup) to itself, so clicking
  // elsewhere often never fires blur: the cell stayed an input forever. This
  // commits and removes the editor on any pointer press outside it, whatever
  // the blur did or did not do.
  // Ending an edit must never leave the input behind. commitEdit can bail out
  // early on a failed validation (an empty date, a finish before the start, an
  // empty progress) and used to keep `editing` alive, so the cell stayed an
  // input for good — that is what happened to every column, not just dates.
  // Ending an edit always ends it. The old code trusted commitEdit to clean up,
  // but every validation failure returned early and left the input mounted, so
  // the cell stayed in edit mode for good. Now: try to commit, then detach the
  // editor and repaint no matter what the commit decided.
  function endEdit() {
    if (!editing) return;
    const state = editing;
    let ok = true;
    try { ok = commitEdit('none'); } catch (err) { ok = false; }
    // commitEdit already detaches and repaints when it accepts the value. When
    // it refuses (or throws), this is the last chance to close the editor —
    // otherwise the input stays mounted and every later repaint starts another.
    if (ok === false || editing === state) {
      state.done = true;
      if (state.editor && state.editor.parentNode) state.editor.parentNode.removeChild(state.editor);
      if (editing === state) editing = null;
      invalidate();
      render();
    }
  }

  // A value the model will not take: say why, then close the editor anyway.
  function refuseEdit(message) {
    U.toast(message, 'warn');
    const state = editing;
    editing = null;
    if (state) {
      state.done = true;
      if (state.editor && state.editor.parentNode) state.editor.parentNode.removeChild(state.editor);
    }
    invalidate();
    render();
    return false;
  }

  function bindOutsideCommit() {
    if (boundOutside) return;
    boundOutside = true;
    document.addEventListener('mousedown', (e) => {
      if (!editing || editing.done) return;
      const el = e.target;
      if (el === editing.editor || (editing.cell && editing.cell.contains(el))) return;
      // A press inside a native date picker can surface as the input itself.
      if (el && el.tagName === 'INPUT' && el.type === 'date') return;
      endEdit();
    }, true);
  }

  function render() {
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    const pane = $('taskPane');
    if (pane) {
      // Keep the outline wide enough for its columns without crowding out the
      // timeline on smaller windows.
      const wanted = U.clamp(Number(Store.settings().gridPaneWidth) || 700, 260, 900);
      const ceiling = Math.max(260, Math.min(900, Math.round(window.innerWidth * 0.7)));
      pane.style.flexBasis = U.clamp(wanted, 260, ceiling) + 'px';
    }
    const rows = rowsFor(project);
    const layout = columnsFor(project);
    const signature = structureSignature(project, rows, layout);
    const sameStructure = signature === lastSignature && !!$('taskRows').querySelector('.task-row[data-task-id], .empty-row');
    if (sameStructure && !pendingCell) {
      // Nothing structural moved: keep every node and repaint the highlights.
      paintSelection();
      paintZoomLabel();
      return;
    }
    if (sameStructure && pendingCell) {
      // One cell changed: rebuild that cell and leave the other 399 alone. If it
      // cannot be patched (the row disappeared, the key is gone) fall through to
      // the full pass rather than leave stale markup on screen.
      const cell = pendingCell;
      pendingCell = null;
      const patched = refreshCell(cell.taskId, cell.key);
      paintSelection();
      paintZoomLabel();
      if (patched) return;
    }
    pendingCell = null;
    lastSignature = signature;
    renderTaskHead(project);
    renderTaskRows(project, rows, layout);
    renderTimeline(project, rows);
    alignPaneHeights();
    document.querySelectorAll('#zoomButtons button').forEach((b) => {
      b.classList.toggle('active', b.dataset.zoom === (project.view.zoom || 'day'));
    });
    paintZoomLabel();
  }

  // The panes share one vertical scroll, so their content has to end at the
  // same place. The canvas used to carry a fixed extra padding that the grid
  // did not have, which let the timeline keep scrolling after the grid had
  // stopped and pushed the bars a few rows out of line.
  function alignPaneHeights() {
    const grid = $('taskRows');
    const canvas = $('timelineCanvas');
    if (!grid || !canvas) return;
    const want = grid.scrollHeight;
    if (want > 0 && canvas.style.height !== want + 'px') canvas.style.height = want + 'px';
  }

  // ---------- scroll sync ----------
  function updateScrollFromTab() {
    // intentionally empty: kept for callers that want a light refresh
  }

  function applyScrollFromTab() {
    const tab = Store.active();
    const scroll = $('timelineScroll');
    const rows = $('taskRows');
    if (!tab || !scroll) return;
    syncing = true;
    scroll.scrollLeft = tab.scrollLeft || 0;
    scroll.scrollTop = tab.scrollTop || 0;
    if (rows) {
      rows.scrollTop = tab.scrollTop || 0;
      rows.scrollLeft = tab.gridScrollLeft || 0;
    }
    const head = $('timelineHead');
    if (head) head.style.transform = 'translateX(' + (-(tab.scrollLeft || 0)) + 'px)';
    const inner = document.querySelector('#taskHead .task-head-row');
    if (inner) inner.style.transform = 'translateX(' + (-(tab.gridScrollLeft || 0)) + 'px)';
    syncing = false;
  }

  function saveScroll(x, y) {
    const tab = Store.active();
    if (!tab) return;
    tab.scrollLeft = Math.max(0, Math.round(x));
    tab.scrollTop = Math.max(0, Math.round(y));
    Store.persist();
  }

  function onTimelineScroll() {
    if (syncing) return;
    const scroll = $('timelineScroll');
    if (!scroll) return;
    const x = scroll.scrollLeft, y = scroll.scrollTop;
    syncing = true;
    const head = $('timelineHead');
    if (head) head.style.transform = 'translateX(' + (-x) + 'px)';
    const rows = $('taskRows');
    if (rows) rows.scrollTop = y;
    syncing = false;
    saveScroll(x, y);
  }

  function onGridScroll() {
    if (syncing) return;
    const rows = $('taskRows');
    if (!rows) return;
    const x = rows.scrollLeft, y = rows.scrollTop;
    syncing = true;
    const scroll = $('timelineScroll');
    if (scroll) scroll.scrollTop = y;
    const inner = document.querySelector('#taskHead .task-head-row');
    if (inner) inner.style.transform = 'translateX(' + (-x) + 'px)';
    syncing = false;
    const tab = Store.active();
    if (tab) { tab.gridScrollLeft = Math.max(0, Math.round(x)); }
    saveScroll(scroll ? scroll.scrollLeft : 0, y);
  }

  // ---------- selection ----------
  // Selecting a task used to rebuild the whole timeline. Only two classes carry
  // the highlight, so repaint those in place and leave the markup alone.
  function paintSelection() {
    const sel = selectionSet();
    document.querySelectorAll('#taskRows .task-row[data-task-id]').forEach((row) => {
      row.classList.toggle('selected', sel.has(row.dataset.taskId));
    });
    // The timeline mirrors the grid row for row; without this the right pane
    // only caught up on the next full redraw, which is why a click looked like
    // it waited for the edited cell to blur.
    document.querySelectorAll('#timelineCanvas .tl-row[data-task-id]').forEach((row) => {
      row.classList.toggle('selected', sel.has(row.dataset.taskId));
    });
    // Only the plan bar carries the active outline. The baseline and actual
    // rails are separate bars sharing the same task id, and outlining a 3px
    // rail turns it into a hollow box that reads as a second selection.
    document.querySelectorAll('.tl-bars .gbar[data-task-id]').forEach((bar) => {
      if (bar.classList.contains('baseline') || bar.classList.contains('actual')) {
        if (bar.classList.contains('bar-active')) bar.classList.remove('bar-active');
        return;
      }
      const on = !!activeBarId && bar.dataset.taskId === activeBarId && !bar.classList.contains('summary');
      bar.classList.toggle('bar-active', on);
    });
  }

  function clearActiveBar() {
    if (!activeBarId) return;
    activeBarId = null;
    document.querySelectorAll('.gbar.bar-active').forEach((el) => el.classList.remove('bar-active'));
    document.querySelectorAll('.tl-links path.hot').forEach((p) => p.classList.remove('hot'));
  }

  function selectTask(id, ev) {
    const tab = Store.active();
    if (!tab) return;
    const current = Store.selection().slice();
    if (ev && ev.shiftKey) {
      const rows = rowsFor(tab.project);
      const ids = rows.map((r) => r.task.id);
      const anchor = lastSelected && ids.includes(lastSelected) ? lastSelected : (current[0] || id);
      const a = ids.indexOf(anchor), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        Store.setSelection(range);
        lastSelected = id;
        return;
      }
    }
    if (ev && (ev.ctrlKey || ev.metaKey)) {
      if (current.includes(id)) Store.setSelection(current.filter((x) => x !== id));
      else Store.setSelection(current.concat(id));
    } else {
      Store.setSelection([id]);
    }
    lastSelected = id;
  }

  // ---------- drag ----------
  function startDrag(bar, mode, ev) {
    const tab = Store.active();
    if (!tab) return;
    const rowId = bar.dataset.taskId;
    // A referenced bar belongs to another plan: drag it there, not here.
    const linkedOwner = Model.getTask(tab.project, rowId) ? null : ownerProjectOfRow(rowId);
    const project = linkedOwner || tab.project;
    const taskId = realTaskId(rowId);
    const task = Model.getTask(project, taskId);
    if (!task) return;
    // One writer for every drag gesture, whichever plan the task lives in.
    const write = (fn) => {
      if (linkedOwner) {
        Store.mutateProject(linkedOwner.id, (p) => fn(p), { history: true, silent: true });
        return;
      }
      Store.mutate((p) => fn(p));
    };
    activeBarId = rowId;
    bar.classList.add('bar-active');
    const m = metrics(project);
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const cal = Model.calendarFor(project, task);
    const oldDur = Model.durationDays(project, task) || 1;
    const hpd = Number(project.hoursPerDay) || 8;
    const hourPx = m.px / 24;
    const oldHours = oldDur * hpd;
    const hourResize = m.zoom === 'hour' && mode === 'right' && oldDur < 1.0001;
    const origLeft = parseFloat(bar.style.left) || 0;
    const origStart = task.start;
    const origEnd = task.end || task.start;
    const startX = ev.clientX;
    let moved = false;
    let dragPercent = null;
    document.body.style.userSelect = 'none';

    // Resize targets are dates, not pixels: previewing the exact dates that
    // will be committed means the edge never overshoots the pointer when the
    // drag crosses a weekend or a holiday.
    const resizeTarget = (deltaDays) => {
      if (mode === 'left') {
        let startIso = U.addDays(origStart, deltaDays);
        let dur = U.workingDaysBetween(startIso, origEnd, cal);
        if (dur < 1) {
          // The pointer went past the finish: keep a one-day task.
          startIso = U.subWorkingDays(origEnd, 1, cal);
          dur = 1;
        }
        return { startIso, endIso: U.endFromDuration(startIso, dur, cal), dur };
      }
      let endIso = U.addDays(origEnd, deltaDays);
      if (U.diffDays(origStart, endIso) < 0) endIso = origStart;
      const dur = Math.max(1, U.workingDaysBetween(origStart, endIso, cal));
      return { startIso: origStart, endIso: U.endFromDuration(origStart, dur, cal), dur };
    };

    const onMove = (e) => {
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      let delta = Math.round(dx / m.px);
      const hourDelta = Math.round(dx / Math.max(1, hourPx));
      const snapped = delta * m.px;
      let target = null;
      if (mode === 'right' && hourResize) {
        const hours = Math.max(0.5, oldHours + hourDelta);
        bar.style.width = Math.max(4, hours * hourPx) + 'px';
      } else if (mode === 'left') {
        target = resizeTarget(delta);
        const l = leftFor(m, target.startIso);
        const r = leftFor(m, target.endIso) + m.px;
        bar.style.left = l + 'px';
        bar.style.width = Math.max(m.px * 0.75, r - l) + 'px';
      } else if (mode === 'right') {
        target = resizeTarget(delta);
        bar.style.width = Math.max(m.px * 0.75, leftFor(m, target.endIso) + m.px - leftFor(m, origStart)) + 'px';
      } else if (mode === 'progress') {
        const rect = bar.getBoundingClientRect();
        dragPercent = U.clamp(Math.round((e.clientX - rect.left) / Math.max(1, rect.width) * 100), 0, 100);
        const fill = bar.querySelector('.fill');
        if (fill) fill.style.width = dragPercent + '%';
      } else {
        bar.style.left = (origLeft + snapped) + 'px';
      }
      if (!moved) return;
      if (mode === 'move') {
        showGhost(e, U.fmtDate(U.addDays(task.start, delta), fmt) + ' → ' +
          U.fmtDate(U.addDays(task.end || task.start, delta), fmt) + (delta ? '  (' + (delta > 0 ? '+' : '') + delta + 'd)' : ''));
      } else if (mode === 'left' && target) {
        showGhost(e, U.fmtDate(target.startIso, fmt) + ' · ' + target.dur + 'd');
      } else if (mode === 'right' && hourResize) {
        const hours = Math.max(0.5, oldHours + hourDelta);
        showGhost(e, hours + 'h');
      } else if (mode === 'right' && target) {
        showGhost(e, U.fmtDate(target.endIso, fmt) + ' · ' + target.dur + 'd');
      } else if (mode === 'progress' && dragPercent != null) {
        showGhost(e, dragPercent + '% complete');
      }
    };

    const onUp = (e) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      hideGhost();
      if (!moved) return;
      suppressClickUntil = Date.now() + 350;
      const dx = e.clientX - startX;
      let delta = Math.round(dx / m.px);
      if (mode === 'progress') {
        if (dragPercent == null) return;
        write((p) => {
          const t = Model.getTask(p, taskId);
          if (!t) return;
          t.percentComplete = dragPercent;
          if (dragPercent > 0 && !t.actualStart) t.actualStart = t.start;
          if (dragPercent >= 100 && !t.actualEnd) t.actualEnd = t.end;
        });
        return;
      }
      if (mode === 'right' && hourResize) {
        const hourDelta = Math.round(dx / Math.max(1, hourPx));
        const hours = Math.max(0.5, oldHours + hourDelta);
        if (hours !== oldHours) {
          write((p) => {
            const t = Model.getTask(p, taskId);
            if (!t || t.type === 'milestone') return;
            t.duration = U.round(hours, 2);
            t.durationUnit = 'h';
            t.manual = true;
          });
        }
      } else if (mode === 'left') {
        const target = resizeTarget(delta);
        if (target.startIso !== origStart) {
          write((p) => {
            const t = Model.getTask(p, taskId);
            if (!t || t.type === 'milestone') return;
            t.start = target.startIso;
            Model.setDurationFromDays(p, t, target.dur);
            t.manual = true;
          });
        }
      } else if (mode === 'right') {
        const target = resizeTarget(delta);
        if (target.dur !== Math.round(oldDur)) {
          write((p) => {
            const t = Model.getTask(p, taskId);
            if (!t || t.type === 'milestone') return;
            Model.setDurationFromDays(p, t, target.dur);
            t.manual = true;
          });
        }
      } else if (mode === 'move' && delta !== 0) {
        write((p) => {
          const t = Model.getTask(p, taskId);
          if (!t) return;
          const list = Model.hasChildren(p, taskId) ? Model.subtreeTasks(p, taskId) : [t];
          list.forEach((x) => {
            x.start = U.addDays(x.start, delta);
            if (x.end) x.end = U.addDays(x.end, delta);
            x.manual = true;
          });
        });
      } else {
        Store.setSelection([rowId]);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // Where a new link goes. Both ends of a link have to sit in the same plan, so
  // a referenced row is translated back to its real task in its own project.
  // Two local rows stay local; a referenced pair is written to the referenced
  // plan; a mixed pair is not supported (there is no cross-plan dependency) and
  // is reported instead of being stored under ids the plan cannot resolve.
  function dependencyTarget(project, fromId, toId) {
    const localFrom = !!Model.getTask(project, fromId);
    const localTo = !!Model.getTask(project, toId);
    if (localFrom && localTo) return { project: project, from: fromId, to: toId };
    const ownerFrom = localFrom ? null : ownerProjectOfRow(fromId);
    const ownerTo = localTo ? null : ownerProjectOfRow(toId);
    if (!ownerFrom || ownerFrom !== ownerTo) return null;
    return { project: ownerFrom, from: realTaskId(fromId), to: realTaskId(toId) };
  }

  function createDependency(project, fromId, toId, type) {
    const target = dependencyTarget(project, fromId, toId);
    if (!target) {
      U.toast('Both ends of a dependency must be in the same plan', 'warn');
      return null;
    }
    let link = null;
    if (target.project === project) {
      Store.mutate((p) => { link = Model.addLink(p, target.from, target.to, type); });
    } else {
      // Another plan's tab owns the undo history for its own tasks.
      const entry = Store.allProjects().find((e) => e.project === target.project);
      if (!entry) return null;
      Store.mutateProject(entry.id, (p) => { link = Model.addLink(p, target.from, target.to, type); }, { history: true, silent: true });
      Store.saveNow();
    }
    return link;
  }

  function startLinkDrag(bar, ev, side) {
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    const sourceId = bar.dataset.taskId;
    const canvas = $('timelineCanvas');
    if (!canvas) return;
    const sourceEnd = side === 'left' ? 'start' : 'finish';
    const rect = canvas.getBoundingClientRect();
    const svgNS = 'http://www.w3.org/2000/svg';
    let overlay = document.querySelector('.tl-link-drag');
    if (!overlay) {
      overlay = document.createElementNS(svgNS, 'svg');
      overlay.setAttribute('class', 'tl-link-drag');
      canvas.appendChild(overlay);
    }
    overlay.setAttribute('width', canvas.offsetWidth);
    overlay.setAttribute('height', canvas.offsetHeight);
    overlay.style.width = canvas.offsetWidth + 'px';
    overlay.style.height = canvas.offsetHeight + 'px';
    overlay.innerHTML = '';
    const path = document.createElementNS(svgNS, 'path');
    overlay.appendChild(path);
    const barRect = bar.getBoundingClientRect();
    const sx = (sourceEnd === 'start' ? barRect.left : barRect.right) - rect.left;
    const sy = barRect.top + barRect.height / 2 - rect.top;

    // Link type is decided by the source end (start / finish) and the end of the
    // target bar that the pointer is released over.
    const typeFor = (targetEnd) => {
      if (sourceEnd === 'finish') return targetEnd === 'start' ? 'FS' : 'FF';
      return targetEnd === 'start' ? 'SS' : 'SF';
    };

    let target = null;
    let dropEnd = 'start';
    let dropType = typeFor('start');
    const badge = document.createElement('div');
    badge.className = 'tl-link-type';
    badge.textContent = dropType;
    badge.style.display = 'none';
    document.body.appendChild(badge);

    const clearTarget = () => {
      canvas.querySelectorAll('.gbar.link-target').forEach((x) => x.classList.remove('link-target', 'link-start', 'link-finish'));
    };
    const onMove = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const tb = el && el.closest ? el.closest('.gbar[data-task-id]') : null;
      const id = tb ? tb.dataset.taskId : null;
      clearTarget();
      target = (id && id !== sourceId && !Model.hasChildren(project, id)) ? id : null;
      if (target && tb) {
        const tr = tb.getBoundingClientRect();
        dropEnd = e.clientX <= tr.left + tr.width / 2 ? 'start' : 'finish';
        dropType = typeFor(dropEnd);
        const tx = ((dropEnd === 'start' ? tr.left : tr.right) - rect.left);
        const ty = tr.top + tr.height / 2 - rect.top;
        path.setAttribute('d', linkPath(sx, sy, tx, ty, sourceEnd, dropEnd));
        tb.classList.add('link-target');
        tb.classList.add(dropEnd === 'start' ? 'link-start' : 'link-finish');
        badge.textContent = dropType;
        badge.style.display = 'block';
        badge.style.left = (e.clientX + 14) + 'px';
        badge.style.top = (e.clientY - 10) + 'px';
      } else {
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        path.setAttribute('d', 'M ' + sx + ' ' + sy + ' L ' + x + ' ' + sy + ' L ' + x + ' ' + y);
        badge.style.display = 'none';
      }
      e.preventDefault();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      clearTarget();
      if (overlay) overlay.remove();
      if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
      document.body.style.userSelect = '';
      if (!target) return;
      const type = typeFor(dropEnd);
      const link = createDependency(project, sourceId, target, type);
      if (!link) {
        U.toast('That dependency would create a loop or already exists', 'warn');
        return;
      }
      U.toast(type + ' dependency created', 'ok', 1400);
      invalidate();
      render();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.userSelect = 'none';
    ev.preventDefault();
    ev.stopPropagation();
  }

  function addTaskAt(iso, type) {
    const tab = Store.active();
    if (!tab) return;
    let id = null;
    Store.mutate((p) => {
      const t = Model.addTask(p, { start: iso, type: type || 'task' });
      id = t.id;
    });
    if (id) {
      Store.setSelection([id]);
      Dialogs.task(id);
    }
  }

  // Actions for a referenced block: open the source, or drop the reference.
  function referenceMenuItems(projectId) {
    const tab = Store.active();
    const entry = Store.allProjects().find((p) => p.id === projectId);
    const name = entry ? entry.project.name : 'this project';
    // Both actions work on the whole block: a reference is one project-wide
    // fact, so it is removed for every task at once — never task by task.
    return [
      { label: 'Open ' + name + '\u2026', action: () => { if (projectId) Store.openProject(projectId); } },
      { sep: true },
      {
        label: 'Remove reference',
        action: () => {
          if (!tab || !projectId) return;
          // The row carries the resolved entry id (a tab id or a shelf id),
          // while the stored link may hold the project's own id. Resolve each
          // link before comparing so removal works for both shapes.
          Store.mutateProject(tab.id, (p) => {
            p.linkedProjects = Model.normalizeLinks(p.linkedProjects).filter((link) => {
              const entry = Model.resolveLinkProject(link, Store.allProjects());
              return !(entry && entry.id === projectId);
            });
          });
          U.toast('Removed ' + name + ' from this plan', 'ok');
        }
      }
    ];
  }

  // Outline commands act on every selected row when the menu was opened on one
  // of them; a right-click outside the selection only moves that single row.
  function outlineTargets(taskId) {
    const sel = Store.selection();
    return sel.includes(taskId) ? sel : [taskId];
  }

  function taskMenuItems(taskId) {
    const tab = Store.active();
    if (!tab) return [];
    const task = Model.getTask(tab.project, taskId);
    if (!task) return [];
    return [
      { label: 'Edit task…', action: () => Dialogs.task(taskId) },
      {
        label: 'Add task below', action: () => {
          let id = null;
          Store.mutate((p) => { const t = Model.addTask(p, { refId: taskId }); id = t.id; });
          if (id) Store.setSelection([id]);
        }
      },
      {
        label: 'Add subtask', action: () => {
          let id = null;
          Store.mutate((p) => {
            const t = Model.addTask(p, { refId: taskId });
            t.parentId = taskId;
            t.start = task.start;
            id = t.id;
          });
          if (id) Store.setSelection([id]);
        }
      },
      {
        label: 'Duplicate task', action: () => {
          let id = null;
          Store.mutate((p) => { const c = Model.duplicateTask(p, taskId); if (c) id = c.id; });
          if (id) Store.setSelection([id]);
        }
      },
      {
        label: 'Delete task…', action: () => {
          Dialogs.confirm('Delete task', 'Delete "' + task.name + '" and its subtasks? Attached dependencies are removed too.', { okLabel: 'Delete' })
            .then((ok) => {
              if (!ok) return;
              Store.mutate((p) => Model.deleteTask(p, taskId));
              Store.setSelection([]);
              U.toast('Task deleted', 'ok');
            });
        }
      },
      { sep: true },
      {
        label: 'Indent', action: () => {
          let ok = false;
          Store.mutate((p) => { ok = Model.batchIndent(p, outlineTargets(taskId)); });
          if (!ok) U.toast('Cannot indent this task here', 'warn');
        }
      },
      {
        label: 'Outdent', action: () => {
          let ok = false;
          Store.mutate((p) => { ok = Model.batchOutdent(p, outlineTargets(taskId)); });
          if (!ok) U.toast('Cannot outdent this task here', 'warn');
        }
      },
      { sep: true },
      {
        label: task.type === 'milestone' ? 'Convert to task' : 'Convert to milestone', action: () => {
          Store.mutate((p) => {
            const t = Model.getTask(p, taskId);
            if (!t) return;
            if (t.type === 'milestone') {
              t.type = 'task';
              t.duration = 1;
              t.durationUnit = 'd';
            } else {
              t.type = 'milestone';
              t.duration = 0;
              t.end = t.start;
            }
            t.manual = true;
          });
        }
      }
    ];
  }

  // Gantt bar right-click: compact colour panel with swatches + link cleanup.
  const BAR_SWATCHES = ['#3b82f6', '#0e7490', '#2f8f6a', '#65a30d', '#d68a23', '#ea580c',
    '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#64748b', '#1f2937'];

  function cssColour(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function openBarColourPanel(e, taskId) {
    const tab = Store.active();
    if (!tab) return;
    // A referenced bar lives in its own plan: colours are read and written
    // there, exactly like its cells.
    const owner = Model.getTask(tab.project, taskId) ? null : ownerProjectOfRow(taskId);
    const project = owner || tab.project;
    const realId = owner ? realTaskId(taskId) : taskId;
    const task = Model.getTask(project, realId);
    if (!task) return;
    // One writer for both cases: a local edit stays on this tab's undo stack, a
    // referenced edit goes to the plan that owns it and is saved at once.
    const write = (fn) => {
      if (!owner) { Store.mutate((p) => fn(p, realId)); return; }
      const entry = Store.allProjects().find((x) => x.project === owner);
      if (!entry) return;
      Store.mutateProject(entry.id, (p) => fn(p, realId), { history: true, silent: true });
      Store.saveNow();
      invalidate();
      render();
    };
    const summary = Model.hasChildren(project, realId);
    const milestone = task.type === 'milestone';
    const barCurrent = task.color ||
      (summary ? cssColour('--summary', '#284f79') : cssColour('--bar', '#4d86c9'));
    const progCurrent = task.progressColor || cssColour('--bar-progress', '#9cc4ee');
    const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
    const grid = (current, kind) =>
      '<div class="bcm-grid">' + BAR_SWATCHES.map((c) =>
        '<button class="bcm-swatch' + (same(c, current) ? ' active' : '') + '" data-bcm-kind="' + kind +
        '" data-bcm-colour="' + c + '" style="background:' + c + '" title="' + c + '"></button>').join('') + '</div>';
    const actions = (current, kind) =>
      '<div class="bcm-actions">' +
      '<button class="bcm-default" data-bcm-default="' + kind + '">Default</button>' +
      '<button class="bcm-more" data-bcm-more="' + kind + '">More colours…' +
      '<span class="bcm-chip" style="background:' + U.escapeHtml(current) + '"></span></button></div>';
    const html =
      '<div class="bar-colour-menu">' +
      '<div class="bcm-title">' +
        (summary ? 'Parent bar colour' : (milestone ? 'Milestone colour' : 'Bar colour')) + '</div>' +
      grid(barCurrent, 'bar') + actions(barCurrent, 'bar') +
      (!summary && !milestone ?
        '<div class="bcm-title">Progress colour</div>' +
        grid(progCurrent, 'progress') + actions(progCurrent, 'progress') : '') +
      '<button class="bcm-remove" data-bcm-remove="1">Remove all links from this task</button>' +
      '</div>';

    App.openMenuHtml(e, html, (panel) => {
      panel.querySelectorAll('[data-bcm-colour]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const kind = btn.dataset.bcmKind;
          const colour = btn.dataset.bcmColour;
          write((p, id) => {
            const t = Model.getTask(p, id);
            if (!t) return;
            if (kind === 'bar') t.color = colour;
            else t.progressColor = colour;
          });
          U.toast(kind === 'bar' ? 'Bar colour updated' : 'Progress colour updated', 'ok', 1200);
        });
      });
      panel.querySelectorAll('[data-bcm-default]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const kind = btn.dataset.bcmDefault;
          write((p, id) => {
            const t = Model.getTask(p, id);
            if (!t) return;
            if (kind === 'bar') t.color = null;
            else t.progressColor = null;
          });
          U.toast(kind === 'bar' ? 'Default bar colour' : 'Default progress colour', 'ok', 1200);
        });
      });
      panel.querySelectorAll('[data-bcm-more]').forEach((btn) => {
        btn.addEventListener('click', () => {
          Dialogs.colours([taskId], { focus: btn.dataset.bcmMore });
        });
      });
      const remove = panel.querySelector('[data-bcm-remove]');
      if (remove) {
        remove.addEventListener('click', () => {
          write((p, id) => {
            p.links = p.links.filter((l) => l.from !== id && l.to !== id);
            Model.reschedule(p);
          });
          U.toast('All links removed', 'ok');
        });
      }
    });
  }

  const LINK_TYPES = { FS: 'Finish to start', SS: 'Start to start', FF: 'Finish to finish', SF: 'Start to finish' };

  // Which plan a drawn dependency belongs to: this one, or one of the plans
  // referenced here (its block shows its own links).
  function linkOwner(project, linkId) {
    if ((project.links || []).some((l) => l.id === linkId)) return { project: project, entry: null };
    const links = project.linkedProjects || [];
    for (let i = 0; i < links.length; i++) {
      const entry = Model.resolveLinkProject(links[i], Store.allProjects());
      if (entry && (entry.project.links || []).some((l) => l.id === linkId)) return { project: entry.project, entry: entry };
    }
    return null;
  }

  // Run a change against the plan that owns a dependency.
  function writeLink(project, linkId, fn) {
    const owner = linkOwner(project, linkId);
    if (!owner) return;
    if (!owner.entry) { Store.mutate((p) => fn(p)); return; }
    Store.mutateProject(owner.entry.id, (p) => fn(p), { history: true, silent: true });
    Store.saveNow();
    invalidate();
    render();
  }

  function openLinkMenu(e, linkId) {
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    if (!linkOwner(project, linkId)) return;
    const html = '<div class="dropdown">' +
      '<button class="mi" data-link-remove="1"><span class="mi-icon"></span>' +
      '<span class="mi-label">Remove link</span><span class="mi-key"></span></button>' +
      Object.keys(LINK_TYPES).map((t) =>
        '<button class="mi" data-link-type="' + t + '"><span class="mi-icon"></span>' +
        '<span class="mi-label">' + LINK_TYPES[t] + '</span><span class="mi-key"></span></button>').join('') +
      '</div>';

    App.openMenuHtml(e, html, (panel) => {
      panel.querySelector('[data-link-remove]').addEventListener('click', () => {
        writeLink(project, linkId, (p) => Model.removeLink(p, linkId));
        U.toast('Dependency removed', 'ok');
      });
      panel.querySelectorAll('[data-link-type]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const type = btn.dataset.linkType;
          writeLink(project, linkId, (p) => {
            const target = p.links.find((l) => l.id === linkId);
            if (!target) return;
            target.type = type;
            Model.reschedule(p);
          });
          U.toast('Dependency: ' + LINK_TYPES[type], 'ok', 1300);
        });
      });
    });
  }

  // ---------- events ----------
  function bind() {
    if (bound) return;
    bound = true;
    bindOutsideCommit();
    const grid = $('taskRows');
    const canvas = $('timelineCanvas');
    const scroll = $('timelineScroll');

    // ---------- outline: selection, cell focus and quick add ----------
    grid.addEventListener('click', (e) => {
      const twisty = e.target.closest('[data-twisty]');
      if (twisty) {
        e.stopPropagation();
        // The glyph inside the twisty is a <svg>, so the click target can be a
        // descendant: read the id from the element that carries it.
        const id = twisty.getAttribute('data-twisty') || '';
        if (!id) return;
        // A referenced project's phase is synthetic: it has no task in this
        // project, so its collapsed flag lives on the link itself.
        if (id.indexOf('link:') === 0) {
          const linkId = id.slice(5);
          Store.mutate((p) => {
            // normalizeLinks keeps `collapsed`; matching on the id makes the
            // toggle survive reloads instead of collapsing the wrong entry.
            p.linkedProjects = Model.normalizeLinks(p.linkedProjects).map((l) =>
              (l.id === linkId ? Object.assign({}, l, { collapsed: !l.collapsed }) : l));
          });
          invalidate();
          render();
          return;
        }
        // A parent task inside a referenced block lives in that project. The
        // flag is toggled there and the tab is saved immediately, so the change
        // survives the next repaint and shows up in the source plan as well.
        const owner = ownerProjectOfRow(id);
        const realId = realTaskId(id);
        const active = Store.active();
        if (owner && active && owner.id !== active.project.id) {
          const target = Model.getTask(owner, realId);
          if (target) {
            target.collapsed = !target.collapsed;
            const entry = Store.allProjects().find((e) => e.id === owner.id);
            if (entry) entry.project = owner;
            Store.persist();
          }
          invalidate();
          render();
          return;
        }
        Store.mutate((p) => Model.toggleCollapse(p, realId));
        return;
      }
      if (e.target.closest('.inline-input') || e.target.closest('.add-input')) return;
      // A click anywhere else ends the edit, exactly like a blur: leaving the
      // state open kept a stale input mounted after the row was rebuilt.
      if (editing) commitEdit('none');
      if (e.target.closest('[data-add-row]')) {
        const input = $('quickAdd');
        if (input) input.focus();
        return;
      }
      if (Date.now() < suppressClickUntil) return;
      const row = e.target.closest('.task-row[data-task-id]');
      if (!row) return;
      clearActiveBar();
      const cell = e.target.closest('.cell[data-col-key]');
      if (cell) currentCell = { taskId: row.dataset.taskId, key: cell.dataset.colKey };
      grid.focus({ preventScroll: true });
      const current = Store.selection();
      const same = current.length === 1 && current[0] === row.dataset.taskId;
      if (!same || e.shiftKey || e.ctrlKey || e.metaKey) selectTask(row.dataset.taskId, e);
      else applyCellFocus();
    });

    grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('[data-twisty], .add-input, .inline-input')) return;
      const row = e.target.closest('.task-row[data-task-id]');
      if (!row) return;
      const tab = Store.active();
      if (!tab) return;
      const cell = e.target.closest('.cell[data-col-key]');
      const rowId = row.dataset.taskId;
      // Referenced rows carry "<project>|<task>": look the task up in its own
      // project, or the double-click would be ignored.
      const owned = Model.getTask(tab.project, rowId) ? null : ownerProjectOfRow(rowId);
      const project = owned || tab.project;
      const realId = owned ? realTaskId(rowId) : rowId;
      const task = Model.getTask(project, realId);
      if (!task) return;
      if (cell && isEditableKey(project, task, cell.dataset.colKey)) {
        beginEdit(rowId, cell.dataset.colKey, cell);
      } else if (!owned) {
        Dialogs.task(realId);
      }
    });

    grid.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('add-input')) {
        // A leading slash is the shortcut for "put another plan here": it can
        // never be part of a task name, so nothing is lost by claiming it.
        if (e.key === '/' && e.target.value === '') {
          e.preventDefault();
          e.stopPropagation();
          e.target.blur();
          if (typeof App !== 'undefined' && App.runAction) App.runAction('project-insert');
          return;
        }
        if (e.key === 'Escape') {
          e.target.value = '';
          e.target.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          const name = e.target.value.trim();
          if (!name) return;
          let id = null;
          Store.mutate((p) => { id = Model.addTask(p, { name }).id; });
          if (id) Store.setSelection([id]);
          const next = $('quickAdd');
          if (next) next.focus();
        }
        return;
      }
      if (e.target.closest('.inline-input') || editing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tab = Store.active();
      if (!tab) return;
      const project = tab.project;
      const rows = rowsFor(project);
      if (!currentCell) {
        const selected = Store.selection()[0];
        const taskId = selected || (rows[0] && rows[0].task.id);
        if (!taskId) return;
        currentCell = { taskId, key: 'name' };
      }
      const task = Model.getTask(project, currentCell.taskId);
      if (!task) return;
      const cell = cellFor(currentCell.taskId, currentCell.key);
      const move = (dr, dc) => { e.preventDefault(); e.stopPropagation(); navigateCell(dr, dc); };
      if (e.key === 'ArrowDown') { move(1, 0); return; }
      if (e.key === 'ArrowUp') { move(-1, 0); return; }
      if (e.key === 'ArrowRight') { move(0, 1); return; }
      if (e.key === 'ArrowLeft') { move(0, -1); return; }
      if (e.key === 'PageDown') { move(10, 0); return; }
      if (e.key === 'PageUp') { move(-10, 0); return; }
      if (e.key === 'Home') { move(-rows.length, 0); return; }
      if (e.key === 'End') { move(rows.length, 0); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        navigateCell(0, e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        e.stopPropagation();
        if (cell && isEditableKey(project, task, currentCell.key)) beginEdit(currentCell.taskId, currentCell.key, cell);
        else Dialogs.task(currentCell.taskId);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        if (!clearCellValue() && currentCell.key === 'name') App.runAction('delete');
        return;
      }
      if (e.key.length === 1 && e.key !== ' ') {
        e.preventDefault();
        e.stopPropagation();
        if (cell && isEditableKey(project, task, currentCell.key)) beginEdit(currentCell.taskId, currentCell.key, cell, e.key);
      }
    });

    grid.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.task-row[data-task-id]');
      // Referenced rows belong to another plan: editing them here is fine, but
      // the menu is about the reference itself.
      if (row && row.classList.contains('linked') && App.openMenuAt) {
        e.preventDefault();
        e.stopPropagation();
        const projectId = row.getAttribute('data-linked') || '';
        App.openMenuAt(e, referenceMenuItems(projectId));
        return;
      }
      const cell = e.target.closest('.cell[data-col-key]');
      if (cell && row) currentCell = { taskId: row.dataset.taskId, key: cell.dataset.colKey };
      if (row && App.openMenuAt) {
        e.preventDefault();
        e.stopPropagation();
        clearActiveBar();
        // Right-clicking inside an existing multi-selection keeps it, so the
        // menu's outline commands can move the whole run at once.
        const selected = Store.selection();
        if (!selected.includes(row.dataset.taskId)) {
          Store.setSelection([row.dataset.taskId]);
        } else if (selected.length === 1) {
          applyCellFocus();
        }
        App.openMenuAt(e, taskMenuItems(row.dataset.taskId));
        return;
      }
      if (e.target.closest('[data-add-row]') && App.openMenuAt) {
        e.preventDefault();
        App.openMenuAt(e, [
          { label: 'Add task', action: () => Dialogs.task(null, { type: 'task' }) },
          { label: 'Add milestone', action: () => Dialogs.task(null, { type: 'milestone' }) },
          { sep: true },
          { label: 'Columns…', action: () => Dialogs.columns() }
        ]);
      }
    });

    // Drag a task row up/down to reorder it (or move it under another parent).
    grid.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.inline-input, .add-input, .add-row, [data-twisty]')) return;
      const row = e.target.closest('.task-row[data-task-id]');
      if (!row) return;
      const taskId = row.dataset.taskId;
      const startX = e.clientX;
      const startY = e.clientY;
      const line = document.createElement('div');
      line.className = 'row-drop-line';
      line.style.display = 'none';
      document.body.appendChild(line);
      let dragging = false;
      let targetId = null;
      let after = false;
      const onMove = (ev) => {
        if (!dragging && (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY)) > 6) {
          dragging = true;
          row.classList.add('row-dragging');
          document.body.style.userSelect = 'none';
          clearActiveBar();
        }
        if (!dragging) return;
        ev.preventDefault();
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const over = el && el.closest ? el.closest('.task-row[data-task-id]') : null;
        if (!over || over === row) {
          targetId = null;
          line.style.display = 'none';
          return;
        }
        const r = over.getBoundingClientRect();
        const gr = grid.getBoundingClientRect();
        after = ev.clientY > r.top + r.height / 2;
        targetId = over.dataset.taskId;
        // Only one insertion line is shown; no extra per-row outline.
        line.style.left = gr.left + 'px';
        line.style.width = gr.width + 'px';
        line.style.top = (after ? r.bottom : r.top) + 'px';
        line.style.display = 'block';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        line.remove();
        row.classList.remove('row-dragging');
        if (!dragging) return;
        document.body.style.userSelect = '';
        suppressClickUntil = Date.now() + 350;
        if (!targetId) return;
        let moved = false;
        Store.mutate((p) => { moved = Model.moveTaskRelative(p, taskId, targetId, after); });
        if (moved) {
          Store.setSelection([taskId]);
          U.toast('Task moved', 'ok', 1000);
        } else {
          U.toast('Cannot move a task inside its own subtask', 'warn');
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    grid.addEventListener('scroll', onGridScroll);

    // The grid has no vertical scrollbar of its own; forward vertical wheel
    // gestures to the shared timeline scroller.
    grid.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const scroll = $('timelineScroll');
      if (!scroll) return;
      const before = scroll.scrollTop;
      scroll.scrollTop += e.deltaY;
      if (scroll.scrollTop !== before) e.preventDefault();
    }, { passive: false });

    // ---------- column resizing ----------
    const head = $('taskHead');
    if (head) {
      head.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('[data-col-resize]');
        if (!handle || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const tab = Store.active();
        if (!tab) return;
        const project = tab.project;
        const cols = Model.visibleColumns(project);
        const layout = columnsFor(project);
        const widths = layout.widths.slice();
        const idx = cols.findIndex((c) => c.key === handle.dataset.colResize);
        if (idx < 0) return;
        const startX = e.clientX;
        const startW = widths[idx];
        let finalW = startW;
        const onMove = (ev) => {
          finalW = U.clamp(Math.round(startW + ev.clientX - startX), cols[idx].minWidth || 40, 420);
          widths[idx] = finalW;
          const total = widths.reduce((a, b) => a + b, 0);
          const template = widths.map((w) => w + 'px').join(' ');
          const headRow = document.querySelector('#taskHead .task-head-row');
          if (headRow) {
            headRow.style.width = total + 'px';
            headRow.style.gridTemplateColumns = template;
          }
          document.querySelectorAll('#taskRows .task-row, #taskRows .add-row').forEach((row) => {
            row.style.width = total + 'px';
            if (row.classList.contains('task-row')) row.style.gridTemplateColumns = template;
          });
        };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.style.userSelect = '';
          if (finalW === startW) return;
          Store.mutate((p) => {
            p.view.gridColumnWidths = Object.assign({}, p.view.gridColumnWidths);
            p.view.gridColumnWidths[handle.dataset.colResize] = finalW;
          }, { history: false });
          render();
        };
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
      head.addEventListener('dblclick', (e) => {
        const handle = e.target.closest('[data-col-resize]');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const key = handle.dataset.colResize;
        const activeTab = Store.active();
        const def = activeTab ? Model.columnDefs(activeTab.project).find((c) => c.key === key) : null;
        Store.mutate((p) => {
          p.view.gridColumnWidths = Object.assign({}, p.view.gridColumnWidths);
          delete p.view.gridColumnWidths[key];
        }, { history: false });
        render();
        if (def) U.toast('Column width reset', 'ok', 900);
      });
      head.addEventListener('contextmenu', (e) => {
        const cell = e.target.closest('.task-head-cell[data-col-key]');
        if (!cell || !App.openMenuAt) return;
        e.preventDefault();
        const key = cell.dataset.colKey;
        const items = [{
          label: 'Reset column width', action: () => {
            Store.mutate((p) => {
              p.view.gridColumnWidths = Object.assign({}, p.view.gridColumnWidths);
              delete p.view.gridColumnWidths[key];
            }, { history: false });
            render();
          }
        }];
        if (key !== 'wbs' && key !== 'name') {
          items.push({
            label: 'Hide column', action: () => {
              const active = Store.active();
              const hidden = new Set(active ? (active.project.view.hiddenColumns || []) : []);
              hidden.add(key);
              Store.updateSettings({ hiddenColumns: Array.from(hidden) });
            }
          });
        }
        items.push({ sep: true }, { label: 'Columns…', action: () => Dialogs.columns() });
        App.openMenuAt(e, items);
      });
    }

    // ---------- timeline: selection ----------
    canvas.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      if (e.target.closest('.tl-links path')) return;
      const bar = e.target.closest('.gbar[data-task-id]');
      if (!bar) {
        // Only chart graphics are selectable on the timeline; row backgrounds are not.
        clearActiveBar();
        return;
      }
      if (!bar.classList.contains('baseline') && !bar.classList.contains('actual')) {
        activeBarId = bar.dataset.taskId;
      } else {
        clearActiveBar();
      }
      currentCell = { taskId: bar.dataset.taskId, key: 'name' };
      selectTask(bar.dataset.taskId, e);
    });

    canvas.addEventListener('dblclick', (e) => {
      const bar = e.target.closest('.gbar[data-task-id]');
      if (bar) {
        Dialogs.task(bar.dataset.taskId);
        return;
      }
      if (e.target.closest('.tl-row[data-task-id]')) return;
      const tab = Store.active();
      if (!tab) return;
      const m = metrics(tab.project);
      const rect = canvas.getBoundingClientRect();
      const day = Math.max(0, Math.floor((e.clientX - rect.left) / m.px));
      addTaskAt(U.addDays(m.range.start, day), 'task');
    });

    // ---------- timeline: direct manipulation ----------
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const bar = e.target.closest('.gbar[data-task-id]');
      if (!bar || bar.dataset.noDrag) return;
      const handle = e.target.closest('.link-handle');
      if (handle) { startLinkDrag(bar, e, handle.dataset.linkSide || 'right'); return; }
      let mode = 'move';
      if (e.target.closest('.resize.left')) mode = 'left';
      else if (e.target.closest('.resize.right')) mode = 'right';
      else if (e.target.closest('.progress-handle')) mode = 'progress';
      e.preventDefault();
      startDrag(bar, mode, e);
    });

    canvas.addEventListener('contextmenu', (e) => {
      if (!App.openMenuAt) return;
      const link = e.target.closest('.tl-links path[data-link-id]');
      if (link) {
        e.preventDefault();
        openLinkMenu(e, link.dataset.linkId);
        return;
      }
      const bar = e.target.closest('.gbar[data-task-id]');
      if (bar) {
        e.preventDefault();
        const id = bar.dataset.taskId;
        activeBarId = id;
        if (Store.selection().length !== 1 || Store.selection()[0] !== id) Store.setSelection([id]);
        openBarColourPanel(e, id);
        return;
      }
      // Empty timeline rows have no context menu; task actions live in the grid.
      e.preventDefault();
    });

    // highlight the dependencies attached to the hovered bar
    canvas.addEventListener('mouseover', (e) => {
      const bar = e.target.closest('.gbar[data-task-id]');
      if (!bar || !canvas.contains(bar)) return;
      const links = canvas.querySelector('.tl-links');
      if (!links) return;
      const id = bar.dataset.taskId;
      links.classList.add('hovering');
      links.querySelectorAll('path[data-from]').forEach((p) => {
        p.classList.toggle('hot', p.dataset.from === id || p.dataset.to === id);
      });
    });
    canvas.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget;
      if (to && to.closest && to.closest('.gbar[data-task-id]')) return;
      const links = canvas.querySelector('.tl-links');
      if (!links) return;
      links.classList.remove('hovering');
      links.querySelectorAll('path.hot').forEach((p) => p.classList.remove('hot'));
    });

    // ---------- timeline: scrolling and zoom ----------
    scroll.addEventListener('scroll', onTimelineScroll);

    const zoomAtPoint = (e) => {
      const tab = Store.active();
      if (!tab) return;
      const project = tab.project;
      const before = metrics(project);
      const rect = scroll.getBoundingClientRect();
      const viewX = e.clientX - rect.left;
      const dayOffset = (scroll.scrollLeft + viewX) / before.px;
      const iso = U.addDays(before.range.start, Math.max(0, Math.floor(dayOffset)));
      const settings = Store.settings();
      const current = zoomPercent();
      const next = U.clamp(current + (e.deltaY < 0 ? 10 : -10), MIN_PLAN_ZOOM, MAX_PLAN_ZOOM);
      if (next === current) return;
      settings.planZoom = next;
      Store.persist();
      render();
      const after = metrics(tab.project);
      const x = Math.max(0, leftFor(after, iso) - viewX);
      scroll.scrollLeft = x;
      const headEl = $('timelineHead');
      if (headEl) headEl.style.transform = 'translateX(' + (-x) + 'px)';
      saveScroll(x, scroll.scrollTop);
      paintZoomLabel();
    };

    scroll.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAtPoint(e);
      } else if (e.shiftKey) {
        e.preventDefault();
        scroll.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    scroll.addEventListener('mousedown', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = scroll.scrollLeft;
      const startTop = scroll.scrollTop;
      scroll.classList.add('panning');
      const onMove = (ev) => {
        scroll.scrollLeft = startLeft - (ev.clientX - startX);
        scroll.scrollTop = startTop - (ev.clientY - startY);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        scroll.classList.remove('panning');
        saveScroll(scroll.scrollLeft, scroll.scrollTop);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    const sbLeft = $('tlScrollLeft');
    const sbRight = $('tlScrollRight');
    // A quarter of the viewport per click: far enough to feel like a step,
    // small enough to read the dates while moving.
    if (sbLeft) sbLeft.addEventListener('click', () => { scroll.scrollLeft = Math.max(0, scroll.scrollLeft - scroll.clientWidth * 0.25); });
    if (sbRight) sbRight.addEventListener('click', () => { scroll.scrollLeft += scroll.clientWidth * 0.25; });
  }

  function init() {
    bind();
    render();
  }

  function setSearch(value) {
    search = String(value || '').trim();
    invalidate();
    render();
  }
  function getSearch() { return search; }
  function setFilter(value) {
    filter = value || 'all';
    invalidate();
    render();
  }
  function getFilter() { return filter; }
  function setResourceFilter(value) {
    resourceFilter = String(value || '');
    invalidate();
    render();
  }
  function getResourceFilter() { return resourceFilter; }

  function scrollToToday() {
    const tab = Store.active();
    if (!tab) return;
    const m = metrics(tab.project);
    const scroll = $('timelineScroll');
    if (!scroll) return;
    const x = Math.max(0, leftFor(m, U.todayISO()) - scroll.clientWidth * 0.35);
    scroll.scrollLeft = x;
    const head = $('timelineHead');
    if (head) head.style.transform = 'translateX(' + (-x) + 'px)';
    saveScroll(x, scroll.scrollTop);
  }

  function setZoom(zoom) {
    const tab = Store.active();
    if (!tab) return;
    const scroll = $('timelineScroll');
    const before = metrics(tab.project);
    const anchor = scroll
      ? U.addDays(before.range.start, Math.max(0, Math.floor(scroll.scrollLeft / before.px)))
      : null;
    Store.mutate((p) => { p.view.zoom = zoom; });
    if (anchor && scroll) {
      const after = metrics(tab.project);
      const x = U.clamp(leftFor(after, anchor), 0, Math.max(0, after.width - scroll.clientWidth));
      scroll.scrollLeft = x;
      const head = $('timelineHead');
      if (head) head.style.transform = 'translateX(' + (-x) + 'px)';
      saveScroll(x, scroll.scrollTop);
    }
  }

  // The ribbon's expand / collapse work on everything the outline shows,
  // including the phases of referenced projects — those are not tasks of this
  // plan, so they carry their own flag on the link.
  // Expand / collapse apply to everything the outline shows: this plan's own
  // parents, the phases of referenced plans, and the parents inside those plans
  // (which live in their own project and are written back there).
  function expandAll() {
    invalidate();
    const links = Model.normalizeLinks(Store.active() ? Store.active().project.linkedProjects : []);
    Store.mutate((p) => {
      p.tasks.forEach((t) => { if (Model.hasChildren(p, t.id)) t.collapsed = false; });
      p.linkedProjects = Model.normalizeLinks(p.linkedProjects).map((l) => Object.assign({}, l, { collapsed: false }));
    });
    links.forEach((link) => {
      const entry = Model.resolveLinkProject(link, Store.allProjects());
      if (!entry) return;
      Store.mutateProject(entry.id, (p) => {
        p.tasks.forEach((t) => { if (Model.hasChildren(p, t.id)) t.collapsed = false; });
      }, { history: false, silent: true });
    });
    // Also clear a pending cell patch: it would only repaint one cell and the
    // rest of the outline would keep the collapsed rows.
    pendingCell = null;
    invalidate();
    render();
  }
  function collapseAll() {
    invalidate();
    const links = Model.normalizeLinks(Store.active() ? Store.active().project.linkedProjects : []);
    Store.mutate((p) => {
      p.tasks.forEach((t) => { if (Model.hasChildren(p, t.id)) t.collapsed = true; });
      p.linkedProjects = Model.normalizeLinks(p.linkedProjects).map((l) => Object.assign({}, l, { collapsed: true }));
    });
    links.forEach((link) => {
      const entry = Model.resolveLinkProject(link, Store.allProjects());
      if (!entry) return;
      Store.mutateProject(entry.id, (p) => {
        p.tasks.forEach((t) => { if (Model.hasChildren(p, t.id)) t.collapsed = true; });
      }, { history: false, silent: true });
    });
    pendingCell = null;
    invalidate();
    render();
  }

  return {
    ROW_H, ZOOM_LABEL,
    columnsFor, cellHtml, printOutline, printTimeline,
    masterLayout, masterMetrics, masterHead, masterRuler, masterRow, masterBar, masterShade,
    mount, rowsFor,
    init, render, paintSelection, invalidate,
    zoomPercent, setZoomPercent, setSearch, getSearch, setFilter, getFilter,
    setResourceFilter, getResourceFilter, scrollToToday, setZoom,
    expandAll, collapseAll, metrics, rowsFor
  };
})();
