#!/usr/bin/env node
// 未登录批量抓取小红书笔记的原始内容。零依赖，需 Node >= 18。流程和数据结构见 README.md。
//
// 用法：
//   node scripts/xhs-fetch.mjs                       读 data/links.txt，抓取其中还没下载过的笔记
//   node scripts/xhs-fetch.mjs '<链接或分享文案>' …   只抓命令行给出的链接
//
//   --data <dir>  数据目录（默认 data）
//   --limit <n>   本次最多请求 n 篇笔记
//   --force       已下载过的也重新抓取（刷新互动数和评论）
//   --dry-run     只列出将要抓取的链接，不发任何请求
//   --print       只抓第一条链接，把 note.json 打印到 stdout，不落盘
//   --web         图片改存 1440 宽 webp（默认无水印原图）
//
// 原理：用手机 UA 请求 H5 落地页 /discovery/item/<id>?xsec_token=..&xsec_source=..，
// 页面 SSR 的 window.__INITIAL_STATE__ 里带有正文、全部图片、互动数和前 5 条评论。
// 每两篇笔记之间随机等待 20–40 秒；遇到验证码、登录页等风控信号时整批立即停止。

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IMG_HOST = 'https://sns-img-qc.xhscdn.com';
const INTERVAL_SEC = [20, 40]; // 两次笔记页请求之间的随机间隔，防风控
const MAX_CONSECUTIVE_FAILURES = 3; // 连续失败这么多次就停，可能是没识别出来的风控
const SCHEMA = 1; // note.json 的格式版本

// 被转到验证码页或登录页，或者返回风控类状态码。遇到这种情况就停止整批，不再继续请求
class RiskControlError extends Error {}

function parseArgs(argv) {
  const args = { inputs: [], data: 'data', limit: Infinity, force: false, dryRun: false, print: false, web: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data') args.data = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--print') args.print = true;
    else if (a === '--web') args.web = true;
    else if (a.startsWith('--')) throw new Error(`未知参数 ${a}`);
    else args.inputs.push(a);
  }
  if (!(args.limit > 0)) throw new Error('--limit 需要一个正整数');
  return args;
}

// 分享文案里通常夹着一句话和链接，取第一个 http(s) 链接；没有链接返回 null
function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s，。！]+/);
  return m ? m[0] : null;
}

// 网页版链接里直接带笔记 ID；短链要请求一次才知道
function noteIdFromUrl(url) {
  return url.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})/)?.[1] ?? null;
}

// "1.2万" / "10万+" / "650" -> 数字；空串 -> null
function parseCount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[+,\s]/g, '');
  const m = s.match(/^([\d.]+)(万|w|亿)?$/i);
  if (!m) return null;
  const mul = { 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8 }[m[2]] ?? 1;
  return Math.round(parseFloat(m[1]) * mul);
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': MOBILE_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  const final = new URL(res.url);
  if (/\/(website-login|login)/.test(final.pathname) || [403, 429, 461, 471].includes(res.status)) {
    throw new RiskControlError(`被转到 ${final.pathname}（HTTP ${res.status}），疑似触发风控`);
  }
  if (final.pathname.startsWith('/404')) {
    const why = [final.searchParams.get('error_code'), final.searchParams.get('error_msg')].filter(Boolean).join(' ');
    throw new Error(`被重定向到 /404${why ? `（${why}）` : ''}；` +
      '通常是链接缺少/错误的 xsec_token，或笔记已删除/不可见');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return { finalUrl: res.url, html: await res.text() };
}

function extractState(html) {
  const m = html.match(/window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*<\/script>/s);
  if (!m) throw new Error('页面中没有 __INITIAL_STATE__');
  // SSR 里是 JS 字面量，裸 undefined 需要替换成 null 才能 JSON.parse
  const json = m[1].replace(/(?<=[:\[,])undefined(?=[,}\]])/g, 'null');
  return JSON.parse(json);
}

function normalizeComment(c) {
  return {
    id: c.id,
    content: c.content,
    time: iso(c.time),
    ipLocation: c.ipLocation || null,
    // 未登录时 likeCount 恒为 0，展示用的赞数在 likeViewCount
    likeCount: parseCount(c.likeViewCount) ?? c.likeCount ?? null,
    user: { id: c.user?.userId, nickname: c.user?.nickname, avatar: c.user?.image },
    pictures: (c.pictures || []).map((p) => p.urlDefault || p.url).filter(Boolean),
    subCommentCount: c.subCommentCount ?? 0,
    subComments: (c.subComments || []).map(normalizeComment),
  };
}

function normalize(state, finalUrl, input) {
  const data = state?.noteData?.data;
  const n = data?.noteData;
  if (!n?.noteId) throw new Error('state 中没有笔记数据（可能已删除/仅自己可见/被风控）');
  const q = state.noteData.routeQuery || {};
  const ii = n.interactInfo || {};
  const cd = data.commentData || {};
  const video = n.video?.media?.stream;
  return {
    schema: SCHEMA,
    noteId: n.noteId,
    type: n.type, // normal = 图文，video = 视频
    url: `https://www.xiaohongshu.com/discovery/item/${n.noteId}` +
      `?xsec_token=${encodeURIComponent(q.xsec_token || '')}&xsec_source=${q.xsec_source || ''}`,
    title: n.title,
    desc: n.desc,
    publishTime: iso(n.time),
    lastUpdateTime: iso(n.lastUpdateTime),
    author: { id: n.user?.userId, nickname: n.user?.nickName, avatar: n.user?.avatar },
    tags: (n.tagList || []).map((t) => t.name),
    counts: {
      liked: parseCount(ii.likedCount),
      collected: parseCount(ii.collectedCount),
      comment: parseCount(ii.commentCount),
      share: parseCount(ii.shareCount),
    },
    images: (n.imageList || []).map((im) => ({
      fileId: im.fileId,
      width: im.width,
      height: im.height,
      // fileId 拼出的地址无签名、无水印、可直接访问
      original: `${IMG_HOST}/${im.fileId}`,
      web: `${IMG_HOST}/${im.fileId}?imageView2/2/w/1440/format/webp`,
      livePhoto: !!im.livePhoto,
      livePhotoVideo: im.stream?.h264?.[0]?.masterUrl || null,
      local: null,
      livePhotoLocal: null,
    })),
    video: video
      ? { url: video.h264?.[0]?.masterUrl || video.h265?.[0]?.masterUrl || null, local: null }
      : null,
    comments: {
      total: cd.commentCount ?? parseCount(ii.commentCount),
      topLevelTotal: cd.commentCountL1 ?? null,
      hasMore: !!cd.hasMore,
      items: (cd.comments || []).map(normalizeComment),
    },
    source: { input, finalUrl, fetchedAt: new Date().toISOString(), loggedIn: false },
    downloadErrors: [],
  };
}

const EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
};

// 返回落盘的文件名；扩展名按 Content-Type 决定，原图不一定都是 JPEG。CDN 偶发失败时重试两次
async function download(url, dir, base) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': MOBILE_UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      const name = `${base}.${EXT[(res.headers.get('content-type') || '').split(';')[0]] || 'bin'}`;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(join(dir, name)));
      return name;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(2000 * attempt);
    }
  }
}

// 先写到 notes/.tmp-<id>/，全部图片下载成功后再换成 notes/<id>/，中途失败或中断不会留下半份数据。
// 图片下载失败算整篇失败；视频和 Live 图视频未经验证，失败只记到 downloadErrors
async function saveNote(state, note, notesDir, { web }) {
  const finalDir = join(notesDir, note.noteId);
  const tmp = join(notesDir, `.tmp-${note.noteId}`);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(join(tmp, 'images'), { recursive: true });
  try {
    await writeFile(join(tmp, 'raw.json'), JSON.stringify(state.noteData.data, null, 2));
    const optional = async (url, dir, base) => {
      try {
        return await download(url, join(tmp, dir), base);
      } catch (e) {
        note.downloadErrors.push(`${dir}/${base}: ${e.message}`);
        return null;
      }
    };
    for (const [i, im] of note.images.entries()) {
      const base = String(i + 1).padStart(2, '0');
      im.local = `images/${await download(web ? im.web : im.original, join(tmp, 'images'), base)}`;
      if (im.livePhotoVideo) {
        const name = await optional(im.livePhotoVideo, 'images', `${base}.live`);
        im.livePhotoLocal = name && `images/${name}`;
      }
    }
    if (note.video?.url) note.video.local = await optional(note.video.url, '.', 'video');
    await writeFile(join(tmp, 'note.json'), JSON.stringify(note, null, 2));
    await rm(finalDir, { recursive: true, force: true });
    await rename(tmp, finalDir);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

// 链接清单：一行一条，可以是整段分享文案；空行和 # 开头的行忽略
async function readLinks(file) {
  if (!existsSync(file)) throw new Error(`没有找到 ${file}；请创建它，每行粘贴一条小红书链接或分享文案`);
  return (await readFile(file, 'utf8')).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const notesDir = join(args.data, 'notes');
  const indexFile = join(args.data, 'index.json');
  const lines = args.inputs.length ? args.inputs : await readLinks(join(args.data, 'links.txt'));

  const urls = [];
  for (const line of lines) {
    const url = extractUrl(line);
    if (!url) console.error(`⚠ 跳过：这一行没有链接 —— ${line.slice(0, 60)}`);
    else if (!urls.includes(url)) urls.push(url);
  }

  if (args.print) {
    if (!urls.length) throw new Error('没有可抓取的链接');
    const { finalUrl, html } = await fetchPage(urls[0]);
    console.log(JSON.stringify(normalize(extractState(html), finalUrl, urls[0]), null, 2));
    return;
  }

  // index.json：链接 -> 抓取结果。短链要请求一次才知道笔记 ID，靠它在不发请求的情况下跳过已下载的链接
  const index = existsSync(indexFile) ? JSON.parse(await readFile(indexFile, 'utf8')) : {};
  const saved = (id) => !!id && existsSync(join(notesDir, id, 'note.json'));
  const todo = [];
  for (const url of urls) {
    const id = index[url]?.status === 'ok' ? index[url].noteId : noteIdFromUrl(url);
    if (!args.force && saved(id)) continue;
    todo.push(url);
  }
  const batch = todo.slice(0, args.limit);
  const minutes = Math.ceil((batch.length * 36) / 60);
  console.error(`链接 ${urls.length} 条，已下载 ${urls.length - todo.length} 条，本次抓取 ${batch.length} 条` +
    (batch.length > 1 ? `（每篇间隔 ${INTERVAL_SEC[0]}–${INTERVAL_SEC[1]}s，预计约 ${minutes} 分钟）` : ''));
  if (args.dryRun) {
    batch.forEach((u, i) => console.log(`${i + 1}. ${u}`));
    return;
  }
  if (!batch.length) return;

  await mkdir(notesDir, { recursive: true });
  for (const f of await readdir(notesDir)) {
    if (f.startsWith('.tmp-')) await rm(join(notesDir, f), { recursive: true, force: true });
  }

  let ok = 0, failed = 0, consecutive = 0, stopped = null, requested = false;
  const doneThisRun = new Set(); // 同一批里多条链接指向同一篇时，即使 --force 也只下载一次
  for (const [i, url] of batch.entries()) {
    const tag = `[${i + 1}/${batch.length}]`;
    const knownId = noteIdFromUrl(url);
    if (doneThisRun.has(knownId) || (!args.force && saved(knownId))) {
      console.error(`${tag} = ${knownId} 本批已经下载过，跳过`);
      const same = Object.values(index).find((v) => v.noteId === knownId && v.status === 'ok');
      index[url] = { noteId: knownId, status: 'ok', title: same?.title ?? null, fetchedAt: new Date().toISOString() };
      await writeFile(indexFile, JSON.stringify(index, null, 2));
      ok++;
      continue;
    }
    if (requested) {
      const sec = INTERVAL_SEC[0] + Math.random() * (INTERVAL_SEC[1] - INTERVAL_SEC[0]);
      console.error(`  … 等待 ${sec.toFixed(1)}s`);
      await sleep(sec * 1000);
    }
    requested = true;
    try {
      const { finalUrl, html } = await fetchPage(url);
      const state = extractState(html);
      const note = normalize(state, finalUrl, url);
      if (doneThisRun.has(note.noteId) || (!args.force && saved(note.noteId))) {
        console.error(`${tag} = ${note.noteId} 「${note.title}」 已经下载过（另一条链接指向同一篇），不再重复下载`);
      } else {
        await saveNote(state, note, notesDir, args);
        console.error(`${tag} ✓ ${note.noteId} 「${note.title}」 ` +
          `图片 ${note.images.length} 张${note.video ? '，视频 1 个' : ''}，` +
          `评论 ${note.comments.items.length}/${note.comments.total} 条` +
          (note.downloadErrors.length ? `；⚠ ${note.downloadErrors.length} 个文件下载失败，见 downloadErrors` : ''));
      }
      index[url] = { noteId: note.noteId, status: 'ok', title: note.title, fetchedAt: new Date().toISOString() };
      doneThisRun.add(note.noteId);
      ok++;
      consecutive = 0;
    } catch (e) {
      console.error(`${tag} ✗ ${url}\n    ${e.message}`);
      index[url] = { status: 'failed', error: e.message, fetchedAt: new Date().toISOString() };
      failed++;
      if (e instanceof RiskControlError) stopped = '触发风控';
      else if (++consecutive >= MAX_CONSECUTIVE_FAILURES) stopped = `连续失败 ${consecutive} 次`;
    }
    await writeFile(indexFile, JSON.stringify(index, null, 2));
    if (stopped) break;
  }

  const left = batch.length - ok - failed;
  console.error(`完成：成功 ${ok}，失败 ${failed}` + (left ? `，未执行 ${left}` : '') + ` -> ${notesDir}`);
  if (stopped) {
    console.error(`■ 已停止：${stopped}。请过一段时间（建议几小时）再重新运行；失败和未执行的链接下次会自动重试`);
    process.exitCode = 2;
  } else if (failed) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
