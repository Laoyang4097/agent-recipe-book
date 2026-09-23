/* 解题配方库 · 网站 v3 逻辑（零依赖原生 JS） */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  /* 同义词 → 真实标签 的提示表（键取自仓库真实 tags 词表，非编造） */
  const TAG_HINTS = {
    "encoding": ["编码", "乱码", "charset", "gbk", "utf8", "mojibake"],
    "anti-bot": ["反爬", "风控", "被封", "403", "拦截", "指纹"],
    "timing": ["超时", "重定向", "tls", "握手", "很慢"],
    "session": ["会话", "cookie", "登录", "302", "跳转"],
    "headless": ["无头", "浏览器", "动态渲染", "javascript"],
    "selector": ["选择器", "表格", "合并单元格", "解析", "结构"],
    "pagination": ["翻页", "分页", "页码", "页数"],
    "rate-limit": ["限流", "频率", "太快", "429", "请求过多"],
    "auth-wall": ["登录墙", "鉴权", "权限", "需要登录"],
    "scrape": ["抓取", "采集", "爬虫", "下载"],
    "shadow-dom": ["影子", "web component", "组件"],
  };

  let RECIPES = [];
  const activeTags = new Set();
  let query = "";
  let lastFocus = null; // 抽屉关闭后把键盘焦点归还给原卡片（a11y）

  async function load() {
    try {
      const res = await fetch("./api/experiences.json", { cache: "no-cache" });
      if (!res.ok) throw new Error("http " + res.status);
      RECIPES = await res.json();
    } catch (e) {
      RECIPES = window.__RECIPES_FALLBACK__ || [];
      console.warn("载入远程数据失败，使用离线兜底：", e.message);
    }
    RECIPES.sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    boot();
  }

  function boot() {
    $("#stat-count").textContent = RECIPES.length;
    renderPreview();
    renderTags();
    render();
    setupReveal();
    setupDrawer();
  }

  /* Hero 真实预览：把 Agent 读库解题过程可视化，不是把配方原文贴出来 */
  function renderPreview() {
    const r = RECIPES.find((x) => x.id === "recipe-py-encoding-mojibake") || RECIPES[0];
    const box = $("#preview-body");
    if (!r) { box.innerHTML = "<p>暂无数据</p>"; return; }
    const dead = (r.dead_ends || []).slice(0, 2).map((d) =>
      `<li><span class="pv-dead-attempt">${esc(d.attempt || "")}</span><span class="pv-dead-fail">${esc(d.failure || "")}</span></li>`
    ).join("");
    const tags = (r.tags || []).slice(0, 2).map((t) => `<span class="pv-tag">${esc(t)}</span>`).join("");
    box.innerHTML = `
      <div class="pv-flow">
        <div class="pv-step">
          <span class="pv-step-num">1</span>
          <div class="pv-bubble pv-user">抓回来是乱码，编码看起来不对</div>
        </div>
        <div class="pv-arrow" aria-hidden="true">↓</div>
        <div class="pv-step">
          <span class="pv-step-num">2</span>
          <div class="pv-bubble pv-agent"><span class="pv-agent-label">Agent</span><code class="pv-query">GET /api/experiences.json?tag=encoding</code></div>
        </div>
        <div class="pv-arrow" aria-hidden="true">↓</div>
        <div class="pv-step">
          <span class="pv-step-num">3</span>
          <div class="pv-result">
            <div class="pv-res-tags">${tags}<span class="pv-res-count">${(r.dead_ends || []).length} 条死胡同</span></div>
            <p class="pv-res-title">${esc(r.title)}</p>
            <p class="pv-res-sol">${esc((r.solution || "").slice(0, 220))}</p>
          </div>
        </div>
      </div>
    `;
  }

  /* 标签胶囊：按配方数降序排（高频优先），超过 TAG_LIMIT 折叠，避免标签变多后挤占首屏 */
  const TAG_LIMIT = 12;
  let tagsExpanded = false;

  function renderTags() {
    const box = $("#tags");
    box.innerHTML = "";
    const freq = new Map();
    RECIPES.forEach((r) => (r.tags || []).forEach((t) => freq.set(t, (freq.get(t) || 0) + 1)));
    const all = [...freq.keys()].sort((a, b) => (freq.get(b) - freq.get(a)) || a.localeCompare(b));
    const shown = tagsExpanded ? all : all.slice(0, TAG_LIMIT);

    shown.forEach((t) => {
      const b = document.createElement("button");
      b.className = "pill" + (activeTags.has(t) ? " active" : "");
      b.textContent = t;
      b.addEventListener("click", () => {
        if (activeTags.has(t)) { activeTags.delete(t); b.classList.remove("active"); }
        else { activeTags.add(t); b.classList.add("active"); }
        render();
      });
      box.appendChild(b);
    });

    if (all.length > TAG_LIMIT) {
      const more = document.createElement("button");
      more.className = "pill pill-more";
      more.setAttribute("aria-expanded", String(tagsExpanded));
      more.textContent = tagsExpanded ? "收起 ▴" : `+${all.length - TAG_LIMIT} 个标签 ▾`;
      more.addEventListener("click", () => { tagsExpanded = !tagsExpanded; renderTags(); });
      box.appendChild(more);
    }
  }

  /* 关键词拆解：中文按 2-gram 切、英文数字按词切。
     解决"用户输入整句中文（如『抓回来是乱码』）整串匹配必然搜不到"的问题。 */
  function tokenize(q) {
    const out = new Set();
    q.split(/[\s,，、。;；:：!！?？/|（）()\[\]"'“”]+/).filter(Boolean).forEach((seg) => {
      out.add(seg);
      if (/[\u4e00-\u9fa5]/.test(seg)) {
        for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
      }
    });
    // 丢弃无意义的单字（除非是英文/数字）
    return [...out].filter((t) => t.length >= 2 || /[a-z0-9]/i.test(t));
  }

  function hayOf(r) {
    return (
      (r.title || "") + " " + (r.problem || "") + " " + (r.tags || []).join(" ") + " " +
      (r.dead_ends || []).map((d) =>
        (d.attempt || "") + " " + (d.failure || "") + " " + (d.early_signal || "")
      ).join(" ") + " " + (r.solution || "")
    ).toLowerCase();
  }

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  /* 摘要片段定位：卡片摘要有 line-clamp 限制（视觉上只能显示约 40-50 字），
     如果命中词落在更后面，高亮会被截掉、用户看不到 —— 那这条结果就显得"莫名其妙"。
     所以当命中词位置太靠后时，把片段起点移过去，让命中词出现在开头附近。 */
  function snippet(text, terms, len) {
    const t = String(text == null ? "" : text);
    if (!terms || !terms.length || t.length <= len) return t;
    let idx = -1;
    terms.forEach((tm) => {
      const i = t.toLowerCase().indexOf(tm);
      if (i >= 0 && (idx === -1 || i < idx)) idx = i;
    });
    if (idx < 0 || idx < 24) return t.slice(0, len); // 已靠前或没命中，正常截断
    const start = Math.max(0, idx - 12);
    return "…" + t.slice(start, start + len);
  }

  /* 命中词高亮：先转义文本，再用占位符替换，避免正则破坏已插入的 <mark> 标签 */
  function highlight(text, terms) {
    const t = String(text == null ? "" : text);
    if (!terms || !terms.length) return esc(t);
    const hits = [...new Set(terms)]
      .filter((x) => x.length >= 2 && t.toLowerCase().includes(x))
      .sort((a, b) => b.length - a.length)
      .slice(0, 3); // 只高亮最长的 3 个命中词，免得满屏黄
    if (!hits.length) return esc(t);
    let out = esc(t);
    const store = [];
    hits.forEach((h) => {
      out = out.replace(new RegExp(escRe(esc(h)), "gi"), (m) => {
        store.push(m);
        return "\u0001" + (store.length - 1) + "\u0001";
      });
    });
    return out.replace(/\u0001(\d+)\u0001/g, (_, i) => '<mark class="hl">' + store[+i] + "</mark>");
  }

  /* 命中数：任一关键词命中即算匹配（OR），结果按命中数降序 —— 宁可多给相关项，不空手 */
  function hitCount(r, terms) {
    const hay = hayOf(r);
    const title = (r.title || "").toLowerCase();
    let n = 0;
    for (const t of terms) {
      if (hay.includes(t)) n++;
      if (title.includes(t)) n += 2; // 标题命中加权，让最相关的排最前
    }
    return n;
  }

  function currentList() {
    let list = RECIPES.filter(
      (r) => !activeTags.size || [...activeTags].every((t) => (r.tags || []).includes(t))
    );
    if (query) {
      const terms = tokenize(query);
      list = terms.length
        ? list
            .map((r) => ({ r, n: hitCount(r, terms) }))
            .filter((x) => x.n > 0)
            .sort((a, b) => b.n - a.n)
            .map((x) => x.r)
        : [];
    }
    return list;
  }

  function render() {
    const grid = $("#grid");
    const list = currentList();
    const terms = query ? tokenize(query) : [];
    const filtering = activeTags.size > 0 || !!query;
    $("#results").textContent = filtering
      ? `匹配 ${list.length} 条 · 共 ${RECIPES.length} 条`
      : `共 ${RECIPES.length} 条`;
    grid.innerHTML = "";
    $("#empty").hidden = list.length > 0;
    updateStatus(list);
    renderSuggest();
    list.forEach((r) => {
      const card = document.createElement("article");
      card.className = "recipe-card";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", "查看配方详情：" + r.title);
      const tags = (r.tags || []).slice(0, 2).map((t) => `<span class="rc-tag">${esc(t)}</span>`).join("");
      const seed = r.seed ? `<span class="rc-seed">SEED</span>` : "";
      card.innerHTML = `
        <div class="rc-top"><div class="rc-tags">${tags}</div>${seed}</div>
        <h3 class="rc-title">${highlight(r.title, terms)}</h3>
        <p class="rc-problem">${highlight(snippet(r.problem, terms, 150), terms)}</p>
        <div class="rc-foot"><span class="rc-deadn">${(r.dead_ends || []).length} 条死胡同</span><span>${esc(r.model || "")}</span></div>
      `;
      card.addEventListener("click", () => openDrawer(r));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(r); }
      });
      grid.appendChild(card);
    });
  }

  /* 搜索/筛选的即时反馈：显示在 Hero 视口内，用户不必下翻才知道筛出来了 */
  function updateStatus(list) {
    const box = $("#search-status");
    if (!box) return;
    const filtering = activeTags.size > 0 || !!query;
    if (!filtering) {
      box.hidden = true; box.innerHTML = "";
      return;
    }
    box.hidden = false;
    if (list.length === 0) {
      box.innerHTML = query
        ? `<span>没有匹配「<b>${esc(query)}</b>」的配方。</span><span class="ss-try">试试：编码 / 反爬 / 分页 / 会话</span>`
        : `<span>这组标签下暂时没有配方。</span><span class="ss-try">去掉一个标签再试</span>`;
    } else {
      const tagNote = activeTags.size ? `（已选 ${activeTags.size} 个标签）` : "";
      box.innerHTML = `<span>筛出 <b>${list.length}</b> 条配方${tagNote}</span><a href="#recipes">跳到配方列表 ↓</a>`;
    }
  }

  /* 明确的"我要看结果"动作 → 平滑滚动到列表，并让落点闪一下
     注意 behavior 显式指定，不依赖 CSS scroll-behavior（否则系统开了
     prefers-reduced-motion 时会退化成"瞬移"，用户会感觉是"闪现"）。 */
  function goToResults() {
    const el = document.getElementById("recipes");
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const head = el.querySelector(".recipes-head");
    // 注意：落点提示始终执行。它是纯颜色脉冲、无任何位移，
    // 不构成 reduced-motion 想规避的"前庭刺激"，反而是位移被降级后的必要补偿。
    if (head) {
      head.classList.remove("flash");
      void head.offsetWidth; // 强制重排，保证动画可重放
      head.classList.add("flash");
      setTimeout(() => head.classList.remove("flash"), 1500);
    }
  }

  /* 搜索建议：把用户的口语词映射到真实标签，一键收窄 */
  function suggestedTags() {
    if (!query) return [];
    const out = [];
    Object.keys(TAG_HINTS).forEach((tag) => {
      if (activeTags.has(tag)) return;
      const hit = TAG_HINTS[tag].some(
        (h) => query.includes(h.toLowerCase()) || h.toLowerCase().includes(query)
      );
      if (hit) out.push(tag);
    });
    return out.slice(0, 4);
  }

  function renderSuggest() {
    const box = $("#suggest");
    if (!box) return;
    const tags = suggestedTags();
    if (!tags.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML =
      '<span class="sg-label">相关标签：</span>' +
      tags.map((t) => `<button class="sg-chip" type="button" data-tag="${esc(t)}">${esc(t)}</button>`).join("");
    box.querySelectorAll(".sg-chip").forEach((b) => {
      b.addEventListener("click", () => {
        const t = b.getAttribute("data-tag");
        activeTags.add(t);
        const pill = [...document.querySelectorAll("#tags .pill")].find((x) => x.textContent === t);
        if (pill) pill.classList.add("active");
        render();
      });
    });
  }

  /* 滚动 reveal：IntersectionObserver 入场 */
  function setupReveal() {
    const els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
  }

  /* 详情抽屉 */
  function setupDrawer() {
    const input = $("#search");
    // 输入防抖 150ms：连打时只在停手后重算一次（人工无感，但省掉大量无效重排）
    let debTimer = null;
    input.addEventListener("input", (e) => {
      const val = e.target.value;
      clearTimeout(debTimer);
      debTimer = setTimeout(() => {
        query = val.trim().toLowerCase();
        render();
      }, 150);
    });
    // 回车 = 明确去找结果：先筛选，再滚动到列表
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); render(); goToResults(); }
    });
    const btn = $("#search-btn");
    // 注意：这里不再 input.focus()——焦点会把视口又拽回搜索框，和滚动到结果冲突
    if (btn) btn.addEventListener("click", () => { render(); goToResults(); });
    const bd = $("#backdrop"), dr = $("#drawer");
    const close = () => {
      dr.classList.remove("open"); dr.setAttribute("aria-hidden", "true"); bd.hidden = true;
      if (lastFocus && typeof lastFocus.focus === "function") lastFocus.focus();
    };
    $("#drawer-close").addEventListener("click", close);
    bd.addEventListener("click", close);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }
  function openDrawer(r) {
    lastFocus = document.activeElement;
    const c = $("#drawer-content");
    const tags = (r.tags || []).map((t) => `<span class="rc-tag">${esc(t)}</span>`).join("");
    const dead = (r.dead_ends || []).map((d) =>
      `<li><span class="de-attempt">试了：${esc(d.attempt || "")}</span>
        <span class="de-fail">结果：${esc(d.failure || "")}</span>
        <span class="de-signal">提前信号：${esc(d.early_signal || "—")} · 耗时：${esc(d.duration || "—")}</span></li>`
    ).join("");
    c.innerHTML = `
      <div class="dr-tags">${tags}${r.seed ? '<span class="rc-seed">SEED</span>' : ""}</div>
      <h2 class="dr-title">${esc(r.title)}</h2>
      <p class="dr-meta">${esc(r.id)} · ${esc(r.model || "n/a")} · ${esc(r.status || "")} · 贡献者 ${esc(r.contributor_id || "anon")}</p>
      <div class="dr-block"><div class="dr-label">问题</div><p>${esc(r.problem || "")}</p></div>
      <div class="dr-block"><div class="dr-label">踩过的死胡同</div><ul class="dr-dead">${dead}</ul></div>
      <div class="dr-block"><div class="dr-label">解法</div><div class="dr-sol">${esc(r.solution || "")}</div></div>
    `;
    $("#drawer").classList.add("open");
    $("#drawer").setAttribute("aria-hidden", "false");
    $("#backdrop").hidden = false;
    const cb = $("#drawer-close");
    if (cb) cb.focus();
  }

  load();
})();
