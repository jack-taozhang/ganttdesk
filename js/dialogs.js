'use strict';

/* Modal dialogs and import/export helpers for GanttDesk. */
const Dialogs = (() => {
  let current = null;

  function open(opts) {
    opts = opts || {};
    if (current) close();
    const root = document.getElementById('modalRoot');
    if (!root) return null;
    const size = opts.size ? ' ' + opts.size : '';
    const buttons = opts.buttons && opts.buttons.length ? opts.buttons.slice() : [{ label: 'Close' }];
    const left = buttons.filter((b) => b.left);
    const right = buttons.filter((b) => !b.left);
    root.classList.add('open');
    root.innerHTML =
      '<div class="modal-backdrop" data-backdrop="1"></div>' +
      '<div class="modal' + size + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><div style="min-width:0"><h3>' + U.escapeHtml(opts.title || '') + '</h3>' +
      (opts.subtitle ? '<p>' + U.escapeHtml(opts.subtitle) + '</p>' : '') + '</div>' +
      '<button class="x" data-modal-x="1" title="Close">' + U.icon('x') + '</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      '<div class="modal-foot">' +
      left.map((b) => '<button class="btn ' + (b.kind || '') + '" data-btn="' + buttons.indexOf(b) + '">' + U.escapeHtml(b.label) + '</button>').join('') +
      '<div class="spacer"></div>' +
      right.map((b) => '<button class="btn ' + (b.kind || '') + '" data-btn="' + buttons.indexOf(b) + '">' + U.escapeHtml(b.label) + '</button>').join('') +
      '</div></div>';

    const modal = root.querySelector('.modal');
    const keyHandler = (e) => {
      if (e.key === 'Escape' && opts.dismissible !== false) {
        e.stopPropagation();
        close();
      }
    };
    const entry = { modal, onClose: opts.onClose, keyHandler, el: root };
    current = entry;

    root.querySelector('[data-modal-x]').addEventListener('click', close);
    const backdrop = root.querySelector('[data-backdrop]');
    if (backdrop && opts.dismissible !== false) backdrop.addEventListener('click', close);
    root.querySelectorAll('[data-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const b = buttons[Number(btn.dataset.btn)];
        if (!b) { close(); return; }
        if (b.action) {
          const keep = b.action(modal, entry);
          if (keep === false) return;
        }
        close();
      });
    });
    document.addEventListener('keydown', keyHandler);
    if (opts.onOpen) opts.onOpen(modal, entry);
    // Colour swatches and checkboxes are skipped so opening a dialog does not
    // paint a focus ring around a colour.
    const focusTarget = modal.querySelector(
      'input:not([type="hidden"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]), select, textarea, button.primary');
    if (focusTarget) setTimeout(() => { try { focusTarget.focus(); } catch (e) { /* ignore */ } }, 30);
    return entry;
  }

  function close() {
    if (!current) return;
    const entry = current;
    current = null;
    document.removeEventListener('keydown', entry.keyHandler);
    const root = document.getElementById('modalRoot');
    if (root) {
      root.classList.remove('open');
      root.innerHTML = '';
    }
    if (entry.onClose) entry.onClose();
  }

  function confirm(title, message, cfg) {
    cfg = cfg || {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      open({
        title,
        size: 'narrow',
        body: '<div class="note-box">' + U.escapeHtml(message) + '</div>',
        buttons: [
          { label: cfg.cancelLabel || 'Cancel', action: () => { finish(false); } },
          { label: cfg.okLabel || 'Delete', kind: cfg.danger === false ? 'primary' : 'danger', action: () => { finish(true); } }
        ],
        onClose: () => finish(false)
      });
    });
  }

  function promptText(title, label, value, cfg) {
    cfg = cfg || {};
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      open({
        title,
        size: 'narrow',
        body: '<div class="form-grid"><label class="lbl">' + U.escapeHtml(label || 'Value') + '</label>' +
          '<input id="prompt-value" type="text" value="' + U.escapeHtml(value || '') + '"></div>',
        buttons: [
          { label: 'Cancel', action: () => finish(null) },
          {
            label: cfg.okLabel || 'OK', kind: 'primary',
            action: (m) => {
              const input = m.querySelector('#prompt-value');
              const v = input ? input.value.trim() : '';
              if (!v && cfg.required !== false) { U.toast('Please enter a value', 'warn'); return false; }
              finish(v);
            }
          }
        ],
        onClose: () => finish(null)
      });
    });
  }

  function alert(title, message, cfg) {
    cfg = cfg || {};
    open({
      title,
      size: 'narrow',
      body: '<div class="note-box">' + U.escapeHtml(message) + '</div>',
      buttons: [{ label: cfg.okLabel || 'OK', kind: 'primary' }]
    });
  }

  // ---------- task editor ----------
  function task(taskId, opts) {
    opts = opts || {};
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    const existing = taskId ? Model.getTask(project, taskId) : null;
    if (taskId && !existing) return;
    const isNew = !existing;
    const t = existing || {
      id: null, name: opts.type === 'milestone' ? 'New milestone' : 'New task',
      notes: '', parentId: null, type: opts.type === 'milestone' ? 'milestone' : 'task',
      start: project.startDate || U.todayISO(), end: null,
      duration: opts.type === 'milestone' ? 0 : 1, durationUnit: 'd', percentComplete: 0,
      priority: 'normal', color: null, calendarId: project.defaultCalendarId || null,
      resources: [], estimatedCost: null, actualCost: null, cost: null
    };
    const summaryTask = !!existing && Model.hasChildren(project, taskId);
    const dis = summaryTask ? ' disabled' : '';
    // Colour pickers start on the palette colour, so leaving them alone keeps the
    // task following the project theme; only a real change becomes an override.
    const pal = Model.paletteOf(project);
    const showCost = Model.costVisible(project);
    const rows = Model.flatten(project, { includeCollapsed: true });
    const excluded = new Set(existing ? Model.subtreeIds(project, taskId) : []);
    const parentOptions = rows.filter((r) => !excluded.has(r.task.id)).map((r) =>
      '<option value="' + r.task.id + '"' + (t.parentId === r.task.id ? ' selected' : '') + '>' +
      U.escapeHtml('\u00a0\u00a0'.repeat(r.level) + r.task.name) + '</option>').join('');
    const calOptions = (project.calendars || []).map((c) =>
      '<option value="' + c.id + '"' + (t.calendarId === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>').join('');
    const priorityOptions = Model.PRIORITIES.map((p) =>
      '<option value="' + p.id + '"' + (t.priority === p.id ? ' selected' : '') + '>' + U.escapeHtml(p.label) + '</option>').join('');
    const unitOptions = ['d', 'h', 'w'].map((u) =>
      '<option value="' + u + '"' + (t.durationUnit === u ? ' selected' : '') + '>' +
      (u === 'd' ? 'days' : (u === 'h' ? 'hours' : 'weeks')) + '</option>').join('');

    const assigned = new Map((t.resources || []).map((a) => [a.resourceId, a.units == null ? 100 : a.units]));
    const resHtml = (project.resources || []).length
      ? project.resources.map((r) => '<label class="check res-row">' +
        '<input type="checkbox" data-res-id="' + r.id + '"' + (assigned.has(r.id) ? ' checked' : '') + '>' +
        '<span class="res-name" title="' + U.escapeHtml(r.name) + '">' + U.escapeHtml(r.name) + '</span>' +
        '<input type="number" class="res-units" data-res-units min="0" max="100" step="5" value="' +
        (assigned.has(r.id) ? assigned.get(r.id) : 100) + '"><span class="suffix">%</span></label>').join('')
      : '<div class="empty-hint">No team members yet. Add resources from the Resources button first.</div>';

    const predTasks = rows.filter((r) => !excluded.has(r.task.id) && r.task.id !== taskId);
    const predOptionsHtml = (selected) => '<option value="">Select task…</option>' + predTasks.map((r) =>
      '<option value="' + r.task.id + '"' + (selected === r.task.id ? ' selected' : '') + '>' +
      U.escapeHtml(r.wbs + '  ' + r.task.name) + '</option>').join('');
    const typeOptions = (selected) => ['FS', 'SS', 'FF', 'SF'].map((ty) =>
      '<option value="' + ty + '"' + (selected === ty ? ' selected' : '') + '>' + ty + ' — ' + Model.linkTypeLabel(ty) + '</option>').join('');
    const predRow = (pred) =>
      '<div class="pred-row" data-pred-row>' +
      '<select data-pred-from title="Predecessor">' + predOptionsHtml(pred ? pred.link.from : '') + '</select>' +
      '<select data-pred-type title="Link type">' + typeOptions(pred ? pred.link.type : 'FS') + '</select>' +
      '<input type="number" data-pred-lag step="0.5" title="Lag (days)" value="' + (pred ? (pred.link.lag || 0) : 0) + '">' +
      '<button class="mini-btn danger" data-pred-remove title="Remove link">' + U.icon('x') + '</button>' +
      '</div>';
    const existingPreds = existing ? Model.predecessors(project, taskId) : [];

    const body =
      '<div class="task-editor-cols">' +
      '<div class="task-col">' +
      '<div class="section-title">General</div>' +
      '<div class="te-pairs">' +
      '<label class="lbl">Name</label><input id="t-name" type="text" value="' + U.escapeHtml(t.name) + '" class="full">' +
      '<label class="lbl">Type</label><select id="t-type">' +
      '<option value="task"' + (t.type !== 'milestone' ? ' selected' : '') + '>Task</option>' +
      '<option value="milestone"' + (t.type === 'milestone' ? ' selected' : '') + '>Milestone</option></select>' +
      '<label class="lbl">Parent</label><select id="t-parent"><option value="">— Top level —</option>' + parentOptions + '</select>' +
      '<label class="lbl">Calendar</label><select id="t-calendar" class="full">' + calOptions + '</select>' +
      '<label class="lbl">Notes</label><textarea id="t-notes" class="full" rows="2">' + U.escapeHtml(t.notes || '') + '</textarea>' +
      '</div>' +
      '<div class="section-title">Schedule</div>' +
      '<div class="te-pairs">' +
      '<label class="lbl">Start</label><input id="t-start" type="date" value="' + U.escapeHtml(t.start || '') + '">' +
      '<label class="lbl">Duration</label><div class="input-row"><input id="t-duration" type="number" min="0" step="0.5" value="' +
      (t.duration == null ? 1 : t.duration) + '"><select id="t-unit">' + unitOptions + '</select></div>' +
      '<label class="lbl">Progress</label><div class="input-row"><input id="t-percent" type="number" min="0" max="100" step="5" value="' +
      (Number(t.percentComplete) || 0) + '"' + dis + '><span class="suffix">%</span></div>' +
      '<label class="lbl">Priority</label><select id="t-priority">' + priorityOptions + '</select>' +
      '<label class="lbl">Baseline start</label><input id="t-baseline-start" type="date" value="' + U.escapeHtml(t.baselineStart || '') + '"' + dis + '>' +
      '<label class="lbl">Baseline finish</label><input id="t-baseline-end" type="date" value="' + U.escapeHtml(t.baselineEnd || '') + '"' + dis + '>' +
      '<label class="lbl">Actual start</label><input id="t-actual-start" type="date" value="' + U.escapeHtml(t.actualStart || '') + '"' + dis + '>' +
      '<label class="lbl">Actual finish</label><input id="t-actual-end" type="date" value="' + U.escapeHtml(t.actualEnd || '') + '"' + dis + '>' +
      '<label class="lbl">Bar colour</label><div class="input-row colour-row">' +
      '<input type="color" id="t-colour" value="' + U.escapeHtml(t.color || pal.bar) + '">' +
      '<button type="button" class="mini-btn" id="t-colour-reset" title="Back to the theme colour">' + U.icon('undo') + '</button></div>' +
      '<label class="lbl">Progress colour</label><div class="input-row colour-row">' +
      '<input type="color" id="t-progress-colour" value="' + U.escapeHtml(t.progressColor || pal.progress) + '">' +
      '<button type="button" class="mini-btn" id="t-progress-reset" title="Back to the theme colour">' + U.icon('undo') + '</button></div>' +
      '</div>' +
      '</div>' +
      '<div class="task-col">' +
      (showCost
        ? '<div class="section-title">Cost</div>' +
          '<div class="te-pairs">' +
          '<label class="lbl">Estimated</label><input id="t-est" type="number" min="0" step="0.01" value="' +
          (t.estimatedCost == null ? '' : t.estimatedCost) + '">' +
          '<label class="lbl">Actual</label><input id="t-actual" type="number" min="0" step="0.01" value="' +
          (t.actualCost == null ? '' : t.actualCost) + '">' +
          '<div class="hint span4">Leave empty to use resource rates; summaries roll up.</div>' +
          '</div>'
        : '') +
      '<div class="section-title">Team</div>' +
      '<div class="task-team-grid">' + resHtml + '</div>' +
      '<div class="section-title">Predecessors</div>' +
      '<div class="pred-head"><span>Task</span><span>Type</span><span>Lag</span><span></span></div>' +
      '<div id="pred-body" class="pred-list">' + existingPreds.map(predRow).join('') + '</div>' +
      (predTasks.length ? '<button class="btn" style="margin-top:6px" data-add-pred="1">' + U.icon('link') + ' Add predecessor</button>' : '') +
      '<div class="note-box" style="margin-top:8px">GanttDesk prevents circular links.</div>' +
      '</div>' +
      '</div>';

    open({
      title: isNew ? (opts.type === 'milestone' ? 'Add milestone' : 'Add task') : 'Edit task',
      subtitle: isNew ? 'Create a new activity in this plan.' : '',
      size: 'wide',
      body,
      buttons: [
        ...(isNew ? [] : [{
          label: 'Delete', kind: 'danger', left: true,
          action: (m) => {
            const btn = m.querySelector('.modal-foot .btn.danger');
            if (!btn || btn.dataset.armed !== '1') {
              if (btn) {
                btn.dataset.armed = '1';
                btn.textContent = 'Click again to delete';
                setTimeout(() => {
                  if (btn && btn.isConnected) { btn.dataset.armed = '0'; btn.textContent = 'Delete'; }
                }, 3000);
              }
              return false;
            }
            Store.mutate((p) => Model.deleteTask(p, taskId));
            U.toast('Task deleted', 'ok');
            return true;
          }
        }]),
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary',
          action: (m) => {
            const name = m.querySelector('#t-name').value.trim() || 'Untitled task';
            const type = m.querySelector('#t-type').value === 'milestone' ? 'milestone' : 'task';
            const start = U.parseLooseDate(m.querySelector('#t-start').value, null);
            if (!start) { U.toast('Please enter a valid start date', 'warn'); return false; }
            const durationValue = Math.max(0, Number(m.querySelector('#t-duration').value) || 0);
            const durationUnit = m.querySelector('#t-unit').value || 'd';
            const days = type === 'milestone' ? 0 : U.durationToDays(durationValue, durationUnit, project.hoursPerDay);
            const percent = U.clamp(Number(m.querySelector('#t-percent').value) || 0, 0, 100);
            const priority = m.querySelector('#t-priority').value || 'normal';
            const calendarId = m.querySelector('#t-calendar').value || project.defaultCalendarId;
            const parentId = m.querySelector('#t-parent').value || null;
            const notes = m.querySelector('#t-notes').value;
            const parseCost = (id) => {
              const el = m.querySelector(id);
              if (!el) return null;
              const raw = el.value.trim();
              if (raw === '') return null;
              const n = Number(raw);
              return isFinite(n) ? n : null;
            };
            // Hidden cost fields keep whatever the task already carried.
            const estimatedCost = showCost ? parseCost('#t-est') : t.estimatedCost;
            const actualCost = showCost ? parseCost('#t-actual') : t.actualCost;
            // A picker left on the palette colour means "no override".
            const pickColour = (id, fallback, previous) => {
              const el = m.querySelector(id);
              if (!el) return previous || null;
              const v = String(el.value || '').toLowerCase();
              return v === String(fallback).toLowerCase() ? null : el.value;
            };
            const color = pickColour('#t-colour', pal.bar, t.color);
            const progressColor = pickColour('#t-progress-colour', pal.progress, t.progressColor);
            const actualStartRaw = m.querySelector('#t-actual-start').value.trim();
            const actualEndRaw = m.querySelector('#t-actual-end').value.trim();
            const actualStart = actualStartRaw ? U.parseLooseDate(actualStartRaw, null) : null;
            const actualEnd = actualEndRaw ? U.parseLooseDate(actualEndRaw, null) : null;
            if ((actualStartRaw && !actualStart) || (actualEndRaw && !actualEnd)) {
              U.toast('Please enter valid actual dates', 'warn');
              return false;
            }
            if (actualStart && actualEnd && U.diffDays(actualStart, actualEnd) < 0) {
              U.toast('Actual finish must be on or after actual start', 'warn');
              return false;
            }
            const baselineStartRaw = m.querySelector('#t-baseline-start').value.trim();
            const baselineEndRaw = m.querySelector('#t-baseline-end').value.trim();
            const baselineStart = baselineStartRaw ? U.parseLooseDate(baselineStartRaw, null) : null;
            const baselineEnd = baselineEndRaw ? U.parseLooseDate(baselineEndRaw, null) : null;
            if ((baselineStartRaw && !baselineStart) || (baselineEndRaw && !baselineEnd)) {
              U.toast('Please enter valid baseline dates', 'warn');
              return false;
            }
            if (baselineStart && baselineEnd && U.diffDays(baselineStart, baselineEnd) < 0) {
              U.toast('Baseline finish must be on or after baseline start', 'warn');
              return false;
            }
            const resources = Array.from(m.querySelectorAll('[data-res-id]')).filter((el) => el.checked).map((el) => {
              const unitsEl = el.parentElement.querySelector('[data-res-units]');
              return { resourceId: el.dataset.resId, units: U.clamp(Number(unitsEl && unitsEl.value) || 100, 0, 100) };
            });
            const preds = Array.from(m.querySelectorAll('[data-pred-row]')).map((tr) => ({
              from: tr.querySelector('[data-pred-from]').value,
              type: tr.querySelector('[data-pred-type]').value || 'FS',
              lag: Number(tr.querySelector('[data-pred-lag]').value) || 0
            })).filter((r) => r.from && r.from !== taskId);

            let newId = null;
            Store.mutate((p) => {
              let target = null;
              if (isNew) {
                target = {
                  id: U.uid(), name, notes, parentId, type, order: p.tasks.length,
                  start, end: start, duration: durationValue, durationUnit,
                  percentComplete: percent, priority, color, progressColor, calendarId,
                  resources, cost: null, estimatedCost, actualCost, baselineCost: null,
                  baselineStart, baselineEnd, actualStart, actualEnd,
                  lateStart: null, lateFinish: null, totalFloat: null, freeSlack: null,
                  critical: false, status: 'planned', collapsed: false, manual: true, custom: {}
                };
                p.tasks.push(target);
                newId = target.id;
              } else {
                target = Model.getTask(p, taskId);
                if (!target) return;
                const parentChanged = (target.parentId || null) !== parentId;
                Object.assign(target, {
                  name, notes, type, calendarId, percentComplete: percent, priority,
                  resources, estimatedCost, actualCost, color, progressColor, actualStart, actualEnd,
                  baselineStart, baselineEnd
                });
                target.start = start;
                target.duration = type === 'milestone' ? 0 : durationValue;
                target.durationUnit = durationUnit;
                target.manual = true;
                if (parentChanged) Model.moveTaskToParent(p, target.id, parentId);
              }
              target.name = name;
              target.notes = notes;
              target.type = type;
              target.calendarId = calendarId;
              target.percentComplete = percent;
              target.priority = priority;
              target.resources = resources;
              target.estimatedCost = estimatedCost;
              target.actualCost = actualCost;
              target.color = color;
              target.progressColor = progressColor;
              target.actualStart = actualStart;
              target.actualEnd = actualEnd;
              target.baselineStart = baselineStart;
              target.baselineEnd = baselineEnd;
              target.start = start;
              target.duration = type === 'milestone' ? 0 : durationValue;
              target.durationUnit = durationUnit;
              const cal = Model.calendarFor(p, target);
              target.end = type === 'milestone' ? start : U.endFromDuration(start, days, cal);
              if (percent > 0 && !target.actualStart) target.actualStart = start;
              if (percent >= 100 && !target.actualEnd) target.actualEnd = target.end;
              if (isNew) target.parentId = parentId;
              p.links = p.links.filter((l) => l.to !== target.id);
              preds.forEach((pr) => {
                if (pr.from === target.id) return;
                if (Model.createsCycle(p, pr.from, target.id)) return;
                p.links.push({ id: U.uid(), from: pr.from, to: target.id, type: pr.type, lag: pr.lag, lagUnit: 'd' });
              });
              Model.reschedule(p);
            });
            if (newId) Store.setSelection([newId]);
            U.toast(isNew ? 'Task added' : 'Task updated', 'ok');
          }
        }
      ],
      onOpen: (m) => {
        const add = m.querySelector('[data-add-pred]');
        if (add) add.addEventListener('click', () => {
          const bodyEl = m.querySelector('#pred-body');
          if (bodyEl) bodyEl.insertAdjacentHTML('beforeend', predRow(null));
        });
        m.querySelector('.modal-body').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-pred-remove]');
          if (btn) {
            const row = btn.closest('[data-pred-row]');
            if (row) row.remove();
          }
        });
        const typeSel = m.querySelector('#t-type');
        const dur = m.querySelector('#t-duration');
        const unit = m.querySelector('#t-unit');
        if (typeSel) typeSel.addEventListener('change', () => {
          const ms = typeSel.value === 'milestone';
          if (ms) { dur.value = 0; dur.disabled = true; unit.disabled = true; }
          else { dur.disabled = false; unit.disabled = false; if (!Number(dur.value)) dur.value = 1; }
        });
        if (typeSel && typeSel.value === 'milestone') { dur.disabled = true; unit.disabled = true; }
        // The undo buttons put a picker back on the palette colour, which drops
        // the per-task override on save.
        const wireReset = (btnId, inputId, fallback) => {
          const btn = m.querySelector('#' + btnId);
          const input = m.querySelector('#' + inputId);
          if (!btn || !input) return;
          btn.addEventListener('click', () => { input.value = fallback; });
        };
        wireReset('t-colour-reset', 't-colour', pal.bar);
        wireReset('t-progress-reset', 't-progress-colour', pal.progress);
      }
    });
  }

  // ---------- bar and project colours ----------
  // ---------- theme colours ----------
  // One place to restyle the application: theme presets on top, then the six
  // palette slots that drive tabs, the header band, task bars and the roll-up
  // bars. Task-level overrides live at the bottom.
  const PALETTE_LABELS = {
    accent: ['Accent', 'Tabs, buttons and focus rings'],
    head: ['Header band', 'Project header strip'],
    bar: ['Task bar', 'Leaf task bars and milestones'],
    bar2: ['Bar edge', 'Bar outline and summary end caps'],
    summary: ['Summary bar', 'Rolled-up parent bars'],
    progress: ['Progress fill', 'Completed part of a bar']
  };

  function colours(taskIds, opts) {
    opts = opts || {};
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    const app = project.appearance || {};
    const preset = Model.themeOf(project);
    const pal = Model.paletteOf(project);
    // appearance.priorityColours only stores real overrides; anything missing
    // (or still null) falls back to the ramp the preset defines.
    const pri = Model.priorityFromTheme(preset.id);
    const appPri = app.priorityColours || {};
    ['high', 'normal', 'low'].forEach((k) => { if (appPri[k]) pri[k] = appPri[k]; });

    // Bar style lives here too: the five shapes the gantt renders, each drawn
    // with the palette currently in the dialog so the choice is self-evident.
    const curStyle = app.barStyle || 'raised';
    const barVars = (q) => '--bar:' + q.bar + ';--bar-2:' + q.bar2 + ';--bar-progress:' + q.progress;
    const styleCards = Model.BAR_STYLES.map((b) =>
      '<button type="button" class="bs-card' + (b.id === curStyle ? ' on' : '') + '" data-style="' + b.id +
        '" title="' + U.escapeHtml(b.label) + '">' +
        '<span class="bar-sample' + (b.id === 'raised' ? '' : ' bar-' + b.id) + '" style="' + barVars(pal) + '"><i></i></span>' +
        '<b>' + U.escapeHtml(b.label) + '</b></button>').join('');

    // The bar context menu's "More colours…" entry reopens this dialog for one
    // task, so that shortcut keeps its per-task override block. Everywhere else
    // the dialog is only about presets, the palette and the priority ramp.
    const perTask = !!opts.focus;
    const ids = perTask ? (taskIds || []).filter((id) => Model.getTask(project, id)) : [];
    const selected = ids.map((id) => Model.getTask(project, id));
    const first = selected[0] || null;

    const themeCards = Model.THEMES.map((t) => {
      const chips = ['accent', 'bar', 'normal', 'high', 'low'].map((k) =>
        '<i style="background:' + t[k] + '"></i>').join('');
      return '<button type="button" class="theme-card' + (t.id === preset.id ? ' on' : '') +
        '" data-theme="' + t.id + '" title="' + U.escapeHtml(t.label) + '">' +
        '<b>' + U.escapeHtml(t.label) + '</b><span class="chips">' + chips + '</span></button>';
    }).join('');

    const palRows = Model.PALETTE_KEYS.map((k) => {
      const meta = PALETTE_LABELS[k] || [k, ''];
      return '<label class="pal-row" title="' + U.escapeHtml(meta[1]) + '">' +
        '<span>' + U.escapeHtml(meta[0]) + '<em>' + U.escapeHtml(meta[1]) + '</em></span>' +
        '<input type="color" data-pal="' + k + '" value="' + U.escapeHtml(pal[k]) + '">' +
        '<code data-hex="' + k + '">' + U.escapeHtml(String(pal[k]).toUpperCase()) + '</code></label>';
    }).join('');

    const priLabels = { high: 'High priority', normal: 'Normal priority', low: 'Low priority' };
    const priRows = ['high', 'normal', 'low'].map((k) =>
      '<label class="pri-row"><span>' + priLabels[k] + '</span>' +
      '<input type="color" data-pri="' + k + '" value="' + U.escapeHtml(pri[k]) + '">' +
      '<code data-prihex="' + k + '">' + U.escapeHtml(String(pri[k]).toUpperCase()) + '</code></label>').join('');

    // The overdue highlight is switched on in the project editor; its shade is
    // chosen here, next to the palette and the priority ramp.
    const overdueValue = app.overdueColour || '#d9534f';
    const overdueRow = '<label class="pri-row"><span>Overdue task</span>' +
      '<input type="color" data-overdue value="' + U.escapeHtml(overdueValue) + '">' +
      '<code data-overduehex>' + U.escapeHtml(String(overdueValue).toUpperCase()) + '</code></label>';

    const override = (prefix, value, fallback) =>
      '<div class="input-row colour-row">' +
      '<input type="checkbox" id="' + prefix + '-on"' + (value ? ' checked' : '') + ' title="Tick to override the default colour">' +
      '<input type="color" id="' + prefix + '" value="' + U.escapeHtml(value || fallback) + '"></div>';

    const names = selected.slice(0, 4).map((t) => t.name).join(', ');
    const selectionNote = selected.length
      ? (selected.length + ' selected task' + (selected.length === 1 ? '' : 's') +
         (names ? ': ' + names + (selected.length > 4 ? '…' : '') : ''))
      : '';

    const body =
      '<div class="section-title">Theme presets</div>' +
      '<div class="theme-grid" id="c-themes">' + themeCards + '</div>' +
      '<div class="section-title">Bar style</div>' +
      '<div class="bs-grid" id="c-barstyles">' + styleCards + '</div>' +
      '<div class="section-title">Theme colours<span class="section-hint">this project only</span></div>' +
      '<div class="palette-grid" id="c-palette">' + palRows + '</div>' +
      '<div class="pri-grid" id="c-priority">' + priRows + '</div>' +
      '<div class="section-title">Status colours<span class="section-hint">switch it on in Edit project</span></div>' +
      '<div class="pri-grid" id="c-status">' + overdueRow + '</div>' +
      (perTask && selected.length
        ? '<div class="section-title">Selected tasks<span class="section-hint">' + U.escapeHtml(selectionNote) + '</span></div>' +
          '<div class="form-grid">' +
          '<label class="lbl">Bar colour</label>' + override('c-sel-bar', first.color, pal.bar) +
          '<label class="lbl">Progress colour</label>' + override('c-sel-progress', first.progressColor, pal.progress) +
          '</div>'
        : '') +
      '<div class="note-box" style="margin-top:12px">A preset sets the palette, the bar style and the high / normal / low priority ' +
      'colours at once; the pickers below fine-tune them for this project. Priority colours apply to tasks without an explicit ' +
      'colour. The overdue colour is used only while Edit project → Highlight overdue tasks is on. Changes are undoable.</div>';

    const readPalette = (m) => {
      const out = {};
      m.querySelectorAll('[data-pal]').forEach((i) => { out[i.dataset.pal] = i.value; });
      return out;
    };
    const paintHex = (m) => {
      m.querySelectorAll('[data-pal]').forEach((i) => {
        const code = m.querySelector('[data-hex="' + i.dataset.pal + '"]');
        if (code) code.textContent = String(i.value).toUpperCase();
      });
      m.querySelectorAll('[data-pri]').forEach((i) => {
        const code = m.querySelector('[data-prihex="' + i.dataset.pri + '"]');
        if (code) code.textContent = String(i.value).toUpperCase();
      });
      const overdue = m.querySelector('[data-overdue]');
      const overdueCode = m.querySelector('[data-overduehex]');
      if (overdue && overdueCode) overdueCode.textContent = String(overdue.value).toUpperCase();
    };
    // The bar-style strips follow whatever palette the dialog currently holds,
    // so picking a preset repaints them straight away.
    const paintSamples = (m, now) => {
      m.querySelectorAll('.bar-sample').forEach((el) => {
        el.style.setProperty('--bar', now.bar);
        el.style.setProperty('--bar-2', now.bar2);
        el.style.setProperty('--bar-progress', now.progress);
      });
    };
    const usePreset = (m, id) => {
      const base = Model.paletteFromTheme(id);
      m.querySelectorAll('[data-pal]').forEach((i) => {
        if (base[i.dataset.pal]) i.value = base[i.dataset.pal];
      });
      const ramp = Model.priorityFromTheme(id);
      m.querySelectorAll('[data-pri]').forEach((i) => {
        if (ramp[i.dataset.pri]) i.value = ramp[i.dataset.pri];
      });
      paintHex(m);
      const now = readPalette(m);
      paintSamples(m, now);
      App.previewPalette(now);
    };
    const markTheme = (m, id) => {
      m.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('on', c.dataset.theme === id));
    };

    open({
      title: 'Theme colours',
      subtitle: 'Pick a preset, then fine-tune the palette used across this project.',
      body,
      buttons: [
        {
          label: 'Reset to preset', left: true,
          action: (m) => {
            const on = m.querySelector('.theme-card.on');
            usePreset(m, on ? on.dataset.theme : preset.id);
            return false;
          }
        },
        { label: 'Cancel' },
        {
          label: 'Apply', kind: 'primary',
          action: (m) => {
            const on = m.querySelector('.theme-card.on');
            const themeId = on ? on.dataset.theme : preset.id;
            const values = readPalette(m);
            const base = Model.paletteFromTheme(themeId);
            const custom = {};
            Model.PALETTE_KEYS.forEach((k) => {
              if (String(values[k] || '').toLowerCase() !== String(base[k]).toLowerCase()) custom[k] = values[k];
            });
            const priorityColours = {};
            m.querySelectorAll('[data-pri]').forEach((i) => { priorityColours[i.dataset.pri] = i.value; });
            const overdueInput = m.querySelector('[data-overdue]');
            const overdueColour = overdueInput ? overdueInput.value : (app.overdueColour || '#d9534f');
            const styleOn = m.querySelector('.bs-card.on');
            const barStyle = styleOn ? styleOn.dataset.style : curStyle;
            const read = (prefix) => {
              const check = m.querySelector('#' + prefix + '-on');
              const input = m.querySelector('#' + prefix);
              return check && check.checked && input ? input.value : null;
            };
            const barColour = perTask ? read('c-sel-bar') : null;
            const progressColour = perTask ? read('c-sel-progress') : null;
            Store.mutate((p) => {
              if (perTask) {
                ids.forEach((id) => {
                  const real = Model.getTask(p, id);
                  if (!real) return;
                  real.color = barColour;
                  real.progressColor = progressColour;
                });
              }
              p.appearance = Object.assign({}, p.appearance, {
                themeId,
                barStyle,
                customPalette: Object.keys(custom).length ? custom : null,
                // The per-project bar / progress overrides lost their controls:
                // both now follow the palette, so the preset stays authoritative.
                defaultBarColour: null,
                defaultProgressColour: null,
                priorityColours,
                overdueColour
              });
            });
            U.toast('Theme updated', 'ok');
          }
        }
      ],
      onOpen: (m) => {
        m.querySelectorAll('.theme-card').forEach((card) => {
          card.addEventListener('click', () => {
            markTheme(m, card.dataset.theme);
            usePreset(m, card.dataset.theme);
          });
        });
        m.querySelectorAll('.bs-card').forEach((card) => {
          card.addEventListener('click', () => {
            m.querySelectorAll('.bs-card').forEach((c) => c.classList.toggle('on', c === card));
          });
        });
        const repaint = () => {
          paintHex(m);
          const now = readPalette(m);
          paintSamples(m, now);
          App.previewPalette(now);
        };
        m.querySelectorAll('[data-pal]').forEach((input) => {
          input.addEventListener('input', repaint);
          input.addEventListener('change', repaint);
        });
        m.querySelectorAll('[data-pri]').forEach((input) => {
          input.addEventListener('input', () => paintHex(m));
          input.addEventListener('change', () => paintHex(m));
        });
        m.querySelectorAll('[data-overdue]').forEach((input) => {
          input.addEventListener('input', () => paintHex(m));
          input.addEventListener('change', () => paintHex(m));
        });
        const link = (prefix) => {
          const check = m.querySelector('#' + prefix + '-on');
          const input = m.querySelector('#' + prefix);
          if (!check || !input) return;
          input.disabled = !check.checked;
          check.addEventListener('change', () => { input.disabled = !check.checked; });
        };
        ['c-sel-bar', 'c-sel-progress'].forEach(link);
        if (opts.focus === 'progress') {
          const check = m.querySelector('#c-sel-progress-on');
          const input = m.querySelector('#c-sel-progress');
          if (check && input) {
            check.checked = true;
            input.disabled = false;
            setTimeout(() => { try { input.focus(); } catch (err) { /* ignore */ } }, 30);
          }
        }
      },
      // Cancel / Esc leave a live preview behind: put the stored palette back.
      onClose: () => {
        const active = Store.active();
        App.applyPalette(active && active.project);
      }
    });
  }

  // ---------- project editor ----------
  function project(opts) {
    opts = opts || {};
    const existing = opts.project || null;
    const isNew = !existing;
    const p = existing || Model.blankProject('New project');
    const calOptions = (p.calendars || []).map((c) =>
      '<option value="' + c.id + '"' + (p.defaultCalendarId === c.id ? ' selected' : '') + '>' + U.escapeHtml(c.name) + '</option>').join('');
    const view = p.view || Model.defaultView();
    // Finish is derived, not stored: the latest task end drives it.
    const finish = (Model.stats(p) || {}).last || p.startDate || U.todayISO();
    const labelFields = [['name', 'Task name'], ['start', 'Start'], ['end', 'Finish'], ['duration', 'Duration'],
      ['resource', 'Resources'], ['percent', 'Progress'], ['cost', 'Cost']];
    const body =
      '<div class="form-grid">' +
      '<label class="lbl">Project name</label><input id="p-name" type="text" value="' + U.escapeHtml(p.name || '') + '">' +
      '<label class="lbl">Project no. <span style="color:var(--critical)">*</span></label><div class="input-row">' +
      '<input id="p-tabname" type="text" value="' + U.escapeHtml(p.tabName || '') + '" placeholder="e.g. P-001" required></div>' +
      '<label class="lbl">Lead</label><input id="p-lead" type="text" value="' + U.escapeHtml(p.lead || '') + '" placeholder="Who owns delivery?">' +
      '<label class="lbl">Start date</label><input id="p-start" type="date" value="' + U.escapeHtml(p.startDate || U.todayISO()) + '">' +
      '<label class="lbl">Finish date</label><div class="input-row">' +
      '<input id="p-finish" type="date" value="' + U.escapeHtml(finish) + '" readonly>' +
      '<span class="suffix">latest task end</span></div>' +
      '<label class="lbl">Calendar</label><select id="p-calendar">' + calOptions + '</select>' +
      '<label class="lbl" data-cost="1">Currency</label><div class="input-row" data-cost="1"><input id="p-currency" type="text" maxlength="4" style="width:70px;height:30px" value="' +
      U.escapeHtml(p.currency || '¥') + '"><span class="suffix">symbol</span><input id="p-decimals" type="number" min="0" max="4" style="width:70px;height:30px" value="' +
      (p.money && p.money.decimals != null ? p.money.decimals : 2) + '"><span class="suffix">decimals</span></div>' +
      '<label class="lbl" data-cost="1">Estimated budget</label><input id="p-budget" data-cost="1" type="number" min="0" step="0.01" value="' +
      (p.estimatedBudget == null ? '' : p.estimatedBudget) + '">' +
      '<label class="lbl">Budget &amp; cost</label><select id="p-costs">' +
      [['inherit', 'Use app setting'], ['show', 'Show in this project'], ['hide', 'Hide in this project']]
        .map((o) => '<option value="' + o[0] + '"' +
          ((p.view && p.view.showCosts === true ? 'show' : (p.view && p.view.showCosts === false ? 'hide' : 'inherit')) === o[0] ? ' selected' : '') +
          '>' + o[1] + '</option>').join('') + '</select>' +
      '<label class="lbl">Notes</label><textarea id="p-notes" class="full">' + U.escapeHtml(p.notes || '') + '</textarea>' +
      '</div>' +
      '<div class="section-title">Bars and links</div>' +
      '<div class="check-row tight">' +
      '<label class="check"><input type="checkbox" id="p-baseline"' + (view.showBaselineBars ? ' checked' : '') + '> Baseline bars</label>' +
      '<label class="check"><input type="checkbox" id="p-actual"' + (view.showActualBars ? ' checked' : '') + '> Actual bars</label>' +
      '<label class="check"><input type="checkbox" id="p-links"' + (view.showLinks ? ' checked' : '') + '> Dependencies</label>' +
      '<label class="check"><input type="checkbox" id="p-critical"' + (view.showCriticalPath ? ' checked' : '') + '> Critical path</label>' +
      '<label class="check"><input type="checkbox" id="p-times"' + (view.showTimes ? ' checked' : '') + '> Show times</label>' +
      '</div>' +
      '<div class="section-title">Bar colours</div>' +
      '<div class="check-row tight">' +
      '<label class="check"><input type="checkbox" id="p-people-colour"' +
        (p.appearance && p.appearance.colourFromPeople ? ' checked' : '') + '> Follow resource colour</label>' +
      '<label class="check"><input type="checkbox" id="p-overdue-on"' +
        (p.appearance && p.appearance.overdueOn ? ' checked' : '') + '> Highlight overdue tasks</label>' +
      '</div>' +
      '<div class="note-box" style="margin-top:8px">A task colour set on the task itself always wins. ' +
      'Otherwise an overdue task takes the overdue colour (Project → Bar colours…), then the first assigned resource ' +
      'colour, then the priority colour, then the project default.</div>' +
      '<div class="section-title">Bar labels</div>' +
      '<div class="check-row tight">' +
      labelFields.map((f) => '<label class="check"><input type="checkbox" data-p-label="' + f[0] + '"' +
        ((view.barLabelFields || ['name']).includes(f[0]) ? ' checked' : '') + '> ' + f[1] + '</label>').join('') +
      '</div>' +
      '<div class="note-box" style="margin-top:12px">' + (isNew
        ? 'A new tab will be created with a blank outline and today as the start date.'
        : 'Changing the start date does not move existing tasks. Use drag or the task editor to reschedule.') + '</div>';

    open({
      title: isNew ? 'Add project' : 'Edit project',
      size: 'mid',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: isNew ? 'Create project' : 'Save', kind: 'primary',
          action: (m) => {
            const name = m.querySelector('#p-name').value.trim() || 'Untitled project';
            const lead = m.querySelector('#p-lead').value.trim();
            const tabName = m.querySelector('#p-tabname').value.trim();
            if (!tabName) {
              const field = m.querySelector('#p-tabname');
              if (field) { field.style.borderColor = 'var(--critical)'; field.focus(); }
              U.toast('Project no. is required', 'warn');
              return false;
            }
            const start = U.parseLooseDate(m.querySelector('#p-start').value, U.todayISO());
            const calendarId = m.querySelector('#p-calendar').value;
            const currency = m.querySelector('#p-currency').value.trim() || '¥';
            const decimals = U.clamp(Number(m.querySelector('#p-decimals').value) || 0, 0, 4);
            const budgetRaw = m.querySelector('#p-budget').value.trim();
            const costMode = m.querySelector('#p-costs').value;
            const showCosts = costMode === 'show' ? true : (costMode === 'hide' ? false : null);
            const budget = budgetRaw === '' ? null : Number(budgetRaw);
            const notes = m.querySelector('#p-notes').value;
            const colourFromPeople = m.querySelector('#p-people-colour').checked;
            const overdueOn = m.querySelector('#p-overdue-on').checked;
            // The shade itself is chosen in Project → Bar colours…, so the
            // project editor only decides whether the highlight is on.
            const appearancePatch = { colourFromPeople, overdueOn };
            const viewPatch = {
              showBaselineBars: m.querySelector('#p-baseline').checked,
              showActualBars: m.querySelector('#p-actual').checked,
              showLinks: m.querySelector('#p-links').checked,
              showCriticalPath: m.querySelector('#p-critical').checked,
              showTimes: m.querySelector('#p-times').checked
            };
            const picked = Array.from(m.querySelectorAll('[data-p-label]')).filter((x) => x.checked).map((x) => x.dataset.pLabel);
            viewPatch.barLabelFields = picked.length ? picked : ['name'];
            if (isNew) {
              const created = Model.blankProject(name);
              created.lead = lead;
              created.tabName = tabName;
              created.startDate = start;
              created.defaultCalendarId = calendarId || created.defaultCalendarId;
              created.currency = currency;
              created.money = Object.assign({}, created.money, { decimals });
              created.estimatedBudget = isFinite(budget) ? budget : null;
              created.notes = notes;
              created.appearance = Object.assign({}, created.appearance, appearancePatch);
              created.view = Object.assign({}, created.view, viewPatch);
              created.view.showCosts = showCosts;
              Store.createTab(Model.normalizeProject(created, name), { name, dirty: true });
              U.toast('Project created', 'ok');
            } else {
              Store.mutate((proj) => {
                proj.name = name;
                proj.tabName = tabName;
                proj.lead = lead;
                proj.startDate = start;
                proj.defaultCalendarId = calendarId || proj.defaultCalendarId;
                proj.currency = currency;
                proj.money = Object.assign({}, proj.money, { decimals });
                proj.estimatedBudget = isFinite(budget) ? budget : null;
                proj.notes = notes;
                proj.appearance = Object.assign({}, proj.appearance, appearancePatch);
                Object.assign(proj.view, viewPatch);
                proj.view.showCosts = showCosts;
              });
              U.toast('Project updated', 'ok');
            }
          }
        }
      ],
      onOpen: (m) => {
        const sel = m.querySelector('#p-costs');
        const sync = () => {
          const on = sel.value === 'show' || (sel.value === 'inherit' && Store.settings().showCosts);
          m.querySelectorAll('[data-cost]').forEach((el) => { el.style.display = on ? '' : 'none'; });
        };
        sel.addEventListener('change', sync);
        sync();

        const tabField = m.querySelector('#p-tabname');
        if (tabField) tabField.addEventListener('input', () => { tabField.style.borderColor = ''; });
      }
    });
  }

  // ---------- resources ----------
  function resources() {
    const tab = Store.active();
    if (!tab) return;
    const p = tab.project;
    const rowHtml = (r) =>
      '<tr data-res-row data-res-id="' + r.id + '">' +
      '<td><input type="text" data-res-name value="' + U.escapeHtml(r.name || '') + '"></td>' +
      '<td><input type="text" data-res-role value="' + U.escapeHtml(r.role || '') + '"></td>' +
      '<td><input type="number" min="0" step="0.01" data-res-rate value="' + (Number(r.rate) || 0) + '"></td>' +
      '<td><select data-res-unit>' + ['d', 'h', 'w'].map((u) => '<option value="' + u + '"' + ((r.rateUnit || 'd') === u ? ' selected' : '') + '>' + u + '</option>').join('') + '</select></td>' +
      '<td><input type="color" data-res-colour value="' + U.escapeHtml(r.colour || '#4d86c9') + '"></td>' +
      '<td><button class="mini-btn danger" data-res-remove title="Remove">' + U.icon('x') + '</button></td></tr>';
    const body =
      '<table class="dialog-table"><thead><tr><th style="width:24%">Name</th><th style="width:26%">Role</th><th style="width:15%">Rate</th><th style="width:8%">Unit</th><th style="width:8%">Colour</th><th></th></tr></thead>' +
      '<tbody id="res-body">' + (p.resources || []).map(rowHtml).join('') + '</tbody></table>' +
      '<button class="btn" style="margin-top:8px" data-add-res="1">' + U.icon('plus') + ' Add resource</button>' +
      '<div class="note-box" style="margin-top:10px">Rates are used to estimate task cost. Removing a resource also removes its assignments.</div>';

    open({
      title: 'Resources',
      subtitle: 'People and crews available to this project.',
      size: 'wide',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary',
          action: (m) => {
            const list = Array.from(m.querySelectorAll('[data-res-row]')).map((tr) => {
              const name = tr.querySelector('[data-res-name]').value.trim();
              if (!name) return null;
              return {
                id: tr.dataset.resId,
                name,
                role: tr.querySelector('[data-res-role]').value.trim(),
                rate: Number(tr.querySelector('[data-res-rate]').value) || 0,
                rateUnit: tr.querySelector('[data-res-unit]').value || 'd',
                colour: tr.querySelector('[data-res-colour]').value || '#4d86c9',
                email: '',
                notes: ''
              };
            }).filter(Boolean);
            Store.mutate((proj) => {
              proj.resources = list;
              const ids = new Set(list.map((r) => r.id));
              proj.tasks.forEach((t) => {
                t.resources = (t.resources || []).filter((a) => ids.has(a.resourceId));
              });
            });
            U.toast('Resources saved', 'ok');
          }
        }
      ],
      onOpen: (m) => {
        const bodyEl = m.querySelector('#res-body');
        const add = m.querySelector('[data-add-res]');
        if (add) add.addEventListener('click', () => {
          const id = U.uid();
          bodyEl.insertAdjacentHTML('beforeend', rowHtml({ id, name: 'New resource', role: '', rate: 0, rateUnit: 'd', colour: '#4d86c9' }));
          const last = bodyEl.lastElementChild;
          const input = last && last.querySelector('[data-res-name]');
          if (input) { input.focus(); input.select(); }
        });
        m.querySelector('.modal-body').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-res-remove]');
          if (btn) {
            const tr = btn.closest('tr');
            if (tr) tr.remove();
          }
        });
      }
    });
  }

  // ---------- team calendar ----------
  function calendar() {
    const tab = Store.active();
    if (!tab) return;
    const p = tab.project;
    const cal = p.calendars.find((c) => c.id === p.defaultCalendarId) || p.calendars[0];
    if (!cal) return;
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const order = [1, 2, 3, 4, 5, 6, 0];
    const times = cal.workingTimes || [];
    const timeRows = order.map((wd) => {
      const ranges = times[wd] || [];
      const first = ranges[0] || { from: '08:00', to: '17:00' };
      const second = ranges[1] || { from: '', to: '' };
      const third = ranges[2] || { from: '', to: '' };
      return '<tr data-wd-row="' + wd + '">' +
        '<td><label class="check"><input type="checkbox" data-wd="' + wd + '"' + (cal.workingWeekdays[wd] ? ' checked' : '') + '> ' +
        weekdayNames[wd] + '</label></td>' +
        '<td><input type="time" data-time-from="0" value="' + U.escapeHtml(first.from || '') + '"></td>' +
        '<td><input type="time" data-time-to="0" value="' + U.escapeHtml(first.to || '') + '"></td>' +
        '<td><input type="time" data-time-from="1" value="' + U.escapeHtml(second.from || '') + '"></td>' +
        '<td><input type="time" data-time-to="1" value="' + U.escapeHtml(second.to || '') + '"></td>' +
        '<td><input type="time" data-time-from="2" value="' + U.escapeHtml(third.from || '') + '"></td>' +
        '<td><input type="time" data-time-to="2" value="' + U.escapeHtml(third.to || '') + '"></td>' +
        '</tr>';
    }).join('');
    const exceptions = (cal.holidays || []).map((h) => ({ date: h.date, name: h.name || '', type: 'holiday' }))
      .concat((cal.worksThrough || []).map((d) => ({ date: d, name: '', type: 'workday' })))
      .sort((a, b) => U.diffDays(b.date, a.date));
    const exRow = (x) =>
      '<tr data-ex-row><td><input type="date" data-ex-date value="' + U.escapeHtml(x ? x.date : '') + '"></td>' +
      '<td><select data-ex-type><option value="holiday"' + (x && x.type === 'holiday' ? ' selected' : '') + '>Holiday</option>' +
      '<option value="workday"' + (x && x.type === 'workday' ? ' selected' : '') + '>Working day</option></select></td>' +
      '<td><input type="text" data-ex-name value="' + U.escapeHtml(x ? x.name : '') + '" placeholder="Optional label"></td>' +
      '<td><button class="mini-btn danger" data-ex-remove title="Remove">' + U.icon('x') + '</button></td></tr>';

    const body =
      '<div class="form-grid"><label class="lbl">Calendar name</label><input id="cal-name" type="text" value="' + U.escapeHtml(cal.name) + '"></div>' +
      '<div class="section-title">Working week</div>' +
      '<table class="dialog-table" style="table-layout:fixed"><thead><tr><th style="width:22%">Day</th><th>From</th><th>To</th>' +
      '<th>From 2</th><th>To 2</th><th>From 3</th><th>To 3</th></tr></thead><tbody>' + timeRows + '</tbody></table>' +
      '<div class="section-title">Holidays &amp; exceptions</div>' +
      '<table class="dialog-table"><thead><tr><th style="width:32%">Date</th><th style="width:26%">Type</th><th>Label</th><th></th></tr></thead>' +
      '<tbody id="ex-body">' + exceptions.map(exRow).join('') + '</tbody></table>' +
      '<button class="btn" style="margin-top:8px" data-add-ex="1">' + U.icon('plus') + ' Add exception</button>' +
      '<div class="note-box" style="margin-top:10px">Non-working days are shaded in the timeline. Dependencies skip them automatically.</div>';

    open({
      title: 'Team calendar',
      subtitle: cal.name,
      size: 'wide',
      body,
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary',
          action: (m) => {
            const name = m.querySelector('#cal-name').value.trim() || 'Standard';
            const wd = [false, false, false, false, false, false, false];
            const workingTimes = [[], [], [], [], [], [], []];
            m.querySelectorAll('[data-wd-row]').forEach((tr) => {
              const idx = Number(tr.dataset.wdRow);
              const enabled = tr.querySelector('[data-wd]').checked;
              wd[idx] = enabled;
              if (!enabled) return;
              const ranges = [];
              [0, 1, 2].forEach((slot) => {
                const from = tr.querySelector('[data-time-from="' + slot + '"]').value;
                const to = tr.querySelector('[data-time-to="' + slot + '"]').value;
                if (from && to) ranges.push({ from, to });
              });
              workingTimes[idx] = ranges.length ? ranges : [{ from: '08:00', to: '17:00' }];
            });
            const holidays = [];
            const worksThrough = [];
            m.querySelectorAll('[data-ex-row]').forEach((tr) => {
              const date = tr.querySelector('[data-ex-date]').value;
              if (!date) return;
              const type = tr.querySelector('[data-ex-type]').value;
              const label = tr.querySelector('[data-ex-name]').value.trim();
              if (type === 'workday') worksThrough.push(date);
              else holidays.push({ date, name: label });
            });
            Store.mutate((proj) => {
              const target = proj.calendars.find((c) => c.id === cal.id) || proj.calendars[0];
              if (!target) return;
              target.name = name;
              target.workingWeekdays = wd;
              target.workingTimes = workingTimes;
              target.holidays = holidays;
              target.worksThrough = worksThrough;
            });
            U.toast('Calendar updated', 'ok');
          }
        }
      ],
      onOpen: (m) => {
        const exBody = m.querySelector('#ex-body');
        const add = m.querySelector('[data-add-ex]');
        if (add) add.addEventListener('click', () => {
          exBody.insertAdjacentHTML('beforeend', exRow({ date: U.todayISO(), name: '', type: 'holiday' }));
        });
        m.querySelector('.modal-body').addEventListener('click', (e) => {
          const btn = e.target.closest('[data-ex-remove]');
          if (btn) {
            const tr = btn.closest('tr');
            if (tr) tr.remove();
          }
        });
      }
    });
  }

  // ---------- app settings ----------
  function settings() {
    const s = Store.settings();
    const tab = Store.active();
    const zoom = tab ? (tab.project.view.zoom || 'day') : 'day';
    const body =
      '<div class="form-grid">' +
      '<label class="lbl">Theme</label><select id="s-theme">' +
      [['light', 'Light'], ['dark', 'Dark'], ['system', 'Follow system']].map((o) => '<option value="' + o[0] + '"' + (s.appTheme === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<label class="lbl">Date format</label><select id="s-datefmt">' +
      [['dd-mmm-yy', '14-Oct-26'], ['dd-mm-yyyy', '14-10-2026'], ['dd/mm/yyyy', '14/10/2026'], ['yyyy-mm-dd', '2026-10-14'], ['mmm d, yyyy', 'Oct 14, 2026']]
        .map((o) => '<option value="' + o[0] + '"' + (s.dateFormat === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<label class="lbl">Progress mode</label><select id="s-progress">' +
      [['manual', 'Manual % complete'], ['auto', 'Calculate from dates']].map((o) => '<option value="' + o[0] + '"' + (s.progressMode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<label class="lbl">Default zoom</label><select id="s-zoom">' +
      Object.keys(Gantt.ZOOM_LABEL).filter((z) => z !== 'hour').map((z) => '<option value="' + z + '"' + (zoom === z ? ' selected' : '') + '>' + Gantt.ZOOM_LABEL[z] + '</option>').join('') + '</select>' +
      '<label class="lbl">Bar style</label><select id="s-bar">' +
      Model.BAR_STYLES.map((b) => '<option value="' + b.id + '"' + (s.barStyle === b.id ? ' selected' : '') + '>' + b.label + '</option>').join('') + '</select>' +
      '<label class="lbl">Header style</label><select id="s-header">' +
      [['banner', 'Banner'], ['compact', 'Compact']].map((o) => '<option value="' + o[0] + '"' + (s.headerStyle === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '</div>' +
      '<div class="section-title">Visible by default</div>' +
      '<div class="check-row">' +
      '<label class="check"><input type="checkbox" id="s-links"' + (s.showLinks ? ' checked' : '') + '> Dependencies</label>' +
      '<label class="check"><input type="checkbox" id="s-critical"' + (s.showCriticalPath ? ' checked' : '') + '> Critical path</label>' +
      '<label class="check"><input type="checkbox" id="s-baseline"' + (s.showBaselineBars ? ' checked' : '') + '> Baseline bars</label>' +
      '<label class="check"><input type="checkbox" id="s-actual"' + (s.showActualBars ? ' checked' : '') + '> Actual bars</label>' +
      '<label class="check"><input type="checkbox" id="s-times"' + (s.showTimes ? ' checked' : '') + '> Show times</label>' +
      '</div>' +
      '<div class="section-title">Budgets &amp; costs</div>' +
      '<div class="check-row">' +
      '<label class="check"><input type="checkbox" id="s-costs"' + (s.showCosts ? ' checked' : '') + '> Show budget and cost figures</label>' +
      '</div>' +
      '<div class="note-box" style="margin-top:8px">Off by default, so the outline, dashboard and portfolio stay free of money columns. ' +
      'A single project can turn them back on in Project settings.</div>';

    open({
      title: 'App settings',
      subtitle: 'Applies to this workspace and the active project view.',
      body,
      buttons: [
        {
          label: 'Reset workspace', kind: 'danger', left: true,
          action: () => {
            confirm('Reset workspace', 'This removes every tab stored in this browser and restores the starting samples. Export a backup first.', { okLabel: 'Reset everything' })
              .then((ok) => {
                if (!ok) return;
                Store.resetAll();
                U.toast('Workspace reset', 'ok');
              });
            return false;
          }
        },
        { label: 'Cancel' },
        {
          label: 'Save', kind: 'primary',
          action: (m) => {
            const appTheme = m.querySelector('#s-theme').value;
            const dateFormat = m.querySelector('#s-datefmt').value;
            const progressMode = m.querySelector('#s-progress').value;
            const zoom = m.querySelector('#s-zoom').value;
            const barStyle = m.querySelector('#s-bar').value;
            const headerStyle = m.querySelector('#s-header').value;
            const showLinks = m.querySelector('#s-links').checked;
            const showCriticalPath = m.querySelector('#s-critical').checked;
            const showBaselineBars = m.querySelector('#s-baseline').checked;
            const showActualBars = m.querySelector('#s-actual').checked;
            const showTimes = m.querySelector('#s-times').checked;
            const showCosts = m.querySelector('#s-costs').checked;
            if (tab) {
              Store.mutate((p) => {
                p.view.zoom = zoom;
                p.appearance.barStyle = barStyle;
                p.appearance.headerStyle = headerStyle;
              });
            }
            Store.updateSettings({
              appTheme, dateFormat, progressMode, barStyle, headerStyle,
              showLinks, showCriticalPath, showBaselineBars, showActualBars, showTimes, showCosts
            });
            U.toast('Settings saved', 'ok');
          }
        }
      ]
    });
  }

  // ---------- columns ----------
  function columns() {
    const tab = Store.active();
    if (!tab) return;
    const project = tab.project;
    const hidden = new Set(project.view.hiddenColumns || []);

    const checkbox = (key, label, always) =>
      '<label class="check"' + (always ? ' style="opacity:.65"' : '') + '>' +
      '<input type="checkbox" data-col="' + key + '"' + (always || !hidden.has(key) ? ' checked' : '') +
      (always ? ' disabled' : '') + '> ' + U.escapeHtml(label) +
      (always ? ' <span class="pill">always</span>' : '') + '</label>';

    const customRow = (c) =>
      '<tr data-cc-row="1" data-cc-id="' + c.id + '">' +
      '<td style="width:30px"><input type="checkbox" data-col="custom.' + c.id + '"' +
      (hidden.has('custom.' + c.id) ? '' : ' checked') + '></td>' +
      '<td><input type="text" data-cc-name value="' + U.escapeHtml(c.label) + '" placeholder="Column name"></td>' +
      '<td style="width:86px"><input type="number" min="60" max="420" step="10" data-cc-width value="' + c.width + '"></td>' +
      '<td style="width:34px"><button class="mini-btn danger" data-cc-remove="1" title="Remove column">' +
      U.icon('x') + '</button></td></tr>';

    const body =
      '<div class="section-title">Standard columns</div>' +
      '<div class="check-row" style="display:grid;grid-template-columns:1fr 1fr;gap:7px 16px">' +
      Model.COLUMNS.map((c) => checkbox(c.key, c.label, c.always)).join('') +
      '</div>' +
      '<div class="section-title">Custom columns</div>' +
      '<table class="dialog-table"><thead><tr><th style="width:30px"></th><th>Name</th>' +
      '<th style="width:86px">Width</th><th style="width:34px"></th></tr></thead>' +
      '<tbody id="cc-body">' + Model.customColumnDefs(project).map(customRow).join('') + '</tbody></table>' +
      '<button class="btn" style="margin-top:8px" data-cc-add="1">' + U.icon('plus') + ' Add custom column</button>' +
      '<div class="note-box" style="margin-top:12px">Custom columns hold free text — type a value straight into the ' +
      'outline cell. The timeline is unaffected. Cost columns only appear while budget &amp; cost is switched on ' +
      '(Settings, or Project settings for one project).</div>';

    open({
      title: 'Columns',
      subtitle: 'Show or hide outline columns and add your own.',
      size: 'wide',
      body,
      onOpen: (m) => {
        const rows = m.querySelector('#cc-body');
        if (!rows) return;
        const addRow = () => {
          const id = U.uid();
          const tr = document.createElement('tr');
          tr.setAttribute('data-cc-row', '1');
          tr.dataset.ccId = id;
          tr.innerHTML = customRow({ id, label: '', width: 120 })
            .replace(/^<tr[^>]*>/, '')
            .replace(/<\/tr>$/, '');
          rows.appendChild(tr);
          return tr;
        };
        rows.addEventListener('click', (e) => {
          const rm = e.target.closest('[data-cc-remove]');
          if (!rm) return;
          const tr = rm.closest('[data-cc-row]');
          if (tr) tr.remove();
        });
        const add = m.querySelector('[data-cc-add]');
        if (add) {
          add.addEventListener('click', () => {
            const tr = addRow();
            const input = tr.querySelector('[data-cc-name]');
            if (input) input.focus();
          });
        }
      },
      buttons: [
        { label: 'Cancel' },
        {
          label: 'Apply', kind: 'primary',
          action: (m) => {
            const rows = Array.from(m.querySelectorAll('[data-cc-row]')).map((tr) => ({
              id: tr.dataset.ccId,
              label: tr.querySelector('[data-cc-name]').value.trim(),
              width: U.clamp(Number(tr.querySelector('[data-cc-width]').value) || 120, 60, 420)
            })).filter((r) => r.label);
            const kept = new Set(rows.map((r) => r.id));
            const visible = new Set(Array.from(m.querySelectorAll('[data-col]'))
              .filter((x) => x.checked || x.disabled).map((x) => x.dataset.col));
            visible.add('wbs');
            visible.add('name');
            const defs = Model.COLUMNS.concat(rows.map((r) => ({ key: 'custom.' + r.id })));
            const nextHidden = defs.filter((c) => !visible.has(c.key)).map((c) => c.key);
            const dropped = (project.customColumns || []).map((c) => c.id).filter((id) => !kept.has(id));
            Store.updateSettings({ hiddenColumns: nextHidden });
            Store.mutate((p) => {
              p.customColumns = rows;
              p.view.hiddenColumns = (p.view.hiddenColumns || [])
                .filter((k) => k.indexOf('custom.') !== 0 || kept.has(k.slice(7)));
              if (dropped.length) {
                p.tasks.forEach((t) => {
                  if (!t.custom) return;
                  dropped.forEach((id) => { delete t.custom[id]; });
                });
              }
            });
            U.toast('Columns updated', 'ok');
          }
        }
      ]
    });
  }

  // ---------- export ----------
  function exportRows(project) {
    return Model.flatten(project, { includeCollapsed: true }).map((r) => r);
  }
  function exportMatrix(project, opts) {
    opts = opts || {};
    const fmt = project.view.dateFormat || 'dd-mmm-yy';
    const rows = exportRows(project);
    const head = ['WBS', 'Task', 'Type', 'Start', 'End', 'Duration', '% complete', 'Resources', 'Priority', 'Status'];
    if (opts.costs !== false) head.push('Estimated cost', 'Actual cost');
    if (opts.baseline !== false) head.push('Baseline start', 'Baseline end');
    if (opts.notes !== false) head.push('Notes');
    const data = rows.map((r) => {
      const t = r.task;
      const names = resourceNames(project, t);
      const line = [
        r.wbs, t.name, t.type === 'milestone' ? 'Milestone' : (r.hasChildren ? 'Summary' : 'Task'),
        U.fmtDate(t.start, fmt), U.fmtDate(t.end || t.start, fmt),
        U.formatDuration(Model.durationDays(project, t), project.hoursPerDay, t),
        Math.round(Number(t.percentComplete) || 0) + '%', names.join(', '), t.priority, t.status
      ];
      if (opts.costs !== false) line.push(
        t.estimatedCost == null ? '' : t.estimatedCost,
        t.actualCost == null ? '' : t.actualCost
      );
      if (opts.baseline !== false) line.push(
        t.baselineStart ? U.fmtDate(t.baselineStart, fmt) : '',
        t.baselineEnd ? U.fmtDate(t.baselineEnd, fmt) : ''
      );
      if (opts.notes !== false) line.push(t.notes || '');
      return line;
    });
    return [head].concat(data);
  }
  function resourceNames(project, task) {
    return (task.resources || []).map((a) => {
      const r = project.resources.find((x) => x.id === a.resourceId);
      return r ? r.name : null;
    }).filter(Boolean);
  }
  function downloadCsv(project, opts) {
    const matrix = exportMatrix(project, opts);
    U.download(U.slug(project.name) + '.csv', '\ufeff' + U.csv(matrix), 'text/csv');
    U.toast('CSV exported', 'ok');
  }
  function downloadXls(project, opts) {
    const matrix = exportMatrix(project, opts);
    const head = matrix[0];
    const html = '<html><head><meta charset="utf-8"><title>' + U.escapeHtml(project.name) + '</title></head><body>' +
      '<h2>' + U.escapeHtml(project.name) + '</h2>' +
      '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:11px">' +
      '<thead><tr>' + head.map((h) => '<th style="background:#e8eef6;text-align:left">' + U.escapeHtml(h) + '</th>').join('') + '</tr></thead>' +
      '<tbody>' + matrix.slice(1).map((row) => '<tr>' + row.map((v) => '<td>' + U.escapeHtml(v) + '</td>').join('') + '</tr>').join('') + '</tbody>' +
      '</table></body></html>';
    U.download(U.slug(project.name) + '.xls', html, 'application/vnd.ms-excel');
    U.toast('Excel workbook exported', 'ok');
  }
  // ---------- print / PDF / PNG ----------
  // A3 landscape, 9 mm margin, expressed at 96 dpi. Both PDF and PNG use this
  // page: the detail table is the fixed seven-column outline and the chart
  // stretches across the rest of the sheet instead of leaving a blank strip.
  const PRINT_PAGE = { width: 420, height: 297, margin: 9 };

  function printCss() {
    let out = '';
    Array.from(document.styleSheets).forEach((sheet) => {
      let rules = null;
      try { rules = sheet.cssRules; } catch (e) { rules = null; }
      if (!rules) return;
      Array.from(rules).forEach((r) => { out += r.cssText + '\n'; });
    });
    return out;
  }

  // The export can show referenced plans beside the open one, so the summary
  // has to be computed over every visible row — not just the open project's own
  // tasks. That is why a reference-only page used to print 0 % / 0 tasks.
  function exportStats(project, rows) {
    const today = U.todayISO();
    const leaves = [];
    (rows || []).forEach((row) => {
      if (!row || !row.task || row.hasChildren) return;
      const owner = (row.entry && row.entry.project) || project;
      leaves.push({ task: row.task, owner });
    });
    let weight = 0, doneW = 0;
    leaves.forEach(({ task, owner }) => {
      const w = Math.max(0.5, Model.durationDays(owner, task));
      weight += w;
      doneW += w * (Number(task.percentComplete) || 0) / 100;
    });
    const percent = weight ? U.round(doneW / weight * 100) : 0;
    const starts = leaves.map((x) => x.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const ends = leaves.map((x) => x.task.end || x.task.start).filter(Boolean).sort((a, b) => U.diffDays(b, a));
    const first = starts[0] || project.startDate || today;
    const last = ends[ends.length - 1] || first;
    const cal = Model.calendarFor(project, null);
    const span = U.workingDaysBetween(first, last, cal);
    const elapsed = U.workingDaysBetween(first, U.diffDays(last, today) > 0 ? last : today, cal);
    const planned = span ? U.clamp(U.round(elapsed / span * 100), 0, 100) : 0;
    const done = leaves.filter((x) => x.task.status === 'done').length;
    const underway = leaves.filter((x) => x.task.status === 'underway').length;
    const plannedCount = leaves.filter((x) => x.task.status === 'planned').length;
    const late = leaves.filter((x) => x.task.status === 'late').length;

    // People are merged by name across the open and referenced plans; the same
    // person has a different roster id in each project.
    const peopleMap = new Map();
    leaves.forEach(({ task, owner }) => {
      const byId = new Map((owner.resources || []).map((r) => [r.id, r]));
      (task.resources || []).forEach((a) => {
        const r = byId.get(a.resourceId);
        const name = r && r.name ? String(r.name).trim() : '';
        if (!name) return;
        const key = name.toLowerCase();
        let p = peopleMap.get(key);
        if (!p) {
          p = { name, role: r.role || '', tasks: 0, done: 0, late: 0 };
          peopleMap.set(key, p);
        }
        p.tasks += 1;
        if ((Number(task.percentComplete) || 0) >= 100) p.done += 1;
        if (task.status === 'late') p.late += 1;
      });
    });
    const people = Array.from(peopleMap.values()).sort((a, b) => b.tasks - a.tasks);

    let estimated = 0, actual = 0, baseline = 0;
    leaves.forEach(({ task, owner }) => {
      estimated += Number(task.estimatedCost != null ? task.estimatedCost
        : (task.cost != null ? task.cost : Model.resourceCost(owner, task)) || 0);
      actual += Number(task.actualCost) || 0;
      baseline += Number(task.baselineCost) || 0;
    });
    const owners = new Set();
    leaves.forEach(({ owner }) => owners.add(owner));
    let budget = 0;
    owners.forEach((p) => {
      budget += Number(p.estimatedBudget != null ? p.estimatedBudget : (p.baselineBudget || 0));
    });
    if (!budget && project.estimatedBudget != null) budget = Number(project.estimatedBudget);
    const milestones = leaves
      .filter((x) => x.task.type === 'milestone' && x.task.start && U.diffDays(today, x.task.start) >= 0)
      .map((x) => x.task)
      .sort((a, b) => U.diffDays(b.start, a.start));

    return {
      percent, planned, pointsBehind: Math.max(0, Math.round(planned - percent)),
      taskCount: leaves.length, done, underway, plannedCount, late,
      estimated, actual, baseline, budget,
      costPercent: budget ? U.clamp(U.round(actual / budget * 100), 0, 100) : 0,
      first, last, milestones, remaining: Math.max(0, budget - actual),
      people
    };
  }

  function buildPrintDocument(project, opts) {
    opts = opts || {};
    const view = project.view || {};
    const fmt = view.dateFormat || 'dd-mmm-yy';
    const today = U.todayISO();
    const esc = U.escapeHtml;

    const outline = Gantt.printOutline(project);
    if (!outline.count) { U.toast('Nothing to export — this view has no rows', 'warn'); return null; }
    const stats = exportStats(project, outline.rowsData);

    const ROW_H = 24;
    const HEAD_H = 52;
    const usableW = Math.round((PRINT_PAGE.width - PRINT_PAGE.margin * 2) * 96 / 25.4);
    const usableH = Math.round((PRINT_PAGE.height - PRINT_PAGE.margin * 2) * 96 / 25.4);

    // The outline keeps its normal, readable size. The chart is rendered to the
    // width that remains on the sheet, so the whole plan (reference blocks
    // included) fits inside the page width — no blank months and no tile pages.
    const leftW = outline.total;
    const chartW = Math.max(220, usableW - leftW);
    const timeline = Gantt.printTimeline(project, chartW);
    if (!timeline) { U.toast('Nothing to export — this view has no rows', 'warn'); return null; }

    const headHtml = '<div class="task-head" style="width:' + leftW + 'px">' + outline.head + '</div>';
    const rowsHtml = '<div class="task-rows" style="width:' + leftW + 'px">' + outline.rows + '</div>';
    const tlHeadHtml = timeline.head;
    const canvasHtml = timeline.canvas;
    const sprite = document.querySelector('.svg-sprite');

    // One page wide: the table and the chart were built to the exact sheet
    // width, so nothing is scaled down and the type stays readable.
    const scale = 1;
    const bandW = timeline.width;
    const tiles = 1;

    // Row capacity per sheet, in whole rows, at the resolution it prints at.
    const rowPx = ROW_H;
    const headPx = HEAD_H;
    // Title/KPIs on the first sheet, repeated run label on later ones.
    const chrome = 34;
    const firstChrome = 126;
    const count = outline.count;
    const pages = [];
    let cursor = 0;
    let isFirst = true;
    while (cursor < count) {
      const room = usableH - chrome - headPx - (isFirst ? firstChrome : 0);
      const take = Math.max(3, Math.floor(room / rowPx));
      const end = Math.min(count, cursor + take);
      for (let tile = 0; tile < tiles; tile += 1) {
        pages.push({ from: cursor, count: end - cursor, tile, first: isFirst && tile === 0, lead: isFirst && tile === 0 });
      }
      cursor = end;
      isFirst = false;
    }

    const pal = Model.paletteOf(project);
    const people = stats.people;
    const kpis = [
      '<div class="kpi"><span class="k">COMPLETE</span><b>' + stats.percent + '%</b><span class="d">' +
        stats.done + ' of ' + stats.taskCount + ' tasks</span></div>',
      '<div class="kpi"><span class="k">STATUS</span><b>' + stats.taskCount + ' tasks</b><span class="d">' +
        stats.done + ' done · ' + stats.underway + ' under way · ' + stats.plannedCount + ' planned · ' + stats.late + ' late</span></div>',
      '<div class="kpi"><span class="k">PEOPLE</span><b>' + people.length + (people.length === 1 ? ' person' : ' people') +
        '</b><span class="d">' + people.reduce((a, x) => a + x.tasks, 0) + ' assigned tasks</span></div>'
    ];
    if (Model.costVisible(project)) {
      const over = stats.budget > 0 && stats.actual > stats.budget;
      kpis.push('<div class="kpi"><span class="k">COST</span><b>' + U.formatMoney(stats.actual, project) + '</b><span class="d">' +
        (stats.budget > 0
          ? (over ? 'over by ' + U.formatMoney(stats.actual - stats.budget, project)
            : U.formatMoney(stats.remaining, project) + ' left of ' + U.formatMoney(stats.budget, project))
          : 'no budget set') + '</span></div>');
    }

    const legend = '<div class="legend">' +
      '<span><i style="background:' + pal.bar + '"></i>Plan</span>' +
      '<span><i style="background:' + pal.progress + '"></i>Progress</span>' +
      (view.showBaselineBars ? '<span><i style="background:#d99a57"></i>Baseline</span>' : '') +
      (view.showActualBars ? '<span><i style="background:#2e9e70"></i>Actual</span>' : '') +
      '<span><i class="dia" style="background:' + pal.milestone + '"></i>Milestone</span>' +
      (view.showCriticalPath ? '<span><i style="background:#cf3f3f"></i>Critical</span>' : '') +
      '</div>';

    const sheet = (p, index) => {
      const clipH = p.count * ROW_H;
      const offset = p.from * ROW_H;
      const tileW = bandW;
      const runs = [];
      if (p.from > 0) runs.push('rows ' + (p.from + 1) + '–' + (p.from + p.count));
      const running = runs.length ? runs.join(' · ') : '';
      return '<section class="sheet">' +
        (p.lead
          ? '<div class="ttl"><div><h1>' + esc(project.name) + '</h1><p class="sub">' +
            esc((project.lead ? project.lead + ' · ' : '') +
              U.fmtDate(stats.first || project.startDate || today, fmt) + ' → ' +
              U.fmtDate(stats.last || today, fmt) + ' · ' + stats.taskCount + ' tasks') +
            '</p></div><div class="stamp">' + U.fmtDate(today, fmt) + '</div></div>'
          : '') +
        (p.lead ? '<div class="kpis">' + kpis.join('') + '</div>' : '') +
        (running ? '<div class="run">' + esc(project.name) + ' · ' + esc(running) + '</div>' : '') +
        '<div class="snap" style="zoom:' + scale + ';width:' + (leftW + tileW) + 'px">' +
          '<div class="snap-head">' +
            '<div class="clip" style="width:' + leftW + 'px;height:' + HEAD_H + 'px">' + headHtml + '</div>' +
            '<div class="clip" style="width:' + tileW + 'px;height:' + HEAD_H + 'px">' + tlHeadHtml + '</div>' +
          '</div>' +
          '<div class="snap-body">' +
            '<div class="clip" style="width:' + leftW + 'px;height:' + clipH + 'px">' +
              '<div style="margin-top:-' + offset + 'px">' + rowsHtml + '</div></div>' +
            '<div class="clip" style="width:' + tileW + 'px;height:' + clipH + 'px">' +
              '<div style="position:relative;top:-' + offset + 'px;width:' + tileW + 'px">' +
                canvasHtml + '</div></div>' +
          '</div>' +
        '</div>' +
        (p.first ? legend : '') +
        '<div class="foot"><span>GanttDesk · ' +
          (index + 1) + ' / ' + pages.length + '</span></div>' +
        '</section>';
    };

    const sheetCss =
      '@page{size:A3 landscape;margin:9mm}' +
      'html,body{height:auto!important;overflow:visible!important;background:#fff!important;margin:0}' +
      'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:0}' +
      '.sheet{padding:0 0 2mm}' +
      '.sheet + .sheet{break-before:page}' +
      '.ttl{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:0 0 2mm}' +
      '.ttl h1{font:600 15px/1.2 var(--font);margin:0;color:var(--text)}' +
      '.ttl .sub{margin:2px 0 0;font-size:9px;color:var(--muted)}' +
      '.ttl .stamp{font-size:8.5px;color:var(--muted-2);white-space:nowrap}' +
      '.run{font-size:9px;color:var(--muted);margin:0 0 1.5mm}' +
      '.kpis{display:flex;gap:6px;margin:0 0 2.5mm}' +
      '.kpi{flex:1 1 0;min-width:0;border:1px solid var(--line);border-radius:4px;padding:4px 6px;background:var(--panel-2);overflow:hidden}' +
      '.kpi .k{display:block;font-size:7.5px;letter-spacing:.7px;color:var(--muted);font-weight:700}' +
      '.kpi b{display:block;font-size:14px;line-height:1.15;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.kpi .d{display:block;color:var(--muted);font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.snap-head{display:flex;border-bottom:1px solid var(--line);background:var(--panel-2)}' +
      '.snap-body{display:flex}' +
      '.clip{overflow:hidden;flex:0 0 auto}' +
      '.snap .task-rows{overflow:visible!important;flex:0 0 auto;height:auto!important;max-height:none!important}' +
      '.snap .task-head{overflow:hidden;flex:0 0 auto}' +
      '.snap .timeline-canvas{min-height:0}' +
      '.snap .add-row,.snap .empty-row{display:none}' +
      '.snap .task-row .cell{font-size:12px}' +
      '.snap .task-head-cell{font-size:10px}' +
      '.snap .gbar .bar-label{font-size:11px}' +
      '.snap .gbar .bar-progress-label{font-size:9px}' +
      '.legend{display:flex;flex-wrap:wrap;gap:3px 12px;margin:2mm 0 0;color:var(--muted);font-size:8.5px}' +
      '.legend span{display:inline-flex;align-items:center;gap:4px}' +
      '.legend i{width:11px;height:6px;border-radius:1px;display:inline-block}' +
      '.legend i.dia{width:6px;height:6px;transform:rotate(45deg)}' +
      '.foot{display:flex;justify-content:flex-end;color:var(--muted-2);font-size:8px;margin-top:1.5mm}';

    const appCss = printCss();
    // Inline whenever the CSSOM is readable (it always is for the stylesheet
    // inlined in index.html); the <link> is only a last-resort fallback for a
    // browser that refuses to expose rule text.
    const linkHref = (() => { try { return new URL('styles.css', document.baseURI).href; } catch (e) { return 'styles.css'; } })();
    const styleTag = appCss.length > 800
      ? '<style>' + appCss + '</style>'
      : '<link rel="stylesheet" href="' + linkHref + '">';
    const theme = document.documentElement.getAttribute('data-theme') || 'light';
    const rootStyle = document.documentElement.getAttribute('style') || '';

    const html = '<!doctype html><html lang="en" data-theme="' + theme + '" style="' + rootStyle + '"><head>' +
      '<meta charset="utf-8"><title>' + esc(project.name) + '</title>' +
      styleTag + '<style>' + sheetCss + '</style></head><body>' +
      (sprite ? sprite.outerHTML : '') +
      pages.map(sheet).join('') +
      '</body></html>';

    return { html, pages: pages.length, width: usableW, height: usableH, appCss, sheetCss };
  }

  // Every sheet of the print document can be rasterised on its own at page
  // size. PDF and PNG exports share this renderer, so both always show the
  // same pages.
  function pageRenderer(doc) {
    const parsed = new DOMParser().parseFromString(doc.html, 'text/html');
    const sheets = Array.from(parsed.querySelectorAll('.sheet'));
    // Void elements other than <br> do not serialise as XML inside a
    // foreignObject, and the print script must not travel with the image.
    parsed.querySelectorAll('meta, link, script').forEach((el) => el.remove());

    const pageW = Math.round(PRINT_PAGE.width * 96 / 25.4);
    const pageH = Math.round(PRINT_PAGE.height * 96 / 25.4);
    const margin = Math.round(PRINT_PAGE.margin * 96 / 25.4);
    const pageCss =
      'html,body{width:' + pageW + 'px;height:' + pageH + 'px;margin:0;padding:0;overflow:hidden;background:#fff}' +
      'body{padding:' + margin + 'px;box-sizing:border-box}' +
      '.sheet{padding:0!important}';

    // Styles inside <head> are not applied when the document is serialised
    // into a foreignObject; the old renderer proved that a <style> placed as
    // the first child of the root node is. Keep that shape: one root element
    // carrying every rule, followed by the page body.
    const cssText = Array.from(parsed.querySelectorAll('style')).map((s) => s.textContent).join('\n');
    // If the print document had to fall back to a <link>, the parsed copy has
    // no rule text; put the strings we already hold back in.
    const css = cssText.length > 800 ? cssText : (doc.appCss || '') + '\n' + (doc.sheetCss || '');
    const sprite = parsed.querySelector('.svg-sprite');

    const render = (index) => new Promise((resolve, reject) => {
      const sheet = sheets[index];
      if (!sheet) { reject(new Error('page ' + (index + 1) + ' is missing')); return; }
      const tree = parsed.documentElement.cloneNode(false);
      const styleEl = parsed.createElement('style');
      styleEl.textContent = css + '\n' + pageCss;
      tree.appendChild(styleEl);
      const body = parsed.createElement('body');
      // The sprite lives outside the sheet in the print document; without it
      // every <use href="#i-…"> inside the page would rasterise blank.
      if (sprite) body.appendChild(sprite.cloneNode(true));
      body.appendChild(sheet.cloneNode(true));
      tree.appendChild(body);
      const xml = new XMLSerializer().serializeToString(tree);
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + pageW + '" height="' + pageH + '">' +
        '<foreignObject x="0" y="0" width="100%" height="100%">' + xml + '</foreignObject></svg>';
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('this browser cannot rasterise the plan'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });

    return { count: sheets.length, pageW, pageH, render };
  }

  // Direct PDF export: every sheet is drawn at ~288 dpi and written as one A3
  // page of a real .pdf file. No print dialog and no popup window — WebView2
  // does not open either, which is why printing used to fail in the desktop
  // build.
  function printProject(project, opts) {
    const doc = buildPrintDocument(project, opts);
    if (!doc) return;
    const view = pageRenderer(doc);
    if (!view.count) { U.toast('Nothing to export', 'warn'); return; }
    U.toast('Building PDF — ' + view.count + (view.count === 1 ? ' page…' : ' pages…'), 'ok', 1400);
    const scale = 3;
    (async () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(view.pageW * scale);
      canvas.height = Math.round(view.pageH * scale);
      const ctx = canvas.getContext('2d');
      const pages = [];
      for (let i = 0; i < view.count; i += 1) {
        const img = await view.render(i);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        pages.push({
          bytes: Pdf.jpegBytesFromDataUrl(canvas.toDataURL('image/jpeg', 0.92)),
          width: canvas.width,
          height: canvas.height
        });
      }
      const blob = Pdf.fromJpegPages(pages, PRINT_PAGE.width * 72 / 25.4, PRINT_PAGE.height * 72 / 25.4);
      U.download(U.slug(project.name) + '-' + U.todayISO() + '-A3.pdf', blob, 'application/pdf');
      U.toast('PDF exported — ' + view.count + (view.count === 1 ? ' page' : ' pages') +
        ', A3 landscape (' + canvas.width + ' × ' + canvas.height + ' px)', 'ok', 3200);
    })().catch((err) => {
      U.toast('PDF export failed: ' + ((err && err.message) || err), 'warn', 4000);
    });
  }

  function exportDialog() {
    const tab = Store.active();
    if (!tab) return;
    const body =
      '<div class="check-row">' +
      '<label class="check"><input type="checkbox" id="x-costs" checked> Include cost columns</label>' +
      '<label class="check"><input type="checkbox" id="x-baseline" checked> Include baseline columns</label>' +
      '<label class="check"><input type="checkbox" id="x-notes" checked> Include notes</label>' +
      '</div>' +
      '<div class="section-title">Choose a format</div>' +
      '<div class="note-box">PDF and PNG both use an A3 landscape sheet. The detail table keeps WBS, task, start, end, duration, progress and resources at a readable size, ' +
      'and the whole timeline is fitted into the remaining page width. Summary figures include referenced plans, and the project name is omitted from the footer. ' +
      'PDF is written directly as a multi-page A3 file (~288 dpi); PNG stacks every page into one tall image. ' +
      'Excel opens the .xls table in Excel, Numbers or LibreOffice. The .dplan JSON file is the full editable project backup.</div>';
    open({
      title: 'Export',
      subtitle: tab.project.name,
      body,
      buttons: [
        {
          label: 'Plan file (.dplan)', action: (m) => {
            const opts = exportOptions(m);
            U.download(U.slug(tab.project.name) + '.dplan', JSON.stringify(tab.project, null, 2), 'application/json');
            U.toast('Project file exported', 'ok');
            void opts;
          }
        },
        {
          label: 'CSV', action: (m) => downloadCsv(tab.project, exportOptions(m))
        },
        {
          label: 'Excel (.xls)', action: (m) => downloadXls(tab.project, exportOptions(m))
        },
        {
          label: 'PNG image (A3)', action: (m) => { close(); exportImage(); void m; }
        },
        {
          label: 'PDF (A3)', action: (m) => printProject(tab.project, exportOptions(m))
        }
      ]
    });
  }
  function exportOptions(m) {
    return {
      costs: m.querySelector('#x-costs').checked,
      baseline: m.querySelector('#x-baseline').checked,
      notes: m.querySelector('#x-notes').checked
    };
  }

  // ---------- project management ----------
  // The pinned Overview tab is a page, so it is not listed as a managed
  // project here; every other open, closed or archived project is.
  function projects() {
    const allProjects = Store.allProjects();
    const items = allProjects
      .filter((entry) => entry.id !== Store.OVERVIEW_ID)
      .map((entry) => ({
        entry,
        p: entry.project,
        percent: Model.statsWithReferences(entry.project, allProjects).percent
      }))
      .sort((a, b) => {
        const rank = (x) => x.p.archived ? 2 : (x.entry.open ? 0 : 1);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return String(a.p.name || '').localeCompare(String(b.p.name || ''));
      });
    const openCount = items.filter((x) => x.entry.open).length;

    const body =
      '<div class="pm-tools">' +
        '<input id="pmSearch" class="pm-search" type="search" placeholder="Search project no., name or lead" autocomplete="off">' +
        '<select id="pmFilter">' +
          '<option value="all">All projects</option>' +
          '<option value="open">Open</option>' +
          '<option value="closed">Closed</option>' +
          '<option value="archived">Archived</option>' +
          '<option value="complete">100% complete</option>' +
        '</select>' +
        '<span class="pm-count" id="pmCount"></span>' +
      '</div>' +
      '<div class="note-box">Open, edit, archive or delete projects. Archiving is available only when progress reaches 100%.</div>' +
      '<div style="max-height:55vh;overflow:auto;margin-top:8px">' +
        '<table class="dialog-table pm-table"><thead><tr>' +
          '<th>PROJECT NO.</th><th>PROJECT</th><th>TASKS</th><th>PROGRESS</th><th>LEAD</th><th>STATE</th><th></th>' +
        '</tr></thead><tbody id="pmBody"></tbody></table>' +
      '</div>';

    open({
      title: 'Project management',
      subtitle: openCount + ' open · ' + items.length + ' total',
      size: 'wide',
      body,
      buttons: [
        { label: 'New project', kind: 'primary', action: () => { project(); return false; } }
      ],
      onOpen: (m) => {
        const search = m.querySelector('#pmSearch');
        const filter = m.querySelector('#pmFilter');
        const tbody = m.querySelector('#pmBody');
        const count = m.querySelector('#pmCount');

        const paint = () => {
          const q = String(search.value || '').trim().toLowerCase();
          const mode = filter.value;
          const list = items.filter(({ entry, p, percent }) => {
            const name = String(p.name || '').toLowerCase();
            const no = String(Model.tabLabel(p)).toLowerCase();
            const lead = String(p.lead || '').toLowerCase();
            if (q && !(name.includes(q) || no.includes(q) || lead.includes(q))) return false;
            if (mode === 'open' && (!entry.open || p.archived)) return false;
            if (mode === 'closed' && (entry.open || p.archived)) return false;
            if (mode === 'archived' && !p.archived) return false;
            if (mode === 'complete' && percent < 100) return false;
            return true;
          });
          count.textContent = list.length + ' / ' + items.length;
          tbody.innerHTML = list.map(({ entry, p, percent }) => {
            const pal = Model.paletteOf(p);
            const id = U.escapeHtml(entry.id);
            const state = p.archived ? 'Archived' : (entry.open ? 'Open' : 'Closed');
            const current = entry.open && Store.active() && Store.active().id === entry.id;
            const canArchive = percent >= 100;
            const archiveBtn = p.archived
              ? '<button class="mini-btn" data-pm-archive="' + id + '" data-pm-mode="unarchive" title="Unarchive project">' + U.icon('undo') + '</button>'
              : '<button class="mini-btn" data-pm-archive="' + id + '" data-pm-mode="archive" title="' +
                (canArchive ? 'Archive project' : 'Complete 100% before archiving') + '"' +
                (canArchive ? '' : ' disabled') + '>' + U.icon('archive') + '</button>';
            return '<tr data-pm-project="' + id + '">' +
              '<td style="white-space:nowrap"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
                U.escapeHtml(pal.accent) + ';margin-right:6px;vertical-align:1px"></span>' +
                U.escapeHtml(Model.tabLabel(p)) + '</td>' +
              '<td>' + U.escapeHtml(p.name) + (entry.sample ? ' <span class="pill">sample</span>' : '') + '</td>' +
              '<td style="text-align:center">' + (p.tasks || []).length + '</td>' +
              '<td><div class="pm-progress"><span class="track"><i class="fill' + (percent >= 100 ? ' full' : '') +
                '" style="width:' + percent + '%"></i></span><b>' + percent + '%</b></div></td>' +
              '<td>' + U.escapeHtml(p.lead || '—') + '</td>' +
              '<td>' + state + (current ? ' · current' : '') + '</td>' +
              '<td><div class="pm-actions">' +
                '<button class="mini-btn" data-pm-open="' + id + '" title="Open project">' + U.icon('open') + '</button>' +
                '<button class="mini-btn" data-pm-edit="' + id + '" title="Edit project">' + U.icon('pencil') + '</button>' +
                archiveBtn +
                '<button class="mini-btn danger" data-pm-delete="' + id + '" title="Delete project">' + U.icon('trash') + '</button>' +
              '</div></td></tr>';
          }).join('') || '<tr><td colspan="7" style="color:var(--muted)">No matching projects.</td></tr>';
        };

        search.addEventListener('input', paint);
        filter.addEventListener('change', paint);

        m.addEventListener('click', (e) => {
          const openBtn = e.target.closest('[data-pm-open]');
          if (openBtn) { Store.openProject(openBtn.dataset.pmOpen); close(); return; }
          const editBtn = e.target.closest('[data-pm-edit]');
          if (editBtn) {
            Store.openProject(editBtn.dataset.pmEdit);
            const t = Store.active();
            if (t) project({ project: t.project });
            return;
          }
          const arcBtn = e.target.closest('[data-pm-archive]');
          if (arcBtn) {
            const item = items.find((x) => x.entry.id === arcBtn.dataset.pmArchive);
            if (!item) return;
            const archiving = arcBtn.dataset.pmMode === 'archive';
            if (archiving && item.percent < 100) {
              U.toast('Complete 100% before archiving', 'warn');
              return;
            }
            Store.setArchived(item.entry.id, archiving);
            item.p.archived = archiving;
            U.toast(archiving ? 'Project archived' : 'Project unarchived', 'ok');
            paint();
            return;
          }
          const delBtn = e.target.closest('[data-pm-delete]');
          if (!delBtn) return;
          const item = items.find((x) => x.entry.id === delBtn.dataset.pmDelete);
          if (!item) return;
          confirm(
            'Delete project',
            'Delete “' + item.p.name + '” permanently from this browser? Tasks, resources and its saved workspace will be removed. This cannot be undone.',
            { okLabel: 'Delete project', cancelLabel: 'Cancel' }
          ).then((ok) => {
            if (ok) {
              Store.removeProject(item.entry.id);
              U.toast('Project deleted', 'ok');
            }
            projects();
          });
        });

        paint();
      }
    });
  }

  // ---------- reference another project ----------
  // The insert is a reference, not a copy: the target keeps one record saying
  // "also show project X here", and every row is read from X when the chart is
  // drawn. Editing such a row writes back to X, so both places always agree.
  function referenceProject(opts) {
    opts = opts || {};
    const list = (opts.candidates || []).slice();
    if (!list.length) {
      U.toast('No other project left to reference', 'warn');
      return;
    }
    // Biggest plan first: the empty starter tab used to sit at the top and be
    // preselected, so "Reference" quietly inserted a nameless, empty project.
    const ranked = list.slice().sort((a, b) => {
      const an = (a.project.tasks || []).length;
      const bn = (b.project.tasks || []).length;
      if (an !== bn) return bn - an;
      return String(a.project.name || '').localeCompare(String(b.project.name || ''));
    });
    const options = ranked.map((p, i) => '<option value="' + U.escapeHtml(p.id) + '"' +
      (i === 0 ? ' selected' : '') + '>' +
      U.escapeHtml(p.project.name || 'Untitled project') + ' \u00b7 ' + p.project.tasks.length + ' tasks</option>').join('');
    open({
      title: 'Reference project',
      subtitle: opts.subtitle || 'Show another plan inside this one',
      body:
        '<div class="field"><label>Project</label><select id="ip-project">' + options + '</select></div>' +
        '<div class="note-box">The plan is linked, not copied: its tasks appear here as a phase, and any change ' +
        'made in either place — dates, progress, new tasks — shows up in both.</div>',
      buttons: [
        { label: 'Cancel' },
        { label: 'Reference', kind: 'primary', action: (m) => {
          const id = m.querySelector('#ip-project').value;
          if (id) opts.onPick(id);
        } }
      ]
    });
  }

  // ---------- image export ----------
  function exportImage() {
    const tab = Store.active();
    if (!tab) { U.toast('Open a project first', 'warn'); return; }
    const doc = buildPrintDocument(tab.project, {});
    if (!doc) return;

    // Every sheet of the same document the PDF writes: sheets are stacked
    // into one tall PNG, so a single image still shows every page.
    const view = pageRenderer(doc);
    if (!view.count) { U.toast('Nothing to export', 'warn'); return; }

    U.toast('Rendering ' + view.count + (view.count === 1 ? ' page…' : ' pages…'), 'ok', 1200);

    (async () => {
      // A3 at 96 dpi is 1587 × 1123; rendering at 2× keeps the bars and the
      // small table type crisp.
      const outScale = 2;
      const c = document.createElement('canvas');
      c.width = view.pageW * outScale;
      c.height = view.pageH * outScale * view.count;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      for (let i = 0; i < view.count; i += 1) {
        const img = await view.render(i);
        ctx.drawImage(img, 0, view.pageH * outScale * i, view.pageW * outScale, view.pageH * outScale);
      }
      setCanvasBlob(c, tab, view);
    })().catch((err) => {
      U.toast('Image export failed: ' + ((err && err.message) || err), 'warn', 4000);
    });
  }

  function setCanvasBlob(c, tab, view) {
    c.toBlob((b) => {
      if (!b) { U.toast('Could not encode the image', 'warn'); return; }
      U.download(U.slug(tab.project.name) + '-' + U.todayISO() + '-A3.png', b, 'image/png');
      const pages = view ? view.count : 1;
      U.toast('PNG exported — ' + pages + (pages === 1 ? ' page' : ' pages') +
        ' (' + c.width + ' × ' + c.height + ' px)', 'ok', 3200);
    }, 'image/png');
  }

  // ---------- information dialogs ----------
  function shortcuts() {
    const list = [
      ['Ctrl + N', 'New project'], ['Ctrl + O', 'Open a plan'], ['Ctrl + S', 'Save all projects to ProjectPlan.dplan'],
      ['Ctrl + Shift + S', 'Save all projects (same file)'], ['Ctrl + P', 'Export to PDF'], ['Ctrl + W', 'Close tab'],
      ['Ctrl + Z / Ctrl + Y', 'Undo / redo'], ['Ctrl + A', 'Select all tasks'], ['Delete', 'Delete selected task'],
      ['Insert', 'Add task'], ['F2', 'Edit selected task'], ['Double-click cell', 'Edit the cell inline'],
      ['Enter', 'Edit current cell, then move down'], ['Tab / Shift + Tab', 'Next / previous cell'],
      ['Arrow keys', 'Move the cell cursor'], ['Delete on cell', 'Clear notes, cost or actuals'],
      ['Drag bar', 'Move task'], ['Drag left / right edge', 'Change start / duration'],
      ['Drag progress grip', 'Set % complete'], ['Drag link circle', 'Link to another bar'],
      ['Ctrl + wheel', 'Zoom the timeline at the pointer'], ['Middle-drag', 'Pan the timeline'],
      ['Right-click', 'Task, link and timeline menus'], ['Click twisty', 'Collapse phase']
    ];
    const body = '<div class="shortcut-list">' + list.map((row) =>
      '<div class="keys">' + row[0].split(' / ').map((k) => '<span class="kbd">' + U.escapeHtml(k) + '</span>').join(' / ') + '</div>' +
      '<div>' + U.escapeHtml(row[1]) + '</div>').join('') + '</div>';
    open({ title: 'Keyboard shortcuts', body, buttons: [{ label: 'Close', kind: 'primary' }] });
  }

  function about() {
    const body =
      '<div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">' +
      '<div style="width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#1e84d8,#0e4f8e);display:grid;place-items:center;color:#fff">' +
      '<svg style="width:28px;height:28px"><use href="#i-dashboard"/></svg></div>' +
      '<div><div style="font-size:17px;font-weight:700">GanttDesk</div>' +
      '<div style="color:var(--muted);font-size:11px">Gantt planner · version 1.0.0</div></div></div>' +
      '<div class="note-box">GanttDesk is an independent desktop-style project planner, built from scratch. ' +
      'It is not affiliated with, and contains no code or assets from, any commercial product. ' +
      'Project files use an open JSON format compatible with .dplan imports.</div>' +
      '<div class="section-title">Included</div>' +
      '<div class="check-row"><span class="pill">Outline &amp; WBS</span><span class="pill">FS / SS / FF / SF links</span>' +
      '<span class="pill">Critical path</span><span class="pill">Baselines</span><span class="pill">Resources</span>' +
      '<span class="pill">Work calendars</span><span class="pill">Dashboard</span><span class="pill">PDF / Excel export</span></div>';
    open({ title: 'About GanttDesk', body, buttons: [{ label: 'Close', kind: 'primary' }] });
  }

  function help() {
    const body =
      '<div class="section-title">Getting started</div>' +
      '<ol style="margin:0 0 10px 18px;padding:0;line-height:1.7">' +
      '<li>Use <b>Add task</b> to create an activity, then <b>Indent</b> it under a phase.</li>' +
      '<li>Link tasks from <b>Edit task → Predecessors</b> to build the dependency chain.</li>' +
      '<li>Drag a bar to move it, or drag its right edge to change duration.</li>' +
      '<li>Toggle <b>Dependencies</b> and <b>Critical path</b> in the ribbon to inspect the plan.</li>' +
      '<li>Open <b>Dashboard → Details</b> for phase progress and upcoming milestones.</li>' +
      '</ol>' +
      '<div class="section-title">Files</div>' +
      '<div class="note-box">Save writes every project in the workspace to one file, ProjectPlan.dplan. Open accepts that workspace file as well as single .dplan, .gxp and JSON plans. ' +
      'Import from Excel accepts CSV, TSV and .xlsx workbooks with columns such as Task, Start, End, Duration and Predecessors.</div>' +
      '<div class="section-title">Tips</div>' +
      '<div class="note-box">The workspace autosaves to this browser. Use File → Duplicate Tab to experiment safely, and keep a ProjectPlan.dplan backup regularly.</div>';
    open({ title: 'Help', body, buttons: [{ label: 'Close', kind: 'primary' }] });
  }

  return {
    open, close, confirm, promptText, alert,
    task, project, resources, calendar, settings, columns, colours,
    exportDialog, exportMatrix, downloadCsv, downloadXls, printProject, exportImage,
    referenceProject, projects,
    shortcuts, about, help
  };
})();
