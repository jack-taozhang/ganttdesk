'use strict';

/* Dashboard summary cards: completion, cost and status rings plus optional detail panels. */
const Dashboard = (() => {
  let bound = false;

  function ring(percent, colour) {
    const pct = U.clamp(Number(percent) || 0, 0, 100);
    const r = 26;
    const c = 2 * Math.PI * r;
    const off = c * (1 - pct / 100);
    return '<div class="donut">' +
      '<svg viewBox="0 0 66 66">' +
      '<circle class="ring-bg" cx="33" cy="33" r="' + r + '" fill="none" stroke-width="7"/>' +
      '<circle class="ring" cx="33" cy="33" r="' + r + '" fill="none" stroke-width="7" ' +
      'stroke="' + colour + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" ' +
      'stroke-dashoffset="' + off.toFixed(1) + '"/>' +
      '</svg>' +
      '<div class="center"><b>' + U.escapeHtml(Math.round(pct) + '%') + '</b><span>' + '</span></div>' +
      '</div>';
  }
  function ringWithCaption(percent, colour, caption) {
    const html = ring(percent, colour);
    return html.replace('<span></span>', '<span>' + U.escapeHtml(caption) + '</span>');
  }

  function money(value, project) { return U.formatMoney(value, project); }

  function completeCard(project, s) {
    const fmt = project.view.dateFormat;
    const lead = s.pointsBehind > 0
      ? s.pointsBehind + (s.pointsBehind === 1 ? ' point' : ' points') + ' behind plan'
      : 'On or ahead of plan';
    return '<div class="dash-card top complete">' +
      '<div class="dash-title">COMPLETE</div>' +
      '<div class="dash-main">' + ringWithCaption(s.percent, '#4d86c9', 'complete') +
      '<div class="dash-detail">' +
      '<div class="big">' + s.done + ' of ' + s.taskCount + ' tasks</div>' +
      '<div class="sub">' + U.escapeHtml(lead) + '</div>' +
      '</div></div>' +
      '<div class="dash-foot">Planned ' + s.planned + '% · finishes ' + U.fmtDate(s.last, fmt) + '</div>' +
      '</div>';
  }

  function costCard(project, s) {
    const over = s.budget > 0 && s.actual > s.budget;
    const colour = over ? 'var(--critical)' : '#2e9e70';
    const budgetText = s.budget > 0 ? money(s.budget, project) : 'no budget set';
    return '<div class="dash-card top cost">' +
      '<div class="dash-title">COST</div>' +
      '<div class="dash-main">' + ringWithCaption(s.costPercent, colour, 'of budget') +
      '<div class="dash-detail">' +
      '<div class="big">' + money(s.actual, project) + ' of ' + U.escapeHtml(budgetText) + '</div>' +
      '<div class="sub">' + (s.budget > 0
        ? (over ? 'Over by ' + money(s.actual - s.budget, project) : 'Remaining ' + money(s.remaining, project))
        : 'Set a budget in Project settings') + '</div>' +
      '</div></div>' +
      '<div class="dash-foot">Estimated ' + money(s.estimated, project) + ' · baseline ' + money(s.baseline, project) + '</div>' +
      '</div>';
  }

  function statusCard(project, s) {
    const donePct = s.taskCount ? U.round(s.done / s.taskCount * 100) : 0;
    return '<div class="dash-card top status">' +
      '<div class="dash-title">STATUS</div>' +
      '<div class="dash-main">' + ringWithCaption(donePct, '#d68a23', 'done') +
      '<div class="dash-detail">' +
      '<div class="big">' + s.taskCount + ' tasks</div>' +
      '<div class="sub">' + s.done + ' done · ' + s.underway + ' under way<br>' +
      s.plannedCount + ' planned · ' + s.late + ' late</div>' +
      '</div></div>' +
      '<div class="dash-foot">' + (s.milestones.length
        ? 'Next: ' + U.escapeHtml(s.milestones[0].name || 'Milestone') + ' · ' + U.fmtDate(s.milestones[0].start, project.view.dateFormat)
        : 'No upcoming milestones') + '</div>' +
      '</div>';
  }

  // Who is carrying the work in this project: assignments, completion and
  // the number of tasks still under way.
  function peopleCard(project, people) {
    const list = people || Model.peopleStats(project);
    const shown = list.slice(0, 4);
    const rows = shown.map((p) => {
      // The bar shows the same ratio as the "done / assigned" number beside it.
      const pct = p.tasks ? U.clamp(U.round(p.done / p.tasks * 100), 0, 100) : 0;
      const colour = pct >= 100 ? 'var(--ok)' : (p.late ? 'var(--warn)' : 'var(--bar)');
      return '<div class="mini-bar-row">' +
        '<span class="mini-bar-name" title="' + U.escapeHtml(p.name + (p.role ? ' · ' + p.role : '')) + '">' +
        U.escapeHtml(p.name) + '</span>' +
        '<span class="mini-bar-track"><span class="mini-bar-fill" style="width:' + pct + '%;background:' + colour + '"></span></span>' +
        '<span class="mini-bar-val">' + p.done + '/' + p.tasks + '</span>' +
        '</div>';
    }).join('');
    const more = list.length > shown.length ? ' +' + (list.length - shown.length) + ' more' : '';
    return '<div class="dash-card top people">' +
      '<div class="dash-title">PEOPLE</div>' +
      '<div class="dash-people">' + (rows || '<div class="empty-hint">No one assigned yet</div>') + '</div>' +
      '<div class="dash-foot">' + (list.length
        ? list.length + (list.length === 1 ? ' person' : ' people') + ' · ' +
          list.reduce((a, p) => a + p.tasks, 0) + ' assigned tasks' + more
        : 'Assign resources in the task editor') + '</div>' +
      '</div>';
  }

  function render() {
    const body = document.getElementById('dashBody');
    const section = document.getElementById('dashboard');
    const toggle = document.getElementById('dashToggle');
    if (!body || !section || !toggle) return;
    const tab = Store.active();
    if (!tab) { body.innerHTML = ''; return; }
    const project = tab.project;
    // The dashboard is the whole plan in front of the user, so referenced
    // plans contribute to every card and to the people list.
    const s = Model.statsWithReferences(project, Store.allProjects());
    const panels = project.view.dashboardPanels || ['complete', 'cost', 'status'];
    const blocks = [];
    if (panels.includes('complete')) blocks.push(completeCard(project, s));
    if (panels.includes('cost') && Model.costVisible(project)) blocks.push(costCard(project, s));
    if (panels.includes('status')) blocks.push(statusCard(project, s));
    blocks.push(peopleCard(project, s.people));
    if (!blocks.length) blocks.push(completeCard(project, s));
    body.innerHTML = blocks.join('');

    // One fixed row of summary cards. With no detail panels left, the toggle
    // only collapses the row to give the planner more height.
    const collapsed = Store.settings().dashboardExpanded === false;
    section.classList.toggle('collapsed', collapsed);
    toggle.classList.toggle('collapsed', collapsed);
    const hint = s.percent + '% complete · ' + (s.pointsBehind > 0 ? s.pointsBehind + ' points behind' : 'on plan') +
      ' · ' + s.taskCount + ' tasks';
    toggle.innerHTML =
      '<svg class="chev"><use href="#i-chevron"/></svg>' +
      '<span>DASHBOARD</span>' +
      '<span class="dash-hint" id="dashHint">' + U.escapeHtml(hint) + '</span>';
  }

  function toggleCollapsed() {
    const settings = Store.settings();
    Store.updateSettings({ dashboardExpanded: settings.dashboardExpanded === false }, { projectView: false });
    render();
  }
  function init() {
    if (bound) return;
    bound = true;
    const toggle = document.getElementById('dashToggle');
    if (toggle) toggle.addEventListener('click', toggleCollapsed);
  }

  return { init, render, toggleCollapsed };
})();
