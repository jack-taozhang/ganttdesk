'use strict';

/* CSV, TSV and basic .xlsx (zip + deflate) readers plus a tolerant Gantt-sheet importer. */
const Importer = (() => {
  function cleanName(fileName) {
    return String(fileName || 'Imported plan').replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Imported plan';
  }

  function detectDelimiter(text) {
    const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const counts = { ',': 0, '\t': 0, ';': 0 };
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (!inQuotes && (ch === ',' || ch === '\t' || ch === ';')) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || ',';
  }

  function parseTable(text) {
    text = String(text || '').replace(/^\ufeff/, '').replace(/\r\n?/g, '\n');
    const delim = detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
        continue;
      }
      if (ch === '"') { inQuotes = true; continue; }
      if (ch === delim) { row.push(field); field = ''; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += ch;
    }
    row.push(field);
    rows.push(row);
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  // ---------- xlsx ----------
  function decodeUtf8(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function zipEntries(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const u16 = (off) => view.getUint16(off, true);
    const u32 = (off) => view.getUint32(off, true);
    let eocd = -1;
    const min = Math.max(0, buffer.byteLength - 65558);
    for (let i = buffer.byteLength - 22; i >= min; i--) {
      if (u32(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This .xlsx file is not a valid zip archive.');
    const count = u16(eocd + 10);
    let off = u32(eocd + 16);
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (u32(off) !== 0x02014b50) break;
      const method = u16(off + 10);
      const compSize = u32(off + 20);
      const nameLen = u16(off + 28);
      const extraLen = u16(off + 30);
      const commentLen = u16(off + 32);
      const localOff = u32(off + 42);
      const name = decodeUtf8(bytes.subarray(off + 46, off + 46 + nameLen));
      entries.set(name, { method, compSize, localOff });
      off += 46 + nameLen + extraLen + commentLen;
    }
    async function read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (u32(e.localOff) !== 0x04034b50) throw new Error('Corrupt workbook entry: ' + name);
      const nameLen = u16(e.localOff + 26);
      const extraLen = u16(e.localOff + 28);
      const start = e.localOff + 30 + nameLen + extraLen;
      const data = bytes.slice(start, start + e.compSize);
      if (e.method === 0) return decodeUtf8(data);
      if (e.method !== 8) throw new Error('Unsupported compression in workbook.');
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot unpack .xlsx files. Export the sheet as CSV instead.');
      }
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const out = await new Response(stream).arrayBuffer();
      return decodeUtf8(new Uint8Array(out));
    }
    return { entries, read };
  }

  function columnIndex(ref) {
    const letters = String(ref || '').replace(/[^A-Z]/gi, '').toUpperCase();
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return Math.max(0, n - 1);
  }

  async function xlsxRows(buffer) {
    const zip = zipEntries(buffer);
    const parser = new DOMParser();
    let shared = [];
    const sst = await zip.read('xl/sharedStrings.xml');
    if (sst) {
      const doc = parser.parseFromString(sst, 'application/xml');
      shared = Array.from(doc.getElementsByTagName('si')).map((si) => {
        let out = '';
        Array.from(si.getElementsByTagName('t')).forEach((t) => { out += t.textContent || ''; });
        return out;
      });
    }
    const sheetNames = Array.from(zip.entries.keys())
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    if (!sheetNames.length) throw new Error('The workbook contains no worksheet.');
    const xml = await zip.read(sheetNames[0]);
    const doc = parser.parseFromString(xml, 'application/xml');
    const rows = [];
    Array.from(doc.getElementsByTagName('row')).forEach((rowEl) => {
      const r = Number(rowEl.getAttribute('r'));
      const rowIndex = r > 0 ? r - 1 : rows.length;
      const cells = [];
      Array.from(rowEl.getElementsByTagName('c')).forEach((cell) => {
        const idx = columnIndex(cell.getAttribute('r'));
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = Array.from(cell.getElementsByTagName('t')).map((t) => t.textContent || '').join('');
        } else {
          const v = cell.getElementsByTagName('v')[0];
          const raw = v ? v.textContent : '';
          if (type === 's') value = shared[Number(raw)] || '';
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else value = raw;
        }
        cells[idx] = value;
      });
      const width = cells.length;
      const arr = [];
      for (let i = 0; i < width; i++) arr.push(cells[i] == null ? '' : cells[i]);
      while (arr.length && String(arr[arr.length - 1]).trim() === '') arr.pop();
      rows[rowIndex] = arr;
    });
    return rows.filter((r) => r && r.some((c) => String(c).trim() !== ''));
  }

  async function readFile(file) {
    const ext = (String(file.name).split('.').pop() || '').toLowerCase();
    if (ext === 'xlsx' || ext === 'xlsm') {
      const buffer = await file.arrayBuffer();
      return { rows: await xlsxRows(buffer), name: cleanName(file.name) };
    }
    if (ext === 'xls') {
      throw new Error('Old binary .xls files are not supported. Save the sheet as .xlsx or CSV.');
    }
    const text = await U.readFileText(file);
    return { rows: parseTable(text), name: cleanName(file.name) };
  }

  // ---------- build a plan ----------
  const NAME_KEYS = ['task', 'taskname', 'name', 'activity', 'activityname', 'description', 'summary', 'subject', 'item'];
  const HEADER_MAP = {
    name: NAME_KEYS,
    wbs: ['wbs', 'wbsid', 'id', 'outline', 'outlinenumber', 'no', 'number', 'ref'],
    start: ['start', 'startdate', 'begin', 'begindate', 'from', 'scheduledstart'],
    end: ['end', 'enddate', 'finish', 'finishdate', 'to', 'scheduledfinish'],
    duration: ['duration', 'dur', 'days', 'durationdays', 'length'],
    progress: ['percentcomplete', 'progress', 'complete', 'completion', 'pctcomplete', 'percent'],
    notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
    predecessors: ['predecessors', 'predecessor', 'pred', 'preds', 'dependencies', 'dependency', 'depends', 'dependsons'],
    resources: ['resources', 'resource', 'assignedto', 'assignee', 'owner', 'team', 'resourceNames'],
    cost: ['cost', 'estimatedcost', 'estimate', 'budget'],
    type: ['type', 'milestone', 'tasktype'],
    level: ['outlinelevel', 'level', 'indent', 'indentation'],
    parent: ['parent', 'parenttask', 'parentname', 'parentwbs']
  };

  function normHeader(h) { return String(h || '').toLowerCase().replace(/[^a-z0-9%]/g, ''); }

  function headerIndex(headers, aliases) {
    const normAliases = aliases.map(normHeader);
    for (let i = 0; i < headers.length; i++) {
      const h = normHeader(headers[i]);
      if (!h) continue;
      if (normAliases.indexOf(h) >= 0) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      const h = normHeader(headers[i]);
      if (normAliases.some((a) => h.indexOf(a) === 0)) return i;
    }
    return -1;
  }

  function findHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const norm = (rows[i] || []).map(normHeader);
      if (norm.some((h) => NAME_KEYS.indexOf(h) >= 0)) return i;
    }
    return 0;
  }

  function excelDate(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim())) {
      const n = Number(value);
      if (n > 20000 && n < 90000) {
        const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
        return U.toISO(d);
      }
    }
    return U.parseLooseDate(value, null);
  }

  function parseProgress(value) {
    const raw = String(value == null ? '' : value).replace('%', '').trim();
    let n = Number(raw);
    if (!isFinite(n)) return 0;
    if (n > 0 && n <= 1 && raw.indexOf('%') < 0) n *= 100;
    return U.clamp(n, 0, 100);
  }

  function parseDuration(value) {
    if (value == null || String(value).trim() === '') return null;
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(h|d|w|m)?\s*$/i.exec(String(value).trim());
    if (!m) return null;
    const parsed = U.parseDuration(String(value).trim(), 'd');
    return parsed.value >= 0 ? parsed : null;
  }

  function buildProject(rows, projectName) {
    if (!rows || !rows.length) throw new Error('The sheet is empty.');
    const headerRowIndex = findHeaderRow(rows);
    const headers = rows[headerRowIndex] || [];
    const idx = {};
    Object.keys(HEADER_MAP).forEach((key) => { idx[key] = headerIndex(headers, HEADER_MAP[key]); });
    if (idx.name < 0) {
      // tolerate headerless sheets: use the first text column as the name
      idx.name = 0;
    }
    const name = projectName || 'Imported plan';
    const startISO = U.todayISO();
    const resources = [];
    const resourceMap = new Map();
    const tasks = [];
    const rawRows = [];

    for (let r = headerRowIndex + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const rawName = row[idx.name] == null ? '' : String(row[idx.name]);
      if (!rawName.trim()) continue;
      if (normHeader(rawName) === 'task' || normHeader(rawName) === 'name') continue;
      const leading = (rawName.match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
      const nameText = rawName.trim();
      const wbs = idx.wbs >= 0 ? String(row[idx.wbs] || '').trim() : '';
      const start = idx.start >= 0 ? excelDate(row[idx.start]) : null;
      const end = idx.end >= 0 ? excelDate(row[idx.end]) : null;
      const dur = idx.duration >= 0 ? parseDuration(row[idx.duration]) : null;
      const progress = idx.progress >= 0 ? parseProgress(row[idx.progress]) : 0;
      const notes = idx.notes >= 0 ? String(row[idx.notes] || '').trim() : '';
      const typeText = idx.type >= 0 ? String(row[idx.type] || '').toLowerCase() : '';
      const costRaw = idx.cost >= 0 ? String(row[idx.cost] || '').replace(/[^0-9.\-]/g, '') : '';
      const levelRaw = idx.level >= 0 ? String(row[idx.level] || '').trim() : '';
      const resText = idx.resources >= 0 ? String(row[idx.resources] || '').trim() : '';
      const milestone = /milestone|flag/.test(typeText) || (dur && dur.value === 0);

      let durationDays = 0;
      if (dur) durationDays = U.durationToDays(dur.value, dur.unit, 8, 5);
      if (!durationDays && start && end) durationDays = Math.max(1, U.diffDays(start, end) + 1);
      if (milestone) durationDays = 0;
      let taskStart = start;
      if (!taskStart && end && durationDays > 0) taskStart = U.addDays(end, -(Math.ceil(durationDays) - 1));
      if (!taskStart) taskStart = startISO;

      const task = {
        id: U.uid(),
        name: nameText,
        notes,
        start: taskStart,
        duration: milestone ? 0 : (durationDays || 1),
        durationUnit: 'd',
        percentComplete: progress,
        type: milestone ? 'milestone' : 'task',
        estimatedCost: costRaw === '' ? null : (Number(costRaw) || null),
        resources: [],
        order: tasks.length
      };
      if (progress > 0) task.actualStart = taskStart;
      if (progress >= 100) task.actualEnd = end || taskStart;
      tasks.push(task);

      const levels = wbs ? (wbs.split('.').length - 1) : (levelRaw ? (Number(levelRaw) || 1) - 1 : Math.floor(leading / 3));
      rawRows.push({
        task, rowNumber: r - headerRowIndex, wbs,
        predecesors: idx.predecessors >= 0 ? String(row[idx.predecessors] || '').trim() : '',
        resources: resText, levelHint: Math.max(0, levels),
        parentRef: idx.parent >= 0 ? String(row[idx.parent] || '').trim() : ''
      });

      if (resText) {
        resText.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).forEach((resName) => {
          if (!resourceMap.has(resName.toLowerCase())) {
            const resource = { id: U.uid(), name: resName, role: '', rate: 0, rateUnit: 'd', colour: '#4d86c9' };
            resourceMap.set(resName.toLowerCase(), resource);
            resources.push(resource);
          }
          task.resources.push({ resourceId: resourceMap.get(resName.toLowerCase()).id, units: 100 });
        });
      }
    }

    if (!tasks.length) throw new Error('No task rows were found in the sheet.');

    // hierarchy: WBS prefix, explicit parent, or indentation stack
    const byWbs = new Map();
    rawRows.forEach((r) => { if (r.wbs) byWbs.set(r.wbs, r.task); });
    const byName = new Map();
    rawRows.forEach((r) => { if (!byName.has(r.task.name.toLowerCase())) byName.set(r.task.name.toLowerCase(), r.task); });
    const stack = [];
    rawRows.forEach((r) => {
      let parent = null;
      if (r.parentRef) {
        parent = byWbs.get(r.parentRef) || byName.get(r.parentRef.toLowerCase()) || null;
      }
      if (!parent && r.wbs && r.wbs.indexOf('.') > 0) {
        const prefix = r.wbs.slice(0, r.wbs.lastIndexOf('.'));
        parent = byWbs.get(prefix) || null;
      }
      if (!parent && !r.wbs) {
        while (stack.length && stack[stack.length - 1].level >= r.levelHint) stack.pop();
        parent = stack.length ? stack[stack.length - 1].task : null;
      }
      if (parent === r.task) parent = null;
      if (parent) r.task.parentId = parent.id;
      const level = parent ? (r.levelHint || (parent.parentId ? 2 : 1)) : 0;
      stack.push({ level, task: r.task });
    });

    // dependencies
    const byNumber = new Map();
    rawRows.forEach((r, i) => { byNumber.set(String(i + 1), r.task); byNumber.set(String(r.rowNumber), r.task); });
    const links = [];
    rawRows.forEach((r) => {
      if (!r.predecesors) return;
      r.predecesors.split(/[,;]+/).map((s) => s.trim()).filter(Boolean).forEach((token) => {
        const m = /^([A-Za-z0-9._\-]+?)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(?:\.\d+)?)?\s*(?:d|days?|w|weeks?)?$/i.exec(token);
        let fromTask = null, type = 'FS', lag = 0;
        if (m) {
          const ref = m[1].trim();
          fromTask = byWbs.get(ref) || byName.get(ref.toLowerCase()) || byNumber.get(ref) || null;
          type = (m[2] || 'FS').toUpperCase();
          lag = m[3] ? Number(String(m[3]).replace(/\s+/g, '')) : 0;
          if (/w/i.test(token.slice(-1)) && lag) lag *= 5;
        } else {
          fromTask = byWbs.get(token) || byName.get(token.toLowerCase()) || null;
        }
        if (!fromTask || fromTask.id === r.task.id) return;
        if (links.some((l) => l.from === fromTask.id && l.to === r.task.id)) return;
        links.push({ id: U.uid(), from: fromTask.id, to: r.task.id, type, lag: lag || 0, lagUnit: 'd' });
      });
    });

    const raw = {
      name,
      startDate: startISO,
      currency: '¥',
      hoursPerDay: 8,
      hoursPerWeek: 40,
      estimatedBudget: null,
      tasks,
      links,
      resources,
      view: {
        zoom: 'day',
        showBaselineBars: false,
        showActualBars: true,
        showLinks: true,
        showCriticalPath: false,
        dashboardPanels: ['complete', 'cost', 'status']
      }
    };
    const project = Model.normalizeProject(raw, name);
    // drop any link that introduces a loop
    const kept = [];
    project.links.forEach((l) => {
      const test = { tasks: project.tasks, links: kept };
      const cycle = (from, to) => {
        const seen = new Set();
        const walk = (id) => {
          if (id === from) return true;
          if (seen.has(id)) return false;
          seen.add(id);
          return test.links.filter((x) => x.from === id).some((x) => walk(x.to));
        };
        return walk(to);
      };
      if (!cycle(l.from, l.to)) kept.push(l);
    });
    project.links = kept;
    Model.reschedule(project);
    return project;
  }

  return { readFile, parseTable, buildProject, xlsxRows, cleanName };
})();
