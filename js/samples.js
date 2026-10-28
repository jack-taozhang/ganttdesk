'use strict';

/* Original demo plans written for GanttDesk (not copied from any commercial sample plan). */
const Samples = (() => {
  function build(raw) {
    // Keep the demo plans in a sensible window around today's date.
    const anchor = raw.anchor || raw.startDate;
    const shift = U.diffDays(raw.startDate, anchor);
    if (shift) {
      raw.startDate = anchor;
      raw.tasks.forEach((t) => {
        ['start', 'end', 'actualStart', 'actualEnd', 'baselineStart', 'baselineEnd'].forEach((key) => {
          if (t[key]) t[key] = U.addDays(t[key], shift);
        });
      });
    }
    const p = Model.normalizeProject(raw, raw.name);
    p.appearance = Object.assign({ themeId: 'bright-sky', barStyle: 'raised', headerStyle: 'banner' }, p.appearance || {});
    p.view = Object.assign(Model.defaultView(), p.view || {});
    p.view.zoom = raw.zoom || 'day';
    Model.captureBaseline(p);
    return p;
  }

  function riverside() {
    const res = [
      { id: 'r-pm', name: 'Avery Cole', role: 'Project manager', rate: 720, rateUnit: 'd', colour: '#4d86c9' },
      { id: 'r-site', name: 'Morgan Lee', role: 'Site foreman', rate: 480, rateUnit: 'd', colour: '#2f8f6a' },
      { id: 'r-elec', name: 'Volt Electrical', role: 'Electrical crew', rate: 1650, rateUnit: 'd', colour: '#c77c2a' },
      { id: 'r-hvac', name: 'North Air', role: 'HVAC crew', rate: 1480, rateUnit: 'd', colour: '#6b72b9' },
      { id: 'r-finish', name: 'Craft Interiors', role: 'Finishing crew', rate: 1240, rateUnit: 'd', colour: '#b05c8e' }
    ];
    const tasks = [
      { id: 'p1', name: 'Preparation & approvals', start: '2026-09-14', duration: 0 },
      { id: 't11', parentId: 'p1', name: 'Client design sign-off', type: 'milestone', start: '2026-09-14', duration: 0, percentComplete: 100, actualStart: '2026-09-14', actualEnd: '2026-09-14', estimatedCost: 500, actualCost: 500, resources: [{ resourceId: 'r-pm', units: 100 }], notes: 'Signed scheme design and finishes schedule.' },
      { id: 't12', parentId: 'p1', name: 'Building permit', start: '2026-09-14', duration: 5, percentComplete: 100, actualStart: '2026-09-15', actualEnd: '2026-09-21', estimatedCost: 2500, actualCost: 2500, resources: [{ resourceId: 'r-pm', units: 50 }], priority: 'high' },
      { id: 't13', parentId: 'p1', name: 'Procurement of long-lead items', start: '2026-09-14', duration: 10, percentComplete: 60, actualStart: '2026-09-14', estimatedCost: 8000, actualCost: 4800, resources: [{ resourceId: 'r-pm', units: 100 }], notes: 'Joinery, glazing and light fittings.' },

      { id: 'p2', name: 'Strip-out & demolition', start: '2026-09-14', duration: 0 },
      { id: 't21', parentId: 'p2', name: 'Site protection', start: '2026-09-14', duration: 1, percentComplete: 100, actualStart: '2026-09-22', actualEnd: '2026-09-22', estimatedCost: 400, actualCost: 420, resources: [{ resourceId: 'r-site', units: 100 }] },
      { id: 't22', parentId: 'p2', name: 'Strip-out partitions', start: '2026-09-14', duration: 4, percentComplete: 100, actualStart: '2026-09-23', actualEnd: '2026-09-28', estimatedCost: 3000, actualCost: 3180, resources: [{ resourceId: 'r-site', units: 100 }] },
      { id: 't23', parentId: 'p2', name: 'Remove raised floor', start: '2026-09-14', duration: 3, percentComplete: 100, actualStart: '2026-09-29', actualEnd: '2026-10-01', estimatedCost: 2200, actualCost: 2260, resources: [{ resourceId: 'r-site', units: 100 }] },
      { id: 't24', parentId: 'p2', name: 'Waste removal', start: '2026-09-14', duration: 2, percentComplete: 100, actualStart: '2026-10-02', actualEnd: '2026-10-05', estimatedCost: 900, actualCost: 940, resources: [{ resourceId: 'r-site', units: 50 }], priority: 'low' },

      { id: 'p3', name: 'Structure & services', start: '2026-09-14', duration: 0 },
      { id: 't31', parentId: 'p3', name: 'Structural repairs', start: '2026-09-14', duration: 6, percentComplete: 60, actualStart: '2026-10-02', estimatedCost: 7000, actualCost: 4200, resources: [{ resourceId: 'r-site', units: 100 }], priority: 'high', notes: 'Load-bearing repairs coordinated with the structural engineer.' },
      { id: 't32', parentId: 'p3', name: 'Electrical first fix', start: '2026-09-14', duration: 8, percentComplete: 40, actualStart: '2026-10-02', estimatedCost: 5500, actualCost: 2100, resources: [{ resourceId: 'r-elec', units: 100 }] },
      { id: 't33', parentId: 'p3', name: 'HVAC ductwork', start: '2026-09-14', duration: 7, percentComplete: 30, actualStart: '2026-10-02', estimatedCost: 6000, actualCost: 1800, resources: [{ resourceId: 'r-hvac', units: 100 }] },
      { id: 't34', parentId: 'p3', name: 'Plumbing first fix', start: '2026-09-14', duration: 5, percentComplete: 45, actualStart: '2026-10-02', estimatedCost: 3800, actualCost: 1700, resources: [{ resourceId: 'r-site', units: 50 }] },
      { id: 't35', parentId: 'p3', name: 'Services inspection', type: 'milestone', start: '2026-09-14', duration: 0, percentComplete: 0, estimatedCost: 500, resources: [{ resourceId: 'r-pm', units: 50 }] },

      { id: 'p4', name: 'Finishes', start: '2026-09-14', duration: 0 },
      { id: 't41', parentId: 'p4', name: 'Plasterboard & skim', start: '2026-09-14', duration: 8, percentComplete: 0, estimatedCost: 4500, resources: [{ resourceId: 'r-finish', units: 100 }] },
      { id: 't42', parentId: 'p4', name: 'Floor screed', start: '2026-09-14', duration: 3, percentComplete: 0, estimatedCost: 1800, resources: [{ resourceId: 'r-finish', units: 50 }] },
      { id: 't43', parentId: 'p4', name: 'Painting', start: '2026-09-14', duration: 5, percentComplete: 0, estimatedCost: 2500, resources: [{ resourceId: 'r-finish', units: 100 }] },
      { id: 't44', parentId: 'p4', name: 'Ceiling tiles', start: '2026-09-14', duration: 3, percentComplete: 0, estimatedCost: 1600, resources: [{ resourceId: 'r-finish', units: 50 }], priority: 'low' },
      { id: 't45', parentId: 'p4', name: 'Floor finishes', start: '2026-09-14', duration: 4, percentComplete: 0, estimatedCost: 3000, resources: [{ resourceId: 'r-finish', units: 100 }] },
      { id: 't46', parentId: 'p4', name: 'Joinery & glazing', start: '2026-09-14', duration: 5, percentComplete: 0, estimatedCost: 6500, resources: [{ resourceId: 'r-finish', units: 100 }], priority: 'high' },

      { id: 'p5', name: 'Handover', start: '2026-09-14', duration: 0 },
      { id: 't51', parentId: 'p5', name: 'Snagging', start: '2026-09-14', duration: 3, percentComplete: 0, estimatedCost: 900, resources: [{ resourceId: 'r-pm', units: 100 }] },
      { id: 't52', parentId: 'p5', name: 'Final clean', start: '2026-09-14', duration: 2, percentComplete: 0, estimatedCost: 600, resources: [{ resourceId: 'r-site', units: 50 }], priority: 'low' },
      { id: 't53', parentId: 'p5', name: 'Client handover', type: 'milestone', start: '2026-09-14', duration: 0, percentComplete: 0, estimatedCost: 500, resources: [{ resourceId: 'r-pm', units: 50 }], priority: 'high' }
    ];
    const links = [
      { from: 't11', to: 't12', type: 'FS' },
      { from: 't11', to: 't13', type: 'SS' },
      { from: 't12', to: 't21', type: 'FS' },
      { from: 't21', to: 't22', type: 'FS' },
      { from: 't22', to: 't23', type: 'FS' },
      { from: 't23', to: 't24', type: 'FS' },
      { from: 't24', to: 't31', type: 'FS' },
      { from: 't31', to: 't32', type: 'SS' },
      { from: 't31', to: 't33', type: 'SS' },
      { from: 't31', to: 't34', type: 'SS' },
      { from: 't32', to: 't35', type: 'FF' },
      { from: 't33', to: 't35', type: 'FF' },
      { from: 't34', to: 't35', type: 'FF' },
      { from: 't35', to: 't41', type: 'FS' },
      { from: 't41', to: 't42', type: 'FS' },
      { from: 't42', to: 't43', type: 'FS' },
      { from: 't41', to: 't44', type: 'SS' },
      { from: 't43', to: 't45', type: 'FS' },
      { from: 't42', to: 't46', type: 'FS' },
      { from: 't45', to: 't51', type: 'FS' },
      { from: 't51', to: 't52', type: 'FS' },
      { from: 't52', to: 't53', type: 'FS' }
    ];
    return build({
      name: 'Riverside Office Fit-out', tabName: 'P-1001', startDate: '2026-09-14', anchor: U.addDays(U.todayISO(), -14), currency: '¥', estimatedBudget: 62000,
      notes: 'Two-floor office refurbishment at Riverside Business Park. Sample plan — edit or save a copy.',
      lead: 'Avery Cole', resources: res, tasks, links, zoom: 'day',
      appearance: { themeId: 'bright-sky', barStyle: 'raised', headerStyle: 'banner' },
      view: { showBaselineBars: true, showActualBars: true, showLinks: true, showCriticalPath: false, progressMode: 'manual' }
    });
  }

  function northwind() {
    const res = [
      { id: 'n-pm', name: 'Priya Shah', role: 'Programme lead', rate: 880, rateUnit: 'd', colour: '#4d86c9' },
      { id: 'n-ba', name: 'Sam Okafor', role: 'Business analyst', rate: 620, rateUnit: 'd', colour: '#2f8f6a' },
      { id: 'n-dev', name: 'Ines Park', role: 'Integration developer', rate: 760, rateUnit: 'd', colour: '#6b72b9' },
      { id: 'n-qa', name: 'Leo Grant', role: 'QA lead', rate: 580, rateUnit: 'd', colour: '#b05c8e' },
      { id: 'n-ops', name: 'Dana Ruiz', role: 'Operations trainer', rate: 540, rateUnit: 'd', colour: '#c77c2a' }
    ];
    const tasks = [
      { id: 'n1', name: 'Discovery', start: '2026-10-05', duration: 0 },
      { id: 'n11', parentId: 'n1', name: 'Stakeholder interviews', start: '2026-10-05', duration: 5, percentComplete: 100, actualStart: '2026-10-05', actualEnd: '2026-10-09', estimatedCost: 4200, actualCost: 4200, resources: [{ resourceId: 'n-ba', units: 100 }] },
      { id: 'n12', parentId: 'n1', name: 'Current-state process map', start: '2026-10-05', duration: 4, percentComplete: 100, actualStart: '2026-10-08', actualEnd: '2026-10-13', estimatedCost: 3000, actualCost: 3100, resources: [{ resourceId: 'n-ba', units: 100 }] },
      { id: 'n13', parentId: 'n1', name: 'Discovery sign-off', type: 'milestone', start: '2026-10-05', duration: 0, percentComplete: 100, actualStart: '2026-10-14', actualEnd: '2026-10-14', estimatedCost: 700, actualCost: 700, resources: [{ resourceId: 'n-pm', units: 50 }], priority: 'high' },

      { id: 'n2', name: 'Solution design', start: '2026-10-05', duration: 0 },
      { id: 'n21', parentId: 'n2', name: 'Target architecture', start: '2026-10-05', duration: 6, percentComplete: 100, actualStart: '2026-10-15', actualEnd: '2026-10-22', estimatedCost: 8100, actualCost: 7900, resources: [{ resourceId: 'n-dev', units: 100 }], priority: 'high' },
      { id: 'n22', parentId: 'n2', name: 'Data migration plan', start: '2026-10-05', duration: 4, percentComplete: 80, actualStart: '2026-10-19', estimatedCost: 3400, actualCost: 2700, resources: [{ resourceId: 'n-dev', units: 50 }, { resourceId: 'n-ba', units: 50 }], priority: 'low' },
      { id: 'n23', parentId: 'n2', name: 'Design review', type: 'milestone', start: '2026-10-05', duration: 0, percentComplete: 0, estimatedCost: 900, resources: [{ resourceId: 'n-pm', units: 50 }] },

      { id: 'n3', name: 'Build & configure', start: '2026-10-05', duration: 0 },
      { id: 'n31', parentId: 'n3', name: 'Core accounting configuration', start: '2026-10-05', duration: 12, percentComplete: 25, actualStart: '2026-10-23', estimatedCost: 18000, actualCost: 5200, resources: [{ resourceId: 'n-dev', units: 100 }, { resourceId: 'n-ba', units: 50 }], priority: 'high', notes: 'Chart of accounts, tax codes and approval workflows.' },
      { id: 'n32', parentId: 'n3', name: 'Payroll integration', start: '2026-10-05', duration: 9, percentComplete: 10, actualStart: '2026-10-26', estimatedCost: 13500, actualCost: 1500, resources: [{ resourceId: 'n-dev', units: 100 }] },
      { id: 'n33', parentId: 'n3', name: 'Reporting pack', start: '2026-10-05', duration: 7, percentComplete: 0, estimatedCost: 6800, resources: [{ resourceId: 'n-dev', units: 50 }, { resourceId: 'n-ba', units: 50 }], priority: 'low' },
      { id: 'n34', parentId: 'n3', name: 'Build complete', type: 'milestone', start: '2026-10-05', duration: 0, percentComplete: 0, estimatedCost: 800, resources: [{ resourceId: 'n-pm', units: 50 }] },

      { id: 'n4', name: 'Test & migrate', start: '2026-10-05', duration: 0 },
      { id: 'n41', parentId: 'n4', name: 'System integration testing', start: '2026-10-05', duration: 8, percentComplete: 0, estimatedCost: 9200, resources: [{ resourceId: 'n-qa', units: 100 }, { resourceId: 'n-dev', units: 50 }] },
      { id: 'n42', parentId: 'n4', name: 'User acceptance testing', start: '2026-10-05', duration: 6, percentComplete: 0, estimatedCost: 6200, resources: [{ resourceId: 'n-qa', units: 50 }, { resourceId: 'n-ba', units: 50 }] },
      { id: 'n43', parentId: 'n4', name: 'Data migration rehearsal', start: '2026-10-05', duration: 4, percentComplete: 0, estimatedCost: 4800, resources: [{ resourceId: 'n-dev', units: 100 }] },
      { id: 'n44', parentId: 'n4', name: 'Go/no-go decision', type: 'milestone', start: '2026-10-05', duration: 0, percentComplete: 0, estimatedCost: 700, resources: [{ resourceId: 'n-pm', units: 50 }] },

      { id: 'n5', name: 'Deploy & adopt', start: '2026-10-05', duration: 0 },
      { id: 'n51', parentId: 'n5', name: 'Cutover weekend', start: '2026-10-05', duration: 2, percentComplete: 0, estimatedCost: 5600, resources: [{ resourceId: 'n-dev', units: 100 }, { resourceId: 'n-qa', units: 100 }], priority: 'high', notes: 'Freeze window agreed with Finance; rollback plan rehearsed.' },
      { id: 'n52', parentId: 'n5', name: 'Training rollout', start: '2026-10-05', duration: 6, percentComplete: 0, estimatedCost: 7200, resources: [{ resourceId: 'n-ops', units: 100 }], priority: 'low' },
      { id: 'n53', parentId: 'n5', name: 'Hypercare', start: '2026-10-05', duration: 10, percentComplete: 0, estimatedCost: 8800, resources: [{ resourceId: 'n-dev', units: 50 }, { resourceId: 'n-pm', units: 50 }] },
      { id: 'n54', parentId: 'n5', name: 'Service handover', type: 'milestone', start: '2026-10-05', duration: 0, percentComplete: 0, estimatedCost: 600, resources: [{ resourceId: 'n-pm', units: 50 }], priority: 'high' }
    ];
    const links = [
      { from: 'n11', to: 'n12', type: 'SS' },
      { from: 'n11', to: 'n13', type: 'FF' },
      { from: 'n12', to: 'n13', type: 'FF' },
      { from: 'n13', to: 'n21', type: 'FS' },
      { from: 'n13', to: 'n22', type: 'SS' },
      { from: 'n22', to: 'n23', type: 'FF' },
      { from: 'n23', to: 'n31', type: 'FS' },
      { from: 'n23', to: 'n33', type: 'SS' },
      { from: 'n31', to: 'n32', type: 'SS' },
      { from: 'n31', to: 'n34', type: 'FF' },
      { from: 'n32', to: 'n34', type: 'FF' },
      { from: 'n34', to: 'n41', type: 'FS' },
      { from: 'n34', to: 'n43', type: 'SS' },
      { from: 'n41', to: 'n42', type: 'FS' },
      { from: 'n42', to: 'n44', type: 'FF' },
      { from: 'n43', to: 'n44', type: 'FF' },
      { from: 'n44', to: 'n51', type: 'FS' },
      { from: 'n44', to: 'n52', type: 'SS' },
      { from: 'n51', to: 'n53', type: 'SS' },
      { from: 'n52', to: 'n54', type: 'FS' },
      { from: 'n53', to: 'n54', type: 'FF' }
    ];
    return build({
      name: 'Northwind ERP Rollout', tabName: 'P-2001', startDate: '2026-10-05', anchor: U.addDays(U.todayISO(), -7), currency: '¥', estimatedBudget: 102000,
      notes: 'Finance and payroll ERP rollout across three business units. Sample plan — edit or save a copy.',
      lead: 'Priya Shah', resources: res, tasks, links, zoom: 'week',
      appearance: { themeId: 'forest', barStyle: 'raised', headerStyle: 'banner' },
      view: { showBaselineBars: false, showActualBars: true, showLinks: true, showCriticalPath: true, progressMode: 'manual' }
    });
  }

  return { riverside, northwind };
})();
