// emoji reaction 的共用前端行為(TopicPosts 的看板列與 DiscussionRoom 的討論室共用同一份,
// 兩邊行為必須一致——同一顆 emoji 在首頁與 Topic 頁按下去的意義不能不一樣)。
//
// 契約:docs/briefs/api-contract.md §4 POST /v1/reactions
//   request  { target_type, target_id, kind, op:"add"|"remove" }
//   response { target_type, target_id, reactions:{emoji:計數}, reaction_actors, mine:[已按的 emoji] }
//
// 不可動的行為:
//   · 一律 credentials:'include'——anon_id 是跨站 cookie(SameSite=None),漏掉的話
//     每一次請求都會被當成新的匿名者,reactions 的 PK 直接失效。
//   · 計數與已按狀態**只認伺服器回應**:按完用回應的 reactions / mine 重繪整列,
//     前端不自己加一、不做樂觀更新。
//   · 失敗(非 2xx / 網路錯 / 形狀不對)→ 還原成按之前的快照 + 顯示可見的失敗提示,
//     絕不假裝成功。
//   · 同一顆按鈕請求進行中 disable,連點只會送出一次。
//   · kind 只能是 REACTION_SET 的七顆(不含 👍),清單由呼叫端從 src/lib/config.mjs 傳進來。
//
// ⚠ M1 已知契約限制(不是 bug,不要「修」它):
//   GET /v1/topics/:id/feed 的回傳只有 reactions 與 reaction_actors,**沒有 mine**
//   (見 api-contract §1 的 Response 形狀),所以頁面載入時前端無從得知「我先前按過哪些」。
//   因此初始渲染一律是未按狀態(aria-pressed="false"),只顯示計數;要等使用者按下去、
//   拿到 POST /v1/reactions 回應的 mine 之後,已按狀態才會正確。
//   M1 刻意不為此新增或修改任何 Worker / API 端點——要補得先改契約 §1。

const FAILURE_MS = 4000;

// aria-label 的字串樣板來自七語系 i18n,模板不寫死任何語言的字。
function formatLabel(template, emoji, count) {
  return String(template).replace('{emoji}', emoji).replace('{count}', String(count));
}

/**
 * 建出一整列 reaction 控制項。
 *
 * @param {object} opts
 * @param {string}   [opts.targetType]  'post'(預設)或 'comment'
 * @param {string}   opts.targetId      pst_… / cmt_…
 * @param {string[]} opts.emojis        REACTION_SET(七顆全渲染,缺席的顯示 0)
 * @param {object}   [opts.counts]      feed 給的 { emoji: 計數 },只列 > 0 的
 * @param {string}   [opts.api]         PUBLIC_API_URL;空字串 → 唯讀計數,不做成可按的樣子
 * @param {{label:string, failed:string}} opts.i18n
 * @param {{btn:string, emoji:string, count:string, status:string,
 *          mine:string, error:string}} opts.classes
 * @returns {{nodes: HTMLElement[]}} 依序插進呼叫端容器即可(最後一個是失敗提示)
 */
export function createReactions(opts) {
  const targetType = opts.targetType || 'post';
  const targetId = opts.targetId;
  const emojis = opts.emojis || [];
  const api = opts.api || '';
  const i18n = opts.i18n || {};
  const cls = opts.classes || {};
  // API 位址沒設就沒有東西可打:維持唯讀計數,不要做成看起來可按的樣子。
  const interactive = !!api && !!targetId;

  const counts = {};
  emojis.forEach((emoji) => {
    const raw = opts.counts && opts.counts[emoji];
    counts[emoji] = typeof raw === 'number' ? raw : 0;
  });
  const mine = new Set(); // feed 不給 mine(見檔頭限制)→ 初始一律空集合
  const pending = new Set();
  const controls = new Map();

  const status = document.createElement('span');
  status.className = cls.status || 'reaction-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  let statusTimer = null;

  function paint(emoji) {
    const node = controls.get(emoji);
    if (!node) return;
    const n = counts[emoji] || 0;
    node.count.textContent = String(n);
    const isMine = mine.has(emoji);
    if (interactive) {
      node.btn.setAttribute('aria-pressed', isMine ? 'true' : 'false');
      node.btn.setAttribute('aria-label', formatLabel(i18n.label, emoji, n));
    }
    node.btn.classList.toggle(cls.mine || 'is-mine', isMine);
  }

  function paintAll() {
    emojis.forEach(paint);
  }

  function snapshot() {
    return { counts: Object.assign({}, counts), mine: Array.from(mine) };
  }

  function restore(snap) {
    emojis.forEach((emoji) => {
      counts[emoji] = snap.counts[emoji] || 0;
    });
    mine.clear();
    snap.mine.forEach((emoji) => mine.add(emoji));
    paintAll();
  }

  // 伺服器回應是唯一真相:整列 emoji 依 reactions 與 mine 重繪。
  function applyServer(data) {
    const fresh = data.reactions || {};
    emojis.forEach((emoji) => {
      const raw = fresh[emoji];
      counts[emoji] = typeof raw === 'number' ? raw : 0;
    });
    mine.clear();
    if (Array.isArray(data.mine)) data.mine.forEach((emoji) => mine.add(emoji));
    paintAll();
  }

  function clearFailure() {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    status.hidden = true;
    status.textContent = '';
    controls.forEach((node) => node.btn.classList.remove(cls.error || 'is-error'));
  }

  function showFailure(btn) {
    if (statusTimer) clearTimeout(statusTimer);
    btn.classList.add(cls.error || 'is-error');
    status.textContent = i18n.failed || '';
    status.hidden = false;
    statusTimer = setTimeout(() => {
      statusTimer = null;
      status.hidden = true;
      status.textContent = '';
      btn.classList.remove(cls.error || 'is-error');
    }, FAILURE_MS);
  }

  function send(emoji, btn) {
    if (pending.has(emoji)) return; // 連點防護:同一顆按鈕的請求還沒回來就不再送
    const before = snapshot();
    const op = mine.has(emoji) ? 'remove' : 'add'; // 切換以 mine 為準
    pending.add(emoji);
    btn.disabled = true;
    clearFailure();

    fetch(api + '/v1/reactions', {
      method: 'POST',
      credentials: 'include', // anon_id 是跨站 cookie,缺這個每次都變成新的匿名者
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        kind: emoji,
        op: op,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then((data) => {
        if (!data || typeof data.reactions !== 'object' || data.reactions === null) {
          throw new Error('bad shape');
        }
        applyServer(data);
      })
      .catch(() => {
        restore(before); // 還原成按之前的狀態,不本地加一、不假裝成功
        showFailure(btn);
      })
      .finally(() => {
        pending.delete(emoji);
        btn.disabled = false;
      });
  }

  const nodes = [];
  emojis.forEach((emoji) => {
    // 可按時是真的 <button>(鍵盤可操作、aria-pressed 反映狀態);唯讀時退成 <span>。
    const btn = document.createElement(interactive ? 'button' : 'span');
    btn.className = cls.btn || 'reaction-btn';
    const face = document.createElement('span');
    face.className = cls.emoji || 'reaction-emoji';
    face.textContent = emoji;
    const count = document.createElement('span');
    count.className = cls.count || 'reaction-count';
    btn.append(face, count);
    if (interactive) {
      btn.type = 'button';
      face.setAttribute('aria-hidden', 'true'); // 文字說明走 aria-label,不讓讀屏唸兩次
      btn.addEventListener('click', () => send(emoji, btn));
    }
    controls.set(emoji, { btn: btn, count: count });
    nodes.push(btn);
  });
  paintAll();
  nodes.push(status);

  return { nodes: nodes };
}
