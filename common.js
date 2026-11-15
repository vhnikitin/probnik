'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'value') e.value = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}
const pad = n => String(n).padStart(2, '0');
const fmtHMS = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s % 3600 / 60)) + ':' + pad(s % 60); };
function fmtDur(ms) { const s = Math.round(ms / 1000); if (s < 60) return s + ' с'; const m = Math.floor(s / 60); if (m < 60) return m + ' мин ' + (s % 60) + ' с'; return Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин'; }
const fmtTime = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); };
const fmtDate = ts => new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
const balls = n => n + ' ' + plural(n, 'балл', 'балла', 'баллов');
const enc = s => new TextEncoder().encode(s);
const safeName = s => String(s).replace(/[\\/:*?"<>|\s]+/g, '_') || 'file';
const trimRows = g => { const rows = (Array.isArray(g) ? g : []).map(r => (Array.isArray(r) ? r : []).map(c => String(c ?? '').trim())); while (rows.length && rows[rows.length - 1].every(c => !c)) rows.pop(); return rows; };
const emptyGrid = (r, c, old) => Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => (old && old[i] && old[i][j]) || ''));
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { } };

let toastTimer;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = el('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 4500);
}
function scheduler(fn, delay, onErr) {
  let t = null, running = false, again = false;
  const run = async () => {
    t = null;
    if (running) { again = true; return; }
    running = true;
    try { await fn(); } catch (e) { onErr && onErr(e); }
    running = false;
    if (again) { again = false; await run(); }
  };
  return { kick() { if (t) clearTimeout(t); t = setTimeout(run, delay); }, flush() { if (t) clearTimeout(t); return run(); } };
}
function confirmBtn(label, armedLabel, cls, action) {
  const b = el('button', { class: 'btn ' + cls, type: 'button', text: label });
  let armed = false, t;
  const reset = () => { armed = false; b.textContent = label; b.classList.remove('armed'); };
  b.addEventListener('click', async () => {
    if (!armed) { armed = true; b.textContent = armedLabel; b.classList.add('armed'); t = setTimeout(reset, 5000); return; }
    clearTimeout(t); b.disabled = true;
    try { await action(); } finally { b.disabled = false; reset(); }
  });
  return b;
}
function openModal(title, body) {
  const m = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-box' },
      el('div', { class: 'modal-head' }, el('h3', { text: title }), el('button', { class: 'btn sm', type: 'button', text: 'Закрыть', onclick: () => m.remove() })),
      el('div', { class: 'modal-body' }, body)));
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.body.append(m);
  return m;
}

/* ---------- server clock & API ---------- */
const Clock = {
  base: Date.now(), perf: performance.now(),
  now() { return this.base + (performance.now() - this.perf); },
  set(serverNow, half) { this.base = serverNow + (half || 0); this.perf = performance.now(); }
};
async function api(action, data, opt) {
  const url = window.API_URL;
  if (!url || /PASTE_URL_HERE|ВСТАВЬТЕ/.test(url)) throw Object.assign(new Error('Сайт ещё не настроен: в config.js не указан адрес таблицы'), { code: 'no_api' });
  const t0 = performance.now();
  const r = await fetch(url, { method: 'POST', body: JSON.stringify({ action, ...data }), keepalive: !!(opt && opt.keepalive), redirect: 'follow' });
  const j = await r.json();
  if (j && j.now) Clock.set(j.now, (performance.now() - t0) / 2);
  return j;
}

/* ---------- task files ---------- */
const fileCache = new Map();
function fetchFile(f) {
  const paths = f.paths || [f.path];
  const k = paths.join('+');
  if (fileCache.has(k)) return fileCache.get(k);
  const p = (async () => {
    const out = await Promise.all(paths.map(async p => {
      const r = await fetch(p);
      if (!r.ok) throw new Error('Файл не загрузился (код ' + r.status + ')');
      return f.kind === 'table' ? await r.json() : await r.text();
    }));
    return f.kind === 'table' ? out[0] : out.join('');
  })();
  fileCache.set(k, p); p.catch(() => fileCache.delete(k));
  return p;
}
const csvCell = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCSV = rows => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
const toTSV = rows => rows.map(r => r.map(v => String(v ?? '').replace(/[\t\n\r]/g, ' ')).join('\t')).join('\n') + '\n';
function sheetBases(f) {
  const base = safeName(f.name.replace(/\.[^.]+$/, ''));
  const sheets = f.sheets || [{ name: '' }];
  return sheets.map(s => sheets.length > 1 ? base + '_' + safeName(s.name) : base);
}
function pyNames(f) { return f.kind === 'text' ? [safeName(f.name)] : sheetBases(f).flatMap(b => [b + '.csv', b + '.txt']); }
async function pyFilesFor(t) {
  const out = [];
  for (const f of t.files || []) {
    const d = await fetchFile(f);
    const key = (f.paths || [f.path]).join('+');
    if (f.kind === 'text') out.push({ key, name: safeName(f.name), data: enc(d) });
    else {
      const bases = sheetBases({ ...f, sheets: d.sheets });
      d.sheets.forEach((s, i) => {
        out.push({ key: key + ':c' + i, name: bases[i] + '.csv', data: enc(toCSV(s.rows)) });
        out.push({ key: key + ':t' + i, name: bases[i] + '.txt', data: enc(toTSV(s.rows)) });
      });
    }
  }
  return out;
}
async function viewFile(f) {
  const body = el('div', { class: 'stack' }, el('p', { class: 'muted', text: 'Загрузка…' }));
  openModal(f.name, body);
  try {
    const d = await fetchFile(f);
    body.textContent = '';
    if (f.kind === 'text') textViewer(body, d, f); else tableViewer(body, d, f);
  } catch (e) { body.textContent = e.message; }
}
function textViewer(body, text, f) {
  let total = 0; for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) total++;
  if (text.length && !text.endsWith('\n')) total++;
  const LIM = 1500, w = String(total).length;
  const lineAt = start => { let e = text.indexOf('\n', start); if (e === -1) e = text.length; return text.slice(start, e).replace(/\r$/, ''); };
  const q = el('input', { type: 'search', id: 'vq', placeholder: 'Найти в файле', 'aria-label': 'Найти в файле', style: 'flex:1;min-width:180px' });
  const cs = el('input', { type: 'checkbox', id: 'vcs' });
  const ww = el('input', { type: 'checkbox', id: 'vww' });
  const info = el('p', { class: 'small muted' });
  const pre = el('pre', { class: 'viewer-pre noselect' });
  const show = () => {
    const query = q.value; pre.textContent = '';
    const list = []; let more = 0;
    if (query) {
      const esc = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(ww.checked ? '(?<![\\p{L}\\p{N}_])' + esc + '(?![\\p{L}\\p{N}_])' : esc, 'gu' + (cs.checked ? '' : 'i'));
      let hits = 0, lines = 0, lastLs = -1, lineNo = 0, scan = 0, m;
      while ((m = re.exec(text))) {
        if (m[0] === '') { re.lastIndex++; continue; }
        hits++;
        const ls = text.lastIndexOf('\n', m.index - 1) + 1;
        if (ls !== lastLs) {
          for (let i = text.indexOf('\n', scan); i !== -1 && i < ls; i = text.indexOf('\n', i + 1)) lineNo++;
          scan = ls; lastLs = ls; lines++;
          if (list.length < LIM) list.push([lineNo, lineAt(ls)]); else more++;
        }
      }
      info.textContent = `Совпадений: ${hits}, в ${lines} ${plural(lines, 'строке', 'строках', 'строках')}.`;
    } else {
      info.textContent = `Строк: ${total}, символов: ${text.length}. В Python: open('${pyNames(f)[0]}')`;
      let pos = 0;
      for (let i = 0; i < Math.min(LIM, total); i++) { list.push([i, lineAt(pos)]); const e = text.indexOf('\n', pos); if (e === -1) break; pos = e + 1; }
      more = Math.max(0, total - LIM);
    }
    for (const [i, l] of list) pre.append(el('span', { class: 'ln', text: String(i + 1).padStart(w) + '  ' }), l + '\n');
    if (more) pre.append(el('span', { class: 'ln', text: `… ещё ${more} строк. Весь файл доступен в Python.` }));
  };
  [q, cs, ww].forEach(x => x.addEventListener('input', show));
  body.append(el('div', { class: 'row' }, q, el('label', { class: 'row small', for: 'vcs' }, cs, 'Учитывать регистр'), el('label', { class: 'row small', for: 'vww' }, ww, 'Только целое слово')), info, pre);
  show();
}
const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function tableViewer(body, d, f) {
  const bases = sheetBases({ ...f, sheets: d.sheets });
  let cur = 0;
  const tabs = el('div', { class: 'row' }), info = el('p', { class: 'small muted' }), wrap = el('div', { class: 'sheetwrap noselect' });
  const show = () => {
    tabs.textContent = '';
    if (d.sheets.length > 1) d.sheets.forEach((s, i) => tabs.append(el('button', { class: 'btn sm' + (i === cur ? ' primary' : ''), type: 'button', text: s.name, onclick: () => { cur = i; show(); } })));
    const rows = d.sheets[cur].rows, LIM = 500;
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    info.textContent = `Строк: ${rows.length}. В Python: ${bases[cur]}.csv (через запятую) и ${bases[cur]}.txt (через табуляцию).` + (rows.length > LIM ? ` Показаны первые ${LIM}.` : '');
    const tb = el('table', { class: 'sheet' });
    tb.append(el('tr', null, el('th', { text: '' }), Array.from({ length: cols }, (_, j) => el('th', { text: colName(j) }))));
    rows.slice(0, LIM).forEach((r, i) => tb.append(el('tr', null, el('td', { class: 'rh', text: i + 1 }), Array.from({ length: cols }, (_, j) => el('td', { text: r[j] ?? '' })))));
    wrap.textContent = ''; wrap.append(tb);
  };
  body.append(tabs, info, wrap);
  show();
}

/* ---------- Python (Pyodide from jsDelivr, in a worker) ---------- */
const PY_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
const Py = {
  w: null, state: 'off', msg: '', onState: null, written: new Set(), pending: null,
  start() {
    if (this.w) return;
    this.set('loading', 'Python загружается…');
    const src = `const B=${JSON.stringify(PY_BASE)};
importScripts(B+'pyodide.js');
let py=null;
const ready=loadPyodide({indexURL:B}).then(p=>{py=p;
 py.setStdout({batched:s=>postMessage({t:'out',s})});
 py.setStderr({batched:s=>postMessage({t:'err',s})});
 try{py.setStdin({error:true});}catch(e){}
 py.FS.chdir('/home/pyodide');
 postMessage({t:'ready'});}).catch(e=>postMessage({t:'fatal',s:String(e&&e.message||e)}));
self.onmessage=async e=>{const m=e.data;try{await ready;}catch(_){return;} if(!py)return;
 if(m.t==='file'){try{py.FS.writeFile('/home/pyodide/'+m.name,m.data);}catch(err){postMessage({t:'err',s:'Не удалось подготовить файл '+m.name});}return;}
 if(m.t==='run'){const t0=performance.now();let ok=true;const g=py.toPy({'__name__':'__main__'});
  try{py.runPython(m.code,{globals:g});}catch(err){ok=false;postMessage({t:'err',s:String(err&&err.message||err)});}
  finally{try{g.destroy();}catch(_){}}
  postMessage({t:'done',ok,ms:Math.round(performance.now()-t0)});}};`;
    try {
      this.w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.w.onmessage = e => this.recv(e.data);
      this.w.onerror = e => this.set('error', 'Python не запустился' + (e.message ? ': ' + e.message : ''));
    } catch (e) { this.set('error', 'Python не запустился: ' + e.message); }
  },
  set(s, m) { this.state = s; this.msg = m; this.onState && this.onState(); },
  recv(m) {
    if (m.t === 'ready') { if (!this.pending) this.set('ready', 'Python готов'); else this.msg = 'Выполняется…'; }
    else if (m.t === 'fatal') this.set('error', 'Python не запустился: ' + m.s);
    else if (m.t === 'out' || m.t === 'err') this.pending && this.pending.out(m.t, m.s);
    else if (m.t === 'done') { const p = this.pending; this.pending = null; this.set('ready', 'Python готов'); p && p.done(m); }
  },
  writeFiles(list) { for (const f of list) { if (this.written.has(f.key)) continue; this.w.postMessage({ t: 'file', name: f.name, data: f.data }); this.written.add(f.key); } },
  run(code, out) { return new Promise(done => { this.pending = { out, done }; this.set('running', 'Выполняется…'); this.w.postMessage({ t: 'run', code }); }); },
  stop() {
    if (!this.w) return;
    this.w.terminate(); this.w = null; this.written.clear();
    const p = this.pending; this.pending = null;
    this.start();
    p && p.done({ ok: false, stopped: true });
  }
};

/* ---------- event labels (shared with the teacher page) ---------- */
const EV = {
  start: 'Начал экзамен', hidden: 'Ушёл со страницы (вкладка свёрнута или скрыта)', blur: 'Переключился на другое окно или программу',
  back: 'Вернулся на страницу', fs_exit: 'Вышел из полноэкранного режима', fs_back: 'Вернулся в полноэкранный режим', fs_unavail: 'Полноэкранный режим недоступен в его браузере',
  paste_block: 'Пытался вставить текст, скопированный не со страницы экзамена', reload: 'Открыл страницу экзамена заново',
  takeover: 'Продолжил экзамен в другой вкладке или на другом устройстве', printscreen: 'Нажал PrintScreen (снимок экрана)',
  devkeys: 'Нажал сочетание клавиш для инструментов разработчика', finish: 'Сдал работу', timeout: 'Время вышло, работа сдана автоматически', offline: 'Пропадала связь с сервером'
};
