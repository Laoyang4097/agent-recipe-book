/* ============================================================
   写侧 MCP 端到端测试（PRD《写侧 MCP v1.0》§6.1）
   ------------------------------------------------------------
   跑法： node tests/write-mcp.test.js
   做法：真 spawn 一个开了写入的 mcp/server.js，走 stdio 说 JSON-RPC，
         按 PRD 的 A-1..A-15 逐条断言。

   为什么不测 Python 层就完事：隔离态「搜不到但看得见」这类口径问题
   只有在 MCP 这一层才暴露（读侧过滤认的是 confidence，写侧落的是 status）。

   BL-016：本测试过去直写真实 recipes/ 与 llms.txt / experiences.json，
   只靠收尾「跟快照比对删掉多余文件」兜底。兜底本身没问题，但它有个前提：
   进程必须活着跑到收尾。中途崩（超时被 kill、断言抛异常、Ctrl-C）就绕过了 finally，
   孤儿文件留在主库里，而下一次跑又会把它当成「开跑前就存在」而放行——
   于是「库未被污染」这条断言会长期假绿。现在改成：开跑前把整本书复制进临时目录，
   把 RECIPE_BOOK_ROOT / RECIPE_BOOK_PATH 指过去，**真仓库在物理上不可能被写**，
   收尾不再承担正确性责任。收尾那条断言也随之升级为「真实仓库逐字节未变」。
   ============================================================ */

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pickPython } from "../lib/pybin.js";

/* 解释器探测与 run-python.js 共用一份（见 pybin.js）：写侧要真 spawn ingest.py，
   挑到没有 pyyaml 的那个，整个测试会以「未安装 pyyaml」伪装成环境缺失而全红。 */
import { check, section, done } from "./_harness.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "mcp", "server.js");
const PY = pickPython();
console.log(`[解释器] ${PY}`);

/* ---------------- 真实仓库（只读参照物） ---------------- */
const REAL_RECIPES = path.join(ROOT, "recipes");
const REAL_EXP = path.join(ROOT, "api", "experiences.json");
const REAL_LLMS = path.join(ROOT, "llms.txt");

const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
/* 整本书指纹：文件名 + 内容一起进哈希。比只看「文件数变没变」结实——
   后者对「改了内容但没增删文件」完全无感。 */
function bookFingerprint(dir) {
  const h = createHash("sha256");
  for (const f of fs.readdirSync(dir).sort()) {
    h.update(f);
    h.update("\0");
    h.update(fs.readFileSync(path.join(dir, f)));
    h.update("\0");
  }
  return h.digest("hex");
}
const realBefore = {
  book: bookFingerprint(REAL_RECIPES),
  exp: sha(REAL_EXP),
  llms: sha(REAL_LLMS),
};

/* ---------------- 临时书：整本书的副本，本测试只碰它 ---------------- */
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-book-write-"));
const RECIPES_DIR = path.join(TMP_ROOT, "recipes");
const EXP_JSON = path.join(TMP_ROOT, "api", "experiences.json");
const LLMS_TXT = path.join(TMP_ROOT, "llms.txt");
fs.mkdirSync(RECIPES_DIR, { recursive: true });
fs.mkdirSync(path.dirname(EXP_JSON), { recursive: true });
for (const f of fs.readdirSync(REAL_RECIPES)) {
  fs.copyFileSync(path.join(REAL_RECIPES, f), path.join(RECIPES_DIR, f));
}
fs.copyFileSync(REAL_EXP, EXP_JSON);
fs.copyFileSync(REAL_LLMS, LLMS_TXT);
console.log(`[临时书] ${TMP_ROOT}`);

function startServer(env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      RECIPE_BOOK_WRITE: "1",
      RECIPE_BOOK_PYTHON: PY,
      // 读侧数据源 + 写侧落盘根，一起指向临时书
      RECIPE_BOOK_ROOT: TMP_ROOT,
      RECIPE_BOOK_PATH: EXP_JSON,
      ...env,
    },
  });
  const state = { child, buf: "", pending: new Map(), nextId: 1, stderr: [] };
  child.stderr.on("data", (d) => state.stderr.push(d.toString()));
  child.stdout.on("data", (d) => {
    state.buf += d.toString();
    let i;
    while ((i = state.buf.indexOf("\n")) >= 0) {
      const line = state.buf.slice(0, i).trim();
      state.buf = state.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const key = msg.id == null ? "__n__" : String(msg.id);
      const w = state.pending.get(key);
      if (w) {
        state.pending.delete(key);
        w.resolve(msg);
      }
    }
  });
  // 写侧要 spawn python，比读侧慢，超时给到 20s
  state.call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = state.nextId++;
      const timer = setTimeout(() => {
        state.pending.delete(String(id));
        reject(new Error(`${method} 超时（20s）`));
      }, 20000);
      state.pending.set(String(id), {
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  state.stop = () => {
    try {
      child.stdin.end();
    } catch {
      /* stdin 已关闭，忽略 */
    }
    setTimeout(() => child.kill(), 150);
  };
  return state;
}

const payloadOf = (res) => {
  try {
    return JSON.parse((res.result.content || [])[0].text);
  } catch {
    return null;
  }
};
const callTool = async (s, name, args) => {
  const res = await s.call("tools/call", { name, arguments: args });
  const body = payloadOf(res);
  // tools/call 也可能返回 protocol 层错误（-32602 等），此时没有 result 字段
  return { res, body, isError: !!(res.result && res.result.isError), err: res.error };
};

const FULL = {
  title: "Git Bash 的 /tmp 与 Windows Python 不是同一个目录",
  tags: ["git-bash", "python"],
  model: "Node 22 / Git Bash",
  problem: "测试脚本往 /tmp 写临时文件，Python 侧读同一路径报 FileNotFoundError。",
  // 注意：这里不能出现真实用户目录，否则会被脱敏规则拦下（那正是它该做的）
  solution: "改用两边 shell 与 Python 都认的临时目录绝对路径，不再走 /tmp 这种单侧翻译的路径。",
  dead_ends: [
    {
      attempt: "先当成路径写法问题",
      failure: "换成反斜杠也一样报找不到",
      duration: "15 分钟",
      early_signal: "Git Bash 里的 /tmp 被翻译成 Windows 自己的临时目录",
    },
  ],
  contributor: "@write-tester",
};

/* ---------------- 跑 ---------------- */
/* 临时书开跑前的配方清单。它不是用来「收尾删干净」的（整个临时目录最后一起删），
   而是用来在收尾时反过来证明「本测试确实往临时书里写了东西」——否则一旦写侧悄悄
   失效，下面「真实仓库未变」那条断言会因为「什么都没写」而轻松假绿。 */
const filesBefore = new Set(fs.readdirSync(RECIPES_DIR));
let s = null;

try {
  s = startServer();
  await s.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });

  section("A-1 / A-4 / A-9  提交完整配方");
  const nBefore = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length;
  const id = "recipe-write-test-tmp";
  const r1 = await callTool(s, "submit_recipe", { ...FULL, id });
  check(
    "A-1 提交成功并返回 id 与下一步人工动作",
    r1.body && r1.body.id === id && /promote_recipe/.test(r1.body.next_human_action || ""),
    JSON.stringify(r1.body).slice(0, 160) + ` || raw=${JSON.stringify(r1.res).slice(0, 300)}`
  );
  check(
    "A-4 成功落盘，recipes/ 增加 1 个文件",
    fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length === nBefore + 1
  );
  check(
    "A-9 贡献者落地为匿名哈希",
    /^anon-/.test((r1.body || {}).contributor_id || ""),
    (r1.body || {}).contributor_id
  );
  // 落在临时书里，进程崩了也不影响真实仓库，无需逐文件记账

  section("A-2 / A-3 / A-4  缺字段与死胡同子字段逐条点名");
  const r2 = await callTool(s, "submit_recipe", {
    title: "",
    tags: ["x"],
    model: "",
    problem: "",
    solution: "",
    dead_ends: [],
  });
  const e2 = ((r2.body && r2.body.errors) || []).map((e) => e.field);
  check(
    "A-2 缺 4 个必填字段时一次报全",
    ["title", "model", "problem", "solution"].every((k) => e2.includes(k)),
    JSON.stringify(e2)
  );
  const r3 = await callTool(s, "submit_recipe", {
    ...FULL,
    id: "recipe-write-test-tmp2",
    dead_ends: [{ attempt: "a", failure: "b", duration: "c", early_signal: "" }],
  });
  const e3 = ((r3.body && r3.body.errors) || []).map((e) => e.field);
  check(
    "A-3 死胡同缺 early_signal 被点名",
    e3.includes("dead_ends[0].early_signal"),
    JSON.stringify(e3)
  );
  check("A-3 拒绝走的是业务失败而非协议错误（-32602）", !r3.err, JSON.stringify(r3.err || {}));
  check(
    "A-4 失败后不落任何文件",
    fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md")).length === nBefore + 1
  );

  section("A-5 / A-6  撞 id 与中文标题");
  // 撞 id 必须拿一个「确定已存在」的 id 来撞，不能靠标题 slug 碰运气：
  // 上次跑测试留下的同名文件会让这条断言假绿，删干净了又假红。
  const collide = path.join(RECIPES_DIR, "recipe-git-pat-push.md");
  const before4 = fs.readFileSync(collide, "utf8");
  const r4 = await callTool(s, "submit_recipe", { ...FULL, id: "recipe-git-pat-push" });
  check(
    "A-5 撞 id 被拒且提示原内容不动",
    (r4.body.errors || []).some((e) => e.field === "id"),
    JSON.stringify(r4.body)
  );
  check(
    "A-5 撞 id 时原稿一字未改",
    fs.readFileSync(collide, "utf8") === before4,
    "原稿内容与撞击前不一致"
  );
  const r5 = await callTool(s, "submit_recipe", { ...FULL, title: "端口被占了", id: "" });
  check(
    "A-6 纯中文标题未给 id 时被拒",
    (r5.body.errors || []).some((e) => e.field === "id"),
    JSON.stringify(r5.body)
  );

  // ===== 红队回归（2026-09-27 实测打穿后固化）=====
  // RT-A1/A2：read_recipe 曾不校验 id 就拼路径 —— "../x" 相对穿越改写仓库外文件，
  // "C:/..." 盘符绝对路径让 os.path.join 丢弃前缀、覆盖任意文件。堵法：id 一律过 ID_RE。
  section("RT-1/RT-2  路径穿越 id 一律格式非法（红队回归）");
  const rt1 = await callTool(s, "promote_recipe", { id: "../escape", confidence: "B" });
  check(
    "RT-1 相对穿越 id 被拒",
    (rt1.body.errors || []).some((e) => e.field === "id" && /格式非法/.test(e.reason)),
    JSON.stringify(rt1.body)
  );
  const rt2 = await callTool(s, "promote_recipe", { id: "C:/temp/victim", confidence: "B" });
  check(
    "RT-2 盘符绝对路径 id 被拒",
    (rt2.body.errors || []).some((e) => e.field === "id" && /格式非法/.test(e.reason)),
    JSON.stringify(rt2.body)
  );
  // RT-B1/B2：脱敏曾漏全角冒号与中文键名 —— "password：xxx" / "密码：xxx" 整条放行入库。
  section("RT-3/RT-4  脱敏识别全角冒号与中文键名（红队回归）");
  const rt3 = await callTool(s, "submit_recipe", {
    ...FULL,
    id: "recipe-write-test-tmp4",
    problem: "配置是 password：abc123456789，然后就好了",
  });
  check(
    "RT-3 全角冒号凭据被拦",
    (rt3.body.errors || []).some((e) => /脱敏|凭据|内网/.test(e.reason)),
    JSON.stringify(rt3.body)
  );
  const rt4 = await callTool(s, "submit_recipe", {
    ...FULL,
    id: "recipe-write-test-tmp5",
    problem: "把 密码：abc123456789 填进表单",
  });
  check(
    "RT-4 中文键名凭据被拦",
    (rt4.body.errors || []).some((e) => /脱敏|凭据|内网/.test(e.reason)),
    JSON.stringify(rt4.body)
  );
  // RT-C1：tags 传字符串曾绕过校验入库，网站渲染层 slice().map() 对字符串抛 TypeError，
  // 一条投稿打挂整站。堵法：validate_submit 显式要求 tags 是数组。
  section("RT-5  tags 必须是数组（红队回归）");
  // 双层防御：MCP 入口层先报 -32602（调用方式错），内核 validate_submit 再兜底业务层。
  // 红队实测时入口层已挡住，内核层是这次补的——两层数据形态不同，断言都要认。
  const rt5 = await callTool(s, "submit_recipe", {
    ...FULL,
    id: "recipe-write-test-tmp6",
    tags: "not-a-list",
  });
  const rt5bad = rt5.err || (rt5.body && rt5.body.errors);
  check(
    "RT-5 tags 字符串被拒（协议层或业务层）",
    !!rt5bad && /数组/.test(JSON.stringify(rt5bad)),
    JSON.stringify(rt5.err || rt5.body)
  );

  section("AC-4.2 / AC-4.3  隔离态：搜不到，但看得见");
  const r6 = await callTool(s, "search_recipes", { query: "Git Bash 的 tmp 目录" });
  const hitIds = ((r6.body || {}).results || []).map((r) => r.id);
  check("A-7 提交后主检索默认搜不到它", !hitIds.includes(id), JSON.stringify(hitIds));
  const r7 = await callTool(s, "list_quarantine", {});
  const qIds = ((r7.body || {}).items || []).map((r) => r.id);
  check("A-8 提交后它出现在隔离清单里", qIds.includes(id), JSON.stringify(qIds.slice(0, 5)));
  const r8 = await callTool(s, "get_recipe", { id });
  check(
    "A-11 隔离稿可取到完整内容（非一行摘要）",
    (r8.body || {}).dead_ends &&
      (r8.body || {}).dead_ends[0] &&
      (r8.body || {}).dead_ends[0].early_signal
  );

  section("A-10  同一贡献者匿名标识稳定");
  const r9 = await callTool(s, "submit_recipe", { ...FULL, id: "recipe-write-test-tmp3" });
  check(
    "A-10 同一 contributor 两次投稿同一匿名标识",
    r9.body && r9.body.contributor_id === r1.body.contributor_id,
    `${r1.body.contributor_id} vs ${(r9.body || {}).contributor_id}`
  );
  // 落在临时书里，进程崩了也不影响真实仓库，无需逐文件记账

  section("A-14 / A-12 / A-13  晋升门槛");
  const r10 = await callTool(s, "promote_recipe", { id, confidence: "A" });
  check(
    "A-14 C→A 跳级被拒（禁跳级）",
    (r10.body.errors || []).some((e) => /跳级/.test(e.reason)),
    JSON.stringify(r10.body)
  );
  const r11 = await callTool(s, "promote_recipe", { id, confidence: "B" });
  check(
    "A-12 死胡同四段齐全可升 B",
    r11.body && r11.body.confidence === "B" && r11.body.status === "published",
    JSON.stringify(r11.body)
  );
  const r12 = await callTool(s, "promote_recipe", { id, confidence: "A" });
  // A 档门槛是 verified is True（不再是「result 或 verified 非空」）。
  // 这条稿子经 MCP 投稿，verified 带不进来（submit 侧已锁，见 ingest_write 的 T2g），
  // 所以要升 A 只能由人复核后手写 verified: true —— 在此之前必被拦。
  check(
    "A-13 未人工置 verified 升 A 被拒并点名 verified",
    (r12.body.errors || []).some((e) => e.field === "verified"),
    JSON.stringify(r12.body)
  );

  /* §5.7 闭环：想让一条存疑稿被正常检索到，正确路径是「晋升」，
     不是绕过隔离区、也不是直接改 status。这条把它完整走一遍。 */
  section("§5.7 闭环：晋升是存疑稿见光的正道");
  const afterPro = await callTool(s, "search_recipes", { query: "Git Bash 的 tmp 目录" });
  const afterEntry = ((afterPro.body || {}).results || []).find((r) => r.id === id) || null;
  check(
    "晋升 B 后主检索搜得到它",
    !!afterEntry,
    JSON.stringify(((afterPro.body || {}).results || []).map((r) => r.id))
  );
  check(
    "它现在 confidence='B' 且不挂 suspect 标记",
    afterEntry && afterEntry.confidence === "B" && afterEntry.suspect !== true,
    JSON.stringify(afterEntry)
  );

  section("A-15  晋升后可进公开目录");
  const r13 = await callTool(s, "promote_recipe", { id: "no-such-id", confidence: "B" });
  check(
    "未知 id 晋升被拒",
    (r13.body.errors || []).some((e) => e.field === "id")
  );

  section("BL-017  降档二次确认（MCP 路径）");
  // 此刻 id 已升至 B（A-12）。B→C 是降档，未确认应先返回 confirm_required 而非直接执行
  const rd1 = await callTool(s, "promote_recipe", { id, confidence: "C" });
  check(
    "BL-017 降档未确认返回 confirm_required 且非协议错误",
    rd1.body && rd1.body.confirm_required === true && !rd1.isError,
    JSON.stringify(rd1.body)
  );
  const rd2 = await callTool(s, "promote_recipe", { id, confidence: "C", confirm_downgrade: true });
  check(
    "BL-017 降档确认后执行（变 C + quarantined）",
    rd2.body && rd2.body.confidence === "C",
    JSON.stringify(rd2.body)
  );

  section("B-4  写工具只在显式开启时出现");
  s.stop();
  await new Promise((r) => setTimeout(r, 250));
  const s2 = startServer({ RECIPE_BOOK_WRITE: "" }); // 模拟未开启
  await s2.call("initialize", { protocolVersion: "2024-11-05", capabilities: {} });
  const list = await s2.call("tools/list", {});
  const names = list.result.tools.map((t) => t.name);
  // 读工具数随功能演进（BL-014 加了 verify_citations，故由 4 变 5）；
  // 这条断言真正守的是「写工具绝不在未开启时出现」，故显式断言两个写工具都不在。
  check(
    "B-4 默认.tools/list 只有 5 个读工具",
    names.length === 5 && !names.includes("submit_recipe") && !names.includes("promote_recipe"),
    JSON.stringify(names)
  );
  check(
    "B-4 默认写入未开启时调写工具报 -32602",
    (await s2.call("tools/call", { name: "submit_recipe", arguments: {} })).error?.code === -32602
  );
  s2.stop();
  await new Promise((r) => setTimeout(r, 250));
} finally {
  /* 不再需要「删掉多余文件 / 还原索引」——本测试从头到尾没写过真实仓库。
     这里只负责收掉子进程，「临时书」的清理放到最后一条断言之后（那条要读它）。 */
  if (s) s.stop();
}

/* ---------------- 收尾：真实仓库必须逐字节未变（BL-016 的核心断言） ---------------- */
section("回归：真实仓库未被测试触碰");
check(
  "真实 recipes/ 内容指纹未变（逐文件哈希，不只看文件数）",
  bookFingerprint(REAL_RECIPES) === realBefore.book,
  `开跑前 ${realBefore.book.slice(0, 12)} / 现在 ${bookFingerprint(REAL_RECIPES).slice(0, 12)}`
);
check("真实 api/experiences.json 未变", sha(REAL_EXP) === realBefore.exp);
check("真实 llms.txt 未变", sha(REAL_LLMS) === realBefore.llms);

/* 反向证据：上面三条只有在「测试确实写了东西」时才有意义。 */
const tmpNow = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith(".md"));
const tmpStrays = tmpNow.filter((f) => !filesBefore.has(f));
check(
  "反向证据：本次写入确实落在临时书里（否则上三条会假绿）",
  tmpStrays.length > 0,
  `临时书新增 ${tmpStrays.length} 个（${tmpStrays.slice(0, 3).join(",")}）`
);

fs.rmSync(TMP_ROOT, { recursive: true, force: true });
check("临时书已清理，不留残余在系统临时目录", !fs.existsSync(TMP_ROOT));

done();
