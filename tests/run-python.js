/* ============================================================
   用挑好的解释器跑一个 Python 测试文件
   ------------------------------------------------------------
   用法： node tests/run-python.js tests/ingest_write.test.py
   ------------------------------------------------------------
   为什么不让 package.json 直接写 `python xxx`：见 pybin.js 的说明。
   这里只是把「挑解释器」和「跑」两件事拆开，好让 JS 侧与 Python 侧共用同一套判断。
   退出码原样透传，npm test 的 && 串联才生效。
   ============================================================ */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPython } from "../lib/pybin.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target) {
  console.error("用法：node tests/run-python.js tests/xxx.test.py");
  process.exit(2);
}

const py = pickPython(true);
console.log(`[解释器] ${py}`);
const r = spawnSync(py, [path.join(root, target)], {
  stdio: "inherit",
  env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
});
process.exit(r.status === null ? 1 : r.status);
