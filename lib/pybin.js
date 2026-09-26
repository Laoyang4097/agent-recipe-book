/* ============================================================
   挑一个「能用」的 Python 解释器
   ------------------------------------------------------------
   本机（Git Bash / Windows）最常踩的坑：PATH 上的 `python` 是不带 pyyaml 的
   managed 解释器，而带 pyyaml 的是另一个 venv。测试若随便抓一个，
   报错会变成「未安装 pyyaml」，看着像缺依赖，其实是选错了解释器。

   所以这里不按名字猜，按「能 import yaml」筛。
   外部可用 RECIPE_BOOK_PYTHON 强制指定（仍然会先验一遍）。
   ============================================================ */

import { spawnSync } from "node:child_process";
import path from "node:path";

export function pyCandidates() {
  const explicit = process.env.RECIPE_BOOK_PYTHON || process.env.PYTHON;
  const list = [explicit, "python", "python3"];
  if (process.platform === "win32") {
    const bases = [];
    if (process.env.USERPROFILE) bases.push(path.join(process.env.USERPROFILE, ".workbuddy/binaries/python"));
    bases.push("C:/Users/ZhuanZ1/.workbuddy/binaries/python");
    for (const base of bases) {
      list.push(path.join(base, "envs/default/Scripts/python.exe"));
      list.push(path.join(base, "Scripts/python.exe"));
    }
  }
  return list.filter(Boolean);
}

export function pickPython(needYaml = true) {
  const probe = needYaml ? "import yaml" : "import sys";
  for (const c of pyCandidates()) {
    try {
      const r = spawnSync(c, ["-c", probe], { stdio: "ignore", timeout: 15000 });
      if (r.status === 0) return c;
    } catch {}
  }
  return process.env.RECIPE_BOOK_PYTHON || process.env.PYTHON || "python";
}
