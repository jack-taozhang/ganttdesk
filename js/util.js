'use strict';

const U = (() => {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MS_DAY = 86400000;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const uid = () => {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const round = (n, d = 0) => {
    const p = Math.pow(10, d);
    return Math.round((Number(n) || 0) * p) / p;
  };
  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const icon = (name, cls = '') => '<svg class="' + cls + '"><use href="#i-' + name + '"/></svg>';

  function parseDate(iso) {
    if (!iso) return null;
    if (iso instanceof Date) return new Date(Date.UTC(iso.getFullYear(), iso.getMonth(), iso.getDate()));
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso));
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  function toISO(dt) {
    if (!dt) return null;
    return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDays(iso, n) {
    const d = parseDate(iso);
    if (!d) return iso;
    d.setUTCDate(d.getUTCDate() + Number(n || 0));
    return toISO(d);
  }
  function diffDays(a, b) {
    const da = parseDate(a), db = parseDate(b);
    if (!da || !db) return 0;
    return Math.round((db - da) / MS_DAY);
  }
  function weekday(iso) {
    const d = parseDate(iso);
    return d ? d.getUTCDay() : 0;
  }
  function startOfWeek(iso) {
    const wd = weekday(iso);
    return addDays(iso, -wd);
  }
  function startOfMonth(iso) {
    const d = parseDate(iso);
    return d ? d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-01' : iso;
  }
  function endOfMonth(iso) {
    const d = parseDate(iso);
    if (!d) return iso;
    return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  function addMonths(iso, n) {
    const d = parseDate(iso);
    if (!d) return iso;
    const day = d.getUTCDate();
    const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Number(n || 0), 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, last));
    return toISO(target);
  }
  function monthKey(iso) {
    const d = parseDate(iso);
    return d ? d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') : '';
  }
  function quarterOf(iso) { return Math.floor(parseDate(iso).getUTCMonth() / 3) + 1; }
  function yearOf(iso) { return parseDate(iso) ? parseDate(iso).getUTCFullYear() : 0; }
  function monthName(iso, short) {
    const d = parseDate(iso);
    return d ? (short ? MONTHS_SHORT : MONTHS)[d.getUTCMonth()] : '';
  }
  function dayName(iso, short) {
    const d = parseDate(iso);
    return d ? (short ? DAYS_SHORT : DAYS)[d.getUTCDay()] : '';
  }
  function fmtDate(iso, format) {
    const d = parseDate(iso);
    if (!d) return '—';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const d1 = String(d.getUTCDate());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const m1 = String(d.getUTCMonth() + 1);
    const yy = String(d.getUTCFullYear()).slice(-2);
    const yyyy = String(d.getUTCFullYear());
    const mmm = MONTHS_SHORT[d.getUTCMonth()];
    const mmmm = MONTHS[d.getUTCMonth()];
    const ddd = DAYS_SHORT[d.getUTCDay()];
    switch (format) {
      case 'dd/mm/yyyy': return dd + '/' + mm + '/' + yyyy;
      case 'dd/mm/yy': return dd + '/' + mm + '/' + yy;
      case 'yyyy-mm-dd': return yyyy + '-' + mm + '-' + dd;
      case 'mm/dd/yyyy': return mm + '/' + dd + '/' + yyyy;
      case 'mmm d, yyyy': return mmm + ' ' + d1 + ', ' + yyyy;
      case 'd mmm yyyy': return d1 + ' ' + mmm + ' ' + yyyy;
      case 'ddd d mmm': return ddd + ' ' + d1 + ' ' + mmm;
      case 'dd-mmm-yyyy': return dd + '-' + mmm + '-' + yyyy;
      case 'dd-mmm-yy':
      default: return dd + '-' + mmm + '-' + yy;
    }
  }
  function parseLooseDate(text, fallback) {
    if (!text) return fallback || null;
    const t = String(text).trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return toISO(parseDate(t));
    let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(t);
    if (m) {
      let y = +m[3]; if (y < 100) y += 2000;
      return toISO(new Date(Date.UTC(y, +m[2] - 1, +m[1])));
    }
    m = /^(\d{1,2})[\s\-]([A-Za-z]{3,})[\s\-](\d{4})$/.exec(t);
    if (m) {
      const mi = MONTHS_SHORT.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) return toISO(new Date(Date.UTC(+m[3], mi, +m[1])));
    }
    const d = new Date(t);
    if (!isNaN(d.getTime())) return toISO(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
    return fallback || null;
  }
  function daysBetweenInclusive(a, b) { return Math.max(0, diffDays(a, b) + 1); }

  function normCalendar(cal) {
    if (!cal) return null;
    if (!Array.isArray(cal.workingWeekdays)) cal.workingWeekdays = [false, true, true, true, true, true, false];
    if (!Array.isArray(cal.workingTimes)) cal.workingTimes = [[], [], [], [], [], [], []];
    if (!Array.isArray(cal.holidays)) cal.holidays = [];
    if (!Array.isArray(cal.worksThrough)) cal.worksThrough = [];
    return cal;
  }
  function holidaySet(cal) {
    const set = new Set();
    if (!cal) return set;
    (cal.holidays || []).forEach((h) => set.add(typeof h === 'string' ? h : h.date));
    return set;
  }
  function isWorkingDay(iso, cal, hs) {
    if (!iso) return false;
    if (cal) {
      if ((cal.worksThrough || []).some((x) => (typeof x === 'string' ? x : x.date) === iso)) return true;
      const set = hs || holidaySet(cal);
      if (set.has(iso)) return false;
      const wd = weekday(iso);
      if (!cal.workingWeekdays || !cal.workingWeekdays[wd]) return false;
      const times = cal.workingTimes && cal.workingTimes[wd];
      if (times && times.length === 0) return false;
      return true;
    }
    const wd = weekday(iso);
    return wd >= 1 && wd <= 5;
  }
  function nextWorkingDay(iso, cal) {
    let d = iso, hs = holidaySet(cal);
    let guard = 0;
    while (!isWorkingDay(d, cal, hs) && guard++ < 4000) d = addDays(d, 1);
    return d;
  }
  function addWorkingDays(start, days, cal) {
    const n = Number(days) || 0;
    if (!start) return start;
    if (n < 0) return subWorkingDays(start, -n, cal);
    const hs = holidaySet(cal);
    let cur = isWorkingDay(start, cal, hs) ? start : nextWorkingDay(start, cal);
    if (n === 0) return cur;
    let count = 0;
    let guard = 0;
    while (guard++ < 20000) {
      if (isWorkingDay(cur, cal, hs)) {
        count++;
        if (count >= Math.ceil(n)) return cur;
      }
      cur = addDays(cur, 1);
    }
    return cur;
  }
  function subWorkingDays(end, days, cal) {
    const n = Number(days) || 0;
    if (!end) return end;
    if (n <= 0) return end;
    const hs = holidaySet(cal);
    let cur = isWorkingDay(end, cal, hs) ? end : end;
    let count = 0;
    let guard = 0;
    while (guard++ < 20000) {
      if (isWorkingDay(cur, cal, hs)) {
        count++;
        if (count >= Math.ceil(n)) return cur;
      }
      cur = addDays(cur, -1);
    }
    return cur;
  }
  function workingDaysBetween(start, end, cal) {
    if (!start || !end || diffDays(start, end) < 0) return 0;
    const hs = holidaySet(cal);
    let cur = start, count = 0, guard = 0;
    while (diffDays(cur, end) >= 0 && guard++ < 20000) {
      if (isWorkingDay(cur, cal, hs)) count++;
      cur = addDays(cur, 1);
    }
    return count;
  }
  function endFromDuration(start, days, cal) {
    const n = Number(days) || 0;
    if (n <= 0) return start;
    return addWorkingDays(start, n, cal);
  }

  function parseDuration(text, defaultUnit = 'd') {
    if (typeof text === 'number') return { value: text, unit: defaultUnit };
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*(h|d|w|m)?\s*$/i.exec(String(text || ''));
    if (!m) return { value: 0, unit: defaultUnit };
    return { value: Number(m[1]), unit: (m[2] || defaultUnit).toLowerCase() };
  }
  function durationToDays(value, unit, hoursPerDay = 8, workingDaysPerWeek = 5) {
    const v = Number(value) || 0;
    if (unit === 'h') return v / (Number(hoursPerDay) || 8);
    if (unit === 'w') return v * (Number(workingDaysPerWeek) || 5);
    if (unit === 'm') return v * 30;
    return v;
  }
  function formatDuration(days, hoursPerDay = 8, original) {
    if (original) {
      const unit = original.durationUnit || original.unit;
      const value = original.duration != null ? original.duration
        : (original.value != null ? original.value
          : (unit === 'h' ? Number(days) * hoursPerDay : (unit === 'w' ? Number(days) / 5 : Number(days))));
      if (unit === 'h') return round(value, 2) + 'h';
      if (unit === 'w') return round(value, 2) + 'w';
    }
    const d = Number(days) || 0;
    if (Math.abs(d) < 0.01) return '0d';
    return round(d, 2) + 'd';
  }

  function formatNumber(value, decimals = 0) {
    const n = Number(value);
    if (!isFinite(n)) return '—';
    return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) });
  }
  function formatMoney(value, project) {
    if (value == null || value === '' || !isFinite(Number(value))) return '—';
    const symbol = (project && project.currency) || '¥';
    const decimals = project && project.money ? (project.money.decimals == null ? 2 : project.money.decimals) : 2;
    const after = project && project.money && project.money.symbol === 'after';
    const n = formatNumber(Number(value), decimals);
    return after ? n + ' ' + symbol : symbol + n;
  }
  function parseMoney(text) {
    const n = Number(String(text == null ? '' : text).replace(/[^0-9.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  function debounce(fn, wait = 120) {
    let t = 0;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  function download(filename, content, mime = 'application/json') {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 250);
  }
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error);
      r.readAsText(file);
    });
  }
  function slug(s) {
    return String(s || 'plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'plan';
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); }

  function toast(message, type = 'ok', ms = 2600) {
    const root = document.getElementById('toastRoot');
    if (!root) return;
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = message;
    root.appendChild(t);
    setTimeout(() => t.remove(), ms);
  }

  function nextWorkdayAfter(iso, cal) {
    let cur = addDays(iso, 1);
    return nextWorkingDay(cur, cal);
  }
  function dateRange(start, end) {
    const out = [];
    let cur = start;
    let guard = 0;
    while (diffDays(cur, end) >= 0 && guard++ < 5000) { out.push(cur); cur = addDays(cur, 1); }
    return out;
  }

  return {
    MONTHS, MONTHS_SHORT, DAYS, DAYS_SHORT, MS_DAY,
    $, $$, uid, clamp, round, escapeHtml, icon,
    parseDate, toISO, todayISO, addDays, diffDays, weekday, startOfWeek, startOfMonth, endOfMonth, addMonths,
    monthKey, quarterOf, yearOf, monthName, dayName, fmtDate, parseLooseDate, daysBetweenInclusive,
    normCalendar, holidaySet, isWorkingDay, nextWorkingDay, nextWorkdayAfter, addWorkingDays, subWorkingDays, workingDaysBetween,
    endFromDuration, parseDuration, durationToDays, formatDuration,
    formatNumber, formatMoney, parseMoney, debounce, download, readFileText, slug, csv, toast, dateRange
  };
})();
