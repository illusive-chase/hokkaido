// 点「检查」或「保存」时，侧边栏用 chrome.scripting.executeScript({ world: 'MAIN', func: xhsSnapshot })
// 把这个函数注入页面执行一次。函数会被序列化后在页面里运行，所以不能引用外部变量，所有逻辑都写在函数体内。
//
// 只读：不调用任何 store action，不改 DOM，不发请求，不模拟点击或滚动。
// 整体包在 try/catch 里，出错时把错误作为返回值交给侧边栏，不让异常冒泡到页面的错误监控。
//
// 数据来源（见 README「用插件补全评论」）：
//   首选  #app.__vue_app__.config.globalProperties.$pinia._s.get('note').noteDetailMap
//   兜底  读不到 store 时解析评论区 DOM（只有当前打开的这一篇，时间和点赞数不精确）
// eslint-disable-next-line no-unused-vars
function xhsSnapshot() {
  try {
    const out = {
      ok: true,
      url: location.href,
      capturedAt: Date.now(),
      mode: null, // 'store' | 'dom' | null（两种都读不到）。每篇笔记另有自己的 mode
      currentNoteId: null,
      notes: [],
      dom: null,
      diag: {},
    };
    const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    // reactive 对象转成普通数据。在 effect 之外读取，Vue 不会记录依赖，也不会触发重新渲染
    const plain = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

    // ---- 1. Pinia store ----
    let state = null;
    try {
      const hosts = [document.querySelector('#app'), ...document.querySelectorAll('body > div')];
      const app = hosts.map((el) => el && el.__vue_app__).find(Boolean);
      const pinia = app && app.config && app.config.globalProperties && app.config.globalProperties.$pinia;
      out.diag.vueApp = !!app;
      out.diag.pinia = !!pinia;
      out.diag.stores = pinia && pinia._s ? [...pinia._s.keys()] : [];
      state = (pinia && pinia._s && pinia._s.get('note')) || (pinia && pinia.state && pinia.state.value.note) || null;
      out.diag.noteStore = !!state;
      if (state) out.diag.noteStoreKeys = Object.keys(state).filter((k) => !/^[$_]/.test(k)).slice(0, 80);
    } catch (e) {
      out.diag.storeError = String(e);
    }

    const map = state && state.noteDetailMap;
    if (map && typeof map === 'object') {
      out.mode = 'store';
      out.currentNoteId = state.currentNoteId || null;
      const ids = map instanceof Map ? [...map.keys()] : Object.keys(map);
      for (const id of ids) {
        try {
          const d = map instanceof Map ? map.get(id) : map[id];
          const note = d && d.note;
          const list = d && d.comments && d.comments.list;
          // getNoteDetailByNoteId 会给没打开过的笔记建空条目（note 为 {}），跳过
          const hasNote = note && (note.noteId || note.title || note.desc || note.type);
          if (!hasNote && !(list && list.length)) continue;
          out.notes.push({ noteId: (note && note.noteId) || id, mode: 'store', note: plain(note), comments: plain(d.comments) });
        } catch (e) {
          out.notes.push({ noteId: id, mode: 'store', error: String(e) });
        }
      }
    }

    // ---- 2. DOM：交叉校验；读不到 store 时作为兜底数据。这里出错不影响上面读到的 store 数据 ----
    try {
      const scope = document.querySelector('#noteContainer, .note-container') || document;
      const box = scope.querySelector('.comments-container') || scope;
      const urlId = (location.pathname.match(/\/(?:explore|discovery\/item)\/([0-9a-f]{24})/) || [])[1] || null;
      const endEl = scope.querySelector('.end-container');
      out.dom = {
        noteId: urlId,
        ids: [...box.querySelectorAll('.comment-item[id^="comment-"]')].map((el) => ({
          id: el.id.slice(8),
          sub: el.classList.contains('comment-item-sub'),
        })),
        totalText: text(scope.querySelector('.comments-container .total')),
        endReached: !!endEl && /THE END/i.test(endEl.textContent),
        loginWall: !!scope.querySelector('.comments-login'),
      };
      if (!out.currentNoteId) out.currentNoteId = urlId;

      // store 读不到，或者 store 里没有当前这篇（比如字段改名了），就解析页面上的评论区
      if (urlId && !out.notes.some((n) => n.noteId === urlId && !n.error) && (out.dom.ids.length || out.mode !== 'store')) {
        // 评论内容里的表情是 <img>，取 alt；其余取文字
        const rich = (el) => {
          if (!el) return '';
          let s = '';
          for (const n of el.childNodes) {
            if (n.nodeType === 3) s += n.textContent;
            else if (n.nodeName === 'IMG') s += n.getAttribute('alt') || '';
            else s += rich(n);
          }
          return s;
        };
        const parseItem = (el) => {
          const q = (sel) => el.querySelector(sel);
          const name = q('.author .name') || q('a.name');
          const href = (name && name.getAttribute('href')) || '';
          const loc = text(q('.location'));
          let date = text(q('.date'));
          if (loc && date.endsWith(loc)) date = date.slice(0, -loc.length).trim();
          const avatar = q('.avatar img');
          return {
            id: el.id.slice(8),
            content: rich(q('.content')).trim(),
            timeText: date,
            ipLocation: loc || null,
            likeText: text(q('.like .count')),
            user: { userId: (href.match(/\/user\/profile\/([0-9a-zA-Z]+)/) || [])[1] || null, nickname: text(name), image: avatar ? avatar.src : null },
            tags: [...el.querySelectorAll('.author-wrapper .tag')].map(text).filter(Boolean),
            pictures: [...el.querySelectorAll('.comment-picture img')].map((i) => i.src).filter(Boolean),
          };
        };
        const list = [...box.querySelectorAll('.parent-comment')].map((pc) => {
          const top = pc.querySelector('.comment-item:not(.comment-item-sub)');
          if (!top || !top.id) return null;
          const subs = [...pc.querySelectorAll('.comment-item-sub[id^="comment-"]')].map(parseItem);
          // 「展开 12 条回复」能推出回复总数；「展开更多回复」只知道还没展开完
          const more = text(pc.querySelector('.show-more'));
          const n = Number((more.match(/展开\s*(\d+)\s*条/) || [])[1] || 0);
          return Object.assign(parseItem(top), { subComments: subs, subCommentCount: subs.length + n, repliesMore: !!more });
        }).filter(Boolean);
        out.mode = out.mode || 'dom';
        out.notes.push({
          noteId: urlId,
          mode: 'dom',
          note: { noteId: urlId, title: text(scope.querySelector('#detail-title')), desc: text(scope.querySelector('#detail-desc')) },
          comments: { list, hasMore: !out.dom.endReached, totalText: out.dom.totalText },
        });
      }
    } catch (e) {
      out.diag.domError = String(e);
    }
    return out;
  } catch (e) {
    return { ok: false, error: String((e && e.stack) || e) };
  }
}
