// 归一化、合并、完整度统计。纯函数，不碰 DOM 和 chrome.*：
// 侧边栏（sidepanel.js）和 Node 脚本（scripts/merge-captures.mjs）共用这一份。
//
// 输入是 snapshot.js 从页面读出来的一篇笔记 { noteId, note, comments }（mode 为 'store' 或 'dom'），
// 输出 data/captures/<noteId>/comments.json。items[] 的结构和 data/notes/<id>/note.json 里的
// comments.items[] 相同，另外多几个字段，见 README「用插件补全评论」。

export const SCHEMA = 1;

// "1.2万" / "10万+" / "650" -> 数字；空串 -> null。和 scripts/xhs-fetch.mjs 一致
export function parseCount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[+,\s]/g, '');
  const m = s.match(/^([\d.]+)(万|w|亿)?$/i);
  if (!m) return null;
  const mul = { 万: 1e4, w: 1e4, W: 1e4, 亿: 1e8 }[m[2]] ?? 1;
  return Math.round(parseFloat(m[1]) * mul);
}

const iso = (ms) => (ms ? new Date(ms).toISOString() : null);

// 文件名里不能有冒号：2026-10-20T08:31:05.123Z -> 2026-10-20T08-31-05Z
export const stampOf = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

// showTags 里是 'is_author' / 'user_top' / 'ai_bot'；以防是对象，也认 { type } / { name }
const tagsOf = (c) => (c.showTags || []).map((t) => (typeof t === 'string' ? t : t && (t.type || t.name))).filter(Boolean);

// PC 网页版 store 里的评论 -> note.json 的评论结构
function storeComment(c, sub) {
  const u = c.userInfo || c.user || {};
  const tags = tagsOf(c);
  const like = parseCount(c.likeCount);
  const view = parseCount(c.likeViewCount);
  const subs = sub ? [] : (c.subComments || []).map((x) => storeComment(x, true));
  const subCount = sub ? 0 : parseCount(c.subCommentCount) ?? 0;
  const tc = c.targetComment;
  const out = {
    id: c.id,
    content: c.content ?? '',
    time: iso(c.createTime ?? c.time),
    ipLocation: c.ipLocation || null,
    likeCount: view !== null && !like ? view : like,
    user: { id: u.userId ?? null, nickname: u.nickname ?? null, avatar: u.image ?? null },
    pictures: (c.pictures || []).map((p) => p.urlDefault || p.url || p.urlPre).filter(Boolean),
    subCommentCount: subCount,
    subComments: subs,
    isAuthor: tags.includes('is_author'),
    isPinned: tags.includes('user_top'),
    isBot: tags.includes('ai_bot') || !!u.aiAgent,
    replyTo: tc?.id ? { id: tc.id, userId: tc.userInfo?.userId ?? null, nickname: tc.userInfo?.nickname ?? null } : null,
    source: 'pc-store',
  };
  // 前端给每条一级评论算了 hasMore（回复是否还没展开完），展开后改成接口返回的 hasMore
  if (!sub) out.subHasMore = typeof c.hasMore === 'boolean' ? c.hasMore : subCount > subs.length;
  return out;
}

// DOM 兜底解析出来的评论。时间只有「3 天前」「10-05」这类文字，放在 timeText，time 留空
function domComment(c, sub) {
  const tags = c.tags || [];
  const subs = sub ? [] : (c.subComments || []).map((x) => domComment(x, true));
  const out = {
    id: c.id,
    content: c.content ?? '',
    time: null,
    timeText: c.timeText || null,
    ipLocation: c.ipLocation || null,
    likeCount: /\d/.test(c.likeText || '') ? parseCount(c.likeText) : 0, // 0 赞时显示的是「赞」
    user: { id: c.user?.userId ?? null, nickname: c.user?.nickname ?? null, avatar: c.user?.image ?? null },
    pictures: c.pictures || [],
    subCommentCount: sub ? 0 : c.subCommentCount ?? subs.length,
    subComments: subs,
    isAuthor: tags.some((t) => t.includes('作者')),
    isPinned: tags.some((t) => t.includes('置顶')),
    isBot: false,
    replyTo: null,
    source: 'pc-dom',
  };
  if (!sub) out.subHasMore = !!c.repliesMore;
  return out;
}

function tokenFromUrl(url, noteId) {
  try {
    const u = new URL(url);
    if (!u.pathname.includes(noteId)) return {};
    return { token: u.searchParams.get('xsec_token'), source: u.searchParams.get('xsec_source') };
  } catch {
    return {};
  }
}

// 笔记元数据。不含图片地址：store 里的图片地址带签名、会过期，原图仍用 scripts/xhs-fetch.mjs 下载
function noteMeta(n, noteId, pageUrl) {
  const ii = n.interactInfo || {};
  // 优先用地址栏里的 token：页面正是用它打开的这篇
  const fromUrl = tokenFromUrl(pageUrl, noteId);
  const token = fromUrl.token || n.xsecToken || null;
  return {
    noteId,
    type: n.type ?? null,
    title: n.title ?? '',
    desc: n.desc ?? '',
    publishTime: iso(n.time),
    lastUpdateTime: iso(n.lastUpdateTime),
    ipLocation: n.ipLocation ?? null,
    author: { id: n.user?.userId ?? null, nickname: n.user?.nickname ?? n.user?.nickName ?? null, avatar: n.user?.avatar ?? null },
    tags: (n.tagList || []).map((t) => t.name).filter(Boolean),
    counts: {
      liked: parseCount(ii.likedCount),
      collected: parseCount(ii.collectedCount),
      comment: parseCount(ii.commentCount),
      share: parseCount(ii.shareCount),
    },
    imageCount: (n.imageList || []).length,
    // 带 xsec_token 的链接可以直接交给 scripts/xhs-fetch.mjs 下载正文和原图
    url: `https://www.xiaohongshu.com/explore/${noteId}` +
      (token ? `?xsec_token=${encodeURIComponent(token)}&xsec_source=${fromUrl.source || 'pc_feed'}` : ''),
    hasToken: !!token,
  };
}

const countReplies = (items) => items.reduce((s, c) => s + c.subComments.length, 0);

// 一篇笔记的快照 -> 归一化后的评论和完整度。hint 可以带上本地 note.json 的 topLevelTotal（PC store 里没有一级评论总数）
export function normalizeSnapshot(entry, { url, capturedAt }, hint = {}) {
  const { noteId, mode } = entry;
  const raw = entry.comments || {};
  const items = (raw.list || []).map((c) => (mode === 'dom' ? domComment(c) : storeComment(c)));
  const meta = noteMeta(entry.note || {}, noteId, url);
  if (meta.counts.comment === null && raw.totalText) meta.counts.comment = parseCount((raw.totalText.match(/[\d.]+万?/) || [])[0]);
  // 一级评论到底：store 里 hasMore=false（并且第一页已经请求过）；DOM 里看到「THE END」
  const topDone = raw.hasMore === false && raw.firstRequestFinish !== false;
  return { noteId, mode, capturedAt, meta, items, topDone, topLevelHint: hint.topLevelTotal ?? null };
}

export function stats(items, { total = null, topLevelTotal = null, topDone = false } = {}) {
  const replies = countReplies(items);
  const replyTotal = items.reduce((s, c) => s + Math.max(c.subCommentCount || 0, c.subComments.length), 0);
  const pending = items.filter((c) => c.subHasMore).length;
  return {
    topLevel: items.length,
    topLevelTotal: topDone ? items.length : topLevelTotal,
    topDone,
    replies,
    replyTotal,
    pendingThreads: pending,
    loaded: items.length + replies,
    total,
  };
}

// 按 id 取并集。旧的保持原来的顺序，新出现的接在后面
function unionById(oldList = [], newList = [], merge) {
  const byId = new Map(oldList.map((c) => [c.id, c]));
  const order = oldList.map((c) => c.id);
  for (const c of newList) {
    if (!byId.has(c.id)) order.push(c.id);
    byId.set(c.id, merge(byId.get(c.id), c));
  }
  return order.map((id) => byId.get(id));
}

// 同一条评论保留最新一次看到的数据（点赞数会变）；但 DOM 兜底的数据不精确，不覆盖 store 读到的
function mergeLeaf(old, neu) {
  if (!old) return neu;
  return old.source === 'pc-store' && neu.source === 'pc-dom' ? old : neu;
}

function mergeTop(old, neu) {
  if (!old) return neu;
  const base = { ...mergeLeaf(old, neu) };
  base.subComments = unionById(old.subComments, neu.subComments, mergeLeaf);
  base.subCommentCount = Math.max(base.subCommentCount || 0, base.subComments.length);
  // 任一次快照里已经展开完，或者已采到的回复数够了，就算展开完
  base.subHasMore = old.subHasMore !== false && neu.subHasMore !== false && base.subComments.length < base.subCommentCount;
  return base;
}

// 把一次快照合并进已有的 comments.json（prev 为 null 表示第一次保存）
export function mergeCapture(prev, snap, file) {
  const items = unionById(prev?.items, snap.items, mergeTop);
  const topDone = snap.topDone || !!prev?.complete?.topLevel;
  // DOM 兜底拿不到互动数和作者，沿用之前 store 读到的元数据
  const meta = snap.mode === 'dom' && prev?.note ? { ...prev.note, title: snap.meta.title || prev.note.title } : snap.meta;
  const total = meta.counts?.comment ?? prev?.total ?? null;
  const s = stats(items, { total, topLevelTotal: snap.topLevelHint ?? prev?.topLevelTotal ?? null, topDone });
  return {
    schema: SCHEMA,
    noteId: snap.noteId,
    source: 'pc-logged-in',
    note: meta,
    total,
    topLevelTotal: s.topLevelTotal,
    hasMore: !topDone,
    items,
    loaded: { topLevel: s.topLevel, replies: s.replies, all: s.loaded },
    complete: { topLevel: topDone, replies: s.pendingThreads === 0, pendingThreads: s.pendingThreads },
    snapshots: [
      ...(prev?.snapshots || []).filter((x) => x.file !== file), // 同一秒内点了两次保存，快照文件是同一个
      { file, capturedAt: new Date(snap.capturedAt).toISOString(), mode: snap.mode, topLevel: snap.items.length, replies: countReplies(snap.items) },
    ],
    updatedAt: new Date(snap.capturedAt).toISOString(),
  };
}

// 快照里所有评论 ID（一级 + 回复），和页面 DOM 里的 comment-<id> 做比对
export function crossCheck(items, domIds) {
  const storeIds = new Set(items.flatMap((c) => [c.id, ...c.subComments.map((r) => r.id)]));
  const dom = new Set(domIds.map((d) => d.id));
  return {
    store: storeIds.size,
    dom: dom.size,
    onlyStore: [...storeIds].filter((id) => !dom.has(id)),
    onlyDom: [...dom].filter((id) => !storeIds.has(id)),
  };
}

// 追加到 data/links.txt 的一行。链接放前面：标题可能以 # 开头，放前面会被当成注释行
export const linkLine = (meta) => `${meta.url} ${meta.title.replace(/\s+/g, ' ').trim()}`;
