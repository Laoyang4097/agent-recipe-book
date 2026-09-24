/* ============================================================
   解题配方库 · 引用校验（PRD 增量 v1.2 §8.3 防编造护栏）
   ------------------------------------------------------------
   纯函数，零依赖。任何 Agent 在引用检索结果组织答案后，都应先过这一道：
   抽取回答里所有 [recipe-xxx] 形式的引用，必须全部落在「本次检索结果 id 集合」内。

   规则：
     - 命中形式：以 recipe 开头、后接小写字母/数字/连字符，如 [recipe-py-encoding-mojibake]
     - 凡出现集合外的 id → 判定为编造（应由调用方重试或直接降级到原文）
   ============================================================ */

// 配方 id 全为小写（schema 约定），故区分大小写：避免把 [Recipe-…] / [Research-…] 误当引用
const CITATION_RE = /\[(recipe[a-z0-9-]+)\]/g;

/**
 * 校验回答中的配方引用是否全部来自允许的 id 集合。
 * @param {string} answer    Agent 的回答文本
 * @param {string[]} allowedIds  本次检索返回的配方 id 集合（即「可引用白名单」）
 * @returns {{ ok: boolean, cited: string[], badIds: string[] }}
 *   ok      —— true 表示所有引用都合法；false 表示出现越界（编造）引用
 *   cited   —— 回答中实际出现的所有配方引用（去重，按出现顺序）
 *   badIds  —— 落在白名单之外的引用（即疑似编造）
 */
export function verifyCitations(answer, allowedIds) {
  const allowed = new Set(Array.isArray(allowedIds) ? allowedIds : []);
  const cited = [];
  const badIds = [];

  if (typeof answer !== "string" || !answer) {
    return { ok: true, cited, badIds };
  }

  const matches = answer.matchAll(CITATION_RE);
  for (const m of matches) {
    const id = m[1];
    if (!cited.includes(id)) cited.push(id);
    if (!allowed.has(id) && !badIds.includes(id)) badIds.push(id);
  }

  return { ok: badIds.length === 0, cited, badIds };
}

export default verifyCitations;
