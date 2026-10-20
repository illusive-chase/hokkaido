// 侧边栏：选择数据目录、读取当前页面、显示完整度、保存到 data/captures/、追加 data/links.txt。
// 页面里只在点「读取」或「保存」时注入一次 snapshot.js 里的 xhsSnapshot（只读），其余都在扩展自己的页面里完成。
import { crossCheck, linkLine, mergeCapture, normalizeSnapshot, SCHEMA, stampOf, stats } from './lib.js';

const $ = (id) => document.getElementById(id);
const XHS = /^https:\/\/www\.xiaohongshu\.com\//;
const NOTE_PATH = /\/(?:explore|discovery\/item)\/([0-9a-f]{24})/;

let dataDir = null; // FileSystemDirectoryHandle，指向仓库的 data/
let view = null; // 最近一次读取的结果：{ tabId, url, snap, current, entries[], links, index }
let stale = false; // 读取之后页面又变了
const picked = new Map(); // noteId -> 是否勾选保存。跨多次读取保留你的选择

// 给用户看的错误，不带调用栈
class UserError extends Error {}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pct = (a, b) => (b ? ` <span class="muted">${Math.min(100, Math.round((a / b) * 100))}%</span>` : '');
const fmtTime = (iso) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

function log(msg, cls = '') {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })}  ${msg}`;
  $('log').prepend(line);
  while ($('log').childElementCount > 30) $('log').lastElementChild.remove();
}

// ---- 目录句柄存在扩展自己的 IndexedDB 里，下次打开直接复用 ----
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('xhs-capture', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const store = db.transaction('kv', value === undefined ? 'readonly' : 'readwrite').objectStore('kv');
    const req = value === undefined ? store.get(key) : store.put(value, key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// request=true 时如果还没授权就弹出确认，只能在点击事件里调用（需要用户手势）
async function permitted(request) {
  if (!dataDir) return false;
  const opts = { mode: 'readwrite' };
  if ((await dataDir.queryPermission(opts)) === 'granted') return true;
  return request && (await dataDir.requestPermission(opts)) === 'granted';
}

// ---- 文件读写，path 是相对 data/ 的路径数组 ----
async function subdir(path, create) {
  let d = dataDir;
  for (const p of path) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function readText(path) {
  try {
    const dir = await subdir(path.slice(0, -1), false);
    return await (await (await dir.getFileHandle(path.at(-1))).getFile()).text();
  } catch (e) {
    if (e.name === 'NotFoundError' || e.name === 'TypeMismatchError') return null;
    throw e;
  }
}
async function readJson(path) {
  const text = await readText(path);
  return text === null ? null : JSON.parse(text);
}
// createWritable 先写到临时文件，close() 时才替换原文件，中途失败不会留下半个文件
async function writeText(path, text) {
  const dir = await subdir(path.slice(0, -1), true);
  const w = await (await dir.getFileHandle(path.at(-1), { create: true })).createWritable();
  await w.write(text);
  await w.close();
}
async function hasDir(dir, name) {
  try {
    return await dir.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function showDir() {
  $('dir-name').textContent = dataDir ? dataDir.name : '未选择';
  const hint = $('dir-hint');
  if (!dataDir) return;
  if (!(await permitted(false))) {
    hint.innerHTML = '浏览器重启后需要重新授权：点「读取」或「保存」时会弹出确认。';
    hint.className = 'small warn';
    return;
  }
  const notes = await hasDir(dataDir, 'notes');
  let n = 0;
  if (notes) for await (const [, h] of notes.entries()) if (h.kind === 'directory' && /^[0-9a-f]{24}$/.test(h.name)) n++;
  hint.innerHTML = notes
    ? `里面有 notes/（${n} 篇）。保存的内容写到 <code>${esc(dataDir.name)}/captures/</code>。`
    : '这个目录里没有 notes/，确定是仓库里的 data 目录吗？（仍然可以保存）';
  hint.className = notes ? 'small muted' : 'small warn';
}

$('pick-dir').onclick = async () => {
  let h;
  try {
    h = await showDirectoryPicker({ id: 'hokkaido-data', mode: 'readwrite' });
  } catch (e) {
    if (e.name !== 'AbortError') log(`选择目录失败：${e.message}`, 'bad');
    return;
  }
  // 选的是仓库根目录：自动进入 data/
  if (!(await hasDir(h, 'notes'))) h = (await hasDir(h, 'data')) || h;
  dataDir = h;
  await kv('dataDir', h);
  await showDir();
  if (view) {
    await enrich();
    render();
  }
  updateButtons();
};

// ---- 当前标签页 ----
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function showPage() {
  const tab = await activeTab();
  const url = tab?.url; // 只有小红书的页面能拿到 url（host_permissions），其他页面是 undefined
  const id = url && XHS.test(url) ? url.match(NOTE_PATH)?.[1] : null;
  $('page').textContent = !url || !XHS.test(url) ? '不是小红书页面' : id ? `笔记 ${id}` : '小红书（不是笔记页）';
  if (view && (tab?.id !== view.tabId || url !== view.url)) {
    stale = true;
    render();
  }
  updateButtons(url && XHS.test(url));
}

let onXhs = false;
function updateButtons(xhs = onXhs) {
  onXhs = !!xhs;
  $('read').disabled = !onXhs;
  $('save').disabled = !onXhs || !dataDir;
  $('save').textContent = !dataDir ? '保存（先选择数据目录）' : '保存';
}

// 注入页面执行一次只读的 xhsSnapshot，返回纯数据
async function snapshotTab() {
  const tab = await activeTab();
  if (!tab?.url || !XHS.test(tab.url)) throw new UserError('当前标签页不是小红书网页版');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: window.xhsSnapshot });
  const snap = res?.result;
  if (!snap) throw new Error('页面没有返回结果');
  if (!snap.ok) throw new Error(`页面里读取失败：${snap.error}`);
  return { tab, snap };
}

async function load(tab, snap) {
  view = {
    tabId: tab.id,
    url: tab.url,
    snap,
    current: snap.dom?.noteId || snap.currentNoteId,
    entries: snap.notes.map((raw) => ({ noteId: raw.noteId, raw, error: raw.error })),
  };
  stale = false;
  await enrich();
}

// 读本地的 note.json / comments.json / links.txt / index.json，算出完整度和「保存后会变成什么样」
async function enrich() {
  const ok = await permitted(false);
  view.local = ok;
  view.links = ok ? (await readText(['links.txt'])) ?? '' : null;
  view.index = ok ? (await readJson(['index.json'])) ?? {} : null;
  for (const e of view.entries) {
    if (e.error) continue;
    e.note = ok ? await readJson(['notes', e.noteId, 'note.json']) : undefined; // undefined：没授权，不知道
    e.prev = ok ? await readJson(['captures', e.noteId, 'comments.json']) : undefined;
    e.norm = normalizeSnapshot(e.raw, view.snap, { topLevelTotal: e.note?.comments?.topLevelTotal });
    e.merged = mergeCapture(e.prev ?? null, e.norm, null);
  }
}

// 默认勾选：当前这篇，以及本地已经有的（data/notes 里下载过或者以前保存过）。小号随手看过的其他笔记不默认保存
const isPicked = (e) => picked.get(e.noteId) ?? (e.noteId === view.current || !!e.note || !!e.prev);

function inLinks(id) {
  if (view.links?.includes(id)) return true;
  return Object.values(view.index ?? {}).some((v) => v?.noteId === id);
}

function renderEntry(e) {
  if (e.error) return `<div class="note"><h2><span class="bad">读取 ${esc(e.noteId)} 出错</span></h2><p class="small">${esc(e.error)}</p></div>`;
  const { norm, merged, prev } = e;
  const cur = e.noteId === view.current;
  const s = stats(norm.items, { total: norm.meta.counts.comment, topLevelTotal: norm.topLevelHint, topDone: norm.topDone });
  const rows = [];

  const topTotal = s.topLevelTotal ?? '?';
  rows.push(['一级评论', `${s.topLevel} / ${topTotal}${typeof s.topLevelTotal === 'number' ? pct(s.topLevel, s.topLevelTotal) : ''} ` +
    (s.topDone ? '<span class="ok">✓ 已到底</span>' : '<span class="warn">还没到底，继续往下翻</span>')]);
  rows.push(['回复', `${s.replies} / ${s.replyTotal}${pct(s.replies, s.replyTotal)} ` +
    (s.pendingThreads ? `<span class="warn">${s.pendingThreads} 楼还没展开完</span>` : s.replyTotal ? '<span class="ok">✓ 全部展开</span>' : '')]);
  if (s.total) rows.push(['全部', `${s.loaded} / ${s.total}${pct(s.loaded, s.total)}`]);

  // DOM 只能看到当前打开的这一篇
  if (cur && norm.mode === 'store' && view.snap.dom) {
    const c = crossCheck(norm.items, view.snap.dom.ids);
    if (!c.dom) rows.push(['页面校验', '<span class="muted">页面上没找到评论元素（浮层关了？），跳过</span>']);
    else if (!c.onlyStore.length && !c.onlyDom.length) rows.push(['页面校验', `<span class="ok">✓ 和页面上的 ${c.dom} 条一致</span>`]);
    else {
      rows.push(['页面校验', `<span class="warn">store ${c.store} 条，页面 ${c.dom} 条</span>` +
        (c.onlyDom.length ? `<br><span class="bad">页面上有 ${c.onlyDom.length} 条 store 里没有</span>` : '') +
        (c.onlyStore.length ? `<br><span class="muted">store 里有 ${c.onlyStore.length} 条页面上没显示</span>` : '')]);
    }
  }
  if (cur && view.snap.dom?.loginWall) rows.push(['登录', '<span class="bad">评论区显示「登录查看全部评论」，当前没有登录</span>']);

  if (e.saved) {
    rows.push(['已保存', `<span class="ok">✓ 刚刚 · 共 ${prev.loaded.all} 条（+${e.saved.added}）</span>`]);
  } else if (prev) {
    rows.push(['上次保存', `${fmtTime(prev.updatedAt)} · ${prev.loaded.all} 条 → 合并后 ${merged.loaded.all} 条` +
      (merged.loaded.all > prev.loaded.all ? ` <span class="ok">+${merged.loaded.all - prev.loaded.all}</span>` : ' <span class="muted">没有新评论</span>')]);
  }

  if (e.note === undefined) rows.push(['本地正文', '<span class="muted">未授权，不知道</span>']);
  else if (e.note) rows.push(['本地正文', '<span class="ok">✓ data/notes 里已有</span>']);
  else if (inLinks(e.noteId)) rows.push(['本地正文', '还没下载，已在 links.txt 里，运行 <code>npm run fetch</code>']);
  else if (norm.meta.hasToken) rows.push(['本地正文', `还没下载 <button class="small" data-link="${esc(e.noteId)}">追加到 links.txt</button>`]);
  else rows.push(['本地正文', '<span class="muted">还没下载；拿不到 xsec_token，没法追加链接（从首页或搜索结果点进笔记再试）</span>']);

  const mode = norm.mode === 'dom' ? '<span class="badge warn" title="读不到 store，改为解析页面。时间只精确到天，点赞是缩写值">DOM 兜底</span>' : '';
  return `<div class="note${cur ? ' current' : ''}">
    <h2><input type="checkbox" data-pick="${esc(e.noteId)}"${isPicked(e) ? ' checked' : ''}>
      <span>${esc(norm.meta.title || '（无标题）')}</span>${cur ? '<span class="badge">当前</span>' : ''}${mode}</h2>
    <div class="id">${esc(e.noteId)}</div>
    <dl class="stats">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
  </div>`;
}

function render() {
  const box = $('notes');
  if (!view) {
    box.innerHTML = '';
    return;
  }
  const { snap } = view;
  let html = stale ? '<p class="small warn">页面已经变化，点「读取」刷新。</p>' : '';
  if (!snap.mode) {
    html += `<div class="note"><h2><span class="bad">没读到数据</span></h2>
      <p class="small">既没找到页面的 note store，也不在笔记页上。打开一篇笔记（浮层或 /explore/&lt;id&gt; 都可以）再试。</p></div>`;
  } else if (!view.entries.length) {
    html += '<p class="small muted">store 里还没有打开过的笔记。</p>';
  }
  const cur = view.entries.filter((e) => e.noteId === view.current);
  const rest = view.entries.filter((e) => e.noteId !== view.current);
  html += cur.map(renderEntry).join('');
  if (rest.length) {
    html += `<p class="small muted group">${cur.length ? '这次浏览里还打开过这些' : '这次浏览里打开过这些'}` +
      '（页面内存里还留着；本地已有的默认勾选）：</p>' + rest.map(renderEntry).join('');
  }
  if (snap.mode !== 'store' || view.entries.some((e) => e.raw.mode === 'dom')) {
    html += `<details><summary>诊断信息（读不到 store 时请把这段发回来）</summary><pre>${esc(JSON.stringify(snap.diag, null, 1))}</pre></details>`;
  }
  box.innerHTML = html;
}

$('notes').addEventListener('change', (ev) => {
  const id = ev.target.dataset.pick;
  if (id) picked.set(id, ev.target.checked);
});

$('notes').addEventListener('click', async (ev) => {
  const id = ev.target.dataset.link;
  if (!id) return;
  const e = view.entries.find((x) => x.noteId === id);
  try {
    if (!(await permitted(true))) throw new UserError('没有获得目录的写入权限');
    const text = (await readText(['links.txt'])) ?? '';
    if (text.includes(id)) {
      log(`${id} 已经在 links.txt 里了`);
    } else {
      await writeText(['links.txt'], text + (text && !text.endsWith('\n') ? '\n' : '') + linkLine(e.norm.meta) + '\n');
      log(`已追加到 links.txt：${e.norm.meta.title}。运行 npm run fetch 下载正文和原图`, 'ok');
    }
    await enrich();
    render();
  } catch (err) {
    fail(err);
  }
});

function fail(err) {
  log(err instanceof UserError ? err.message : `出错：${err.message}`, 'bad');
  if (!(err instanceof UserError)) console.error(err);
}

async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    await fn();
  } catch (err) {
    fail(err);
  } finally {
    btn.textContent = label;
    updateButtons();
  }
}

$('read').onclick = () => busy($('read'), async () => {
  if (dataDir) await permitted(true); // 顺便授权，才能显示本地已有的数据；拒绝也能继续
  const { tab, snap } = await snapshotTab();
  await load(tab, snap);
  render();
  const dom = view.entries.filter((e) => e.raw.mode === 'dom').length;
  log(snap.mode ? `读取到 ${view.entries.length} 篇${dom ? `（${dom} 篇用 DOM 兜底）` : ''}` : '没读到数据');
});

$('save').onclick = () => busy($('save'), async () => {
  if (!dataDir) throw new UserError('先选择数据目录');
  // 先授权再读页面：requestPermission 需要用户手势，不能拖到其他 await 之后太久
  if (!(await permitted(true))) throw new UserError('没有获得目录的写入权限');
  const { tab, snap } = await snapshotTab();
  await load(tab, snap);
  const todo = view.entries.filter((e) => !e.error && isPicked(e));
  if (!todo.length) {
    render();
    throw new UserError(snap.mode ? '没有勾选要保存的笔记' : '没读到数据，没有保存');
  }
  const file = `${stampOf(snap.capturedAt)}.json`;
  for (const e of todo) {
    // 原样存一份快照，只增不改。以后归一化逻辑改了，可以用 npm run captures 从快照重新生成 comments.json
    await writeText(['captures', e.noteId, 'snapshots', file], JSON.stringify({
      schema: SCHEMA,
      noteId: e.noteId,
      capturedAt: new Date(snap.capturedAt).toISOString(),
      url: snap.url,
      mode: e.raw.mode,
      note: e.raw.note,
      comments: e.raw.comments,
      dom: e.noteId === view.current ? snap.dom : null,
      diag: snap.diag,
    }));
    const next = mergeCapture(e.prev ?? null, e.norm, `snapshots/${file}`);
    await writeText(['captures', e.noteId, 'comments.json'], JSON.stringify(next, null, 2) + '\n');
    const added = next.loaded.all - (e.prev?.loaded.all ?? 0);
    e.saved = { added };
    log(`已保存 ${e.norm.meta.title || e.noteId}：共 ${next.loaded.all} 条（+${added}）`, 'ok');
  }
  await enrich();
  render();
});

chrome.tabs.onActivated.addListener(() => showPage());
chrome.tabs.onUpdated.addListener((_, info) => {
  if (info.url || info.status === 'complete') showPage();
});

(async () => {
  dataDir = (await kv('dataDir').catch(() => null)) ?? null;
  await showDir();
  await showPage();
})();
