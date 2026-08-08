#!/usr/bin/env node
/*
 * 迁移工具：把「错题本」中已有的考点/错因统一为规范词表
 * 运行方式：在 Vault 根目录执行  node 脚本/迁移统一考点错因.js
 * 会自动生成/更新 脚本/规范词表.json，并把错题笔记里的同义词改写成规范词
 *
 * 使用前请在下方别名映射里配置你的同义词，例如：
 *   reasonAlias = { "无穷小": "无穷小量" }
 */
const fs = require("fs");
const path = require("path");

const notesDir = path.join(__dirname, "..", "错题本");
const wordPath = path.join(__dirname, "规范词表.json");

/* 同义词映射：别名 -> 规范名（无同义词的可以不写） */
const kpAlias = {
};

const reasonAlias = {
};

const yamlEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const uniq = (arr) => Array.from(new Set(arr));

function extractListItems(fm, key) {
  const re = new RegExp(`^${key}:\\r?\\n((?:[ \\t]*-[^\\r\\n]*\\r?\\n?)+)`, "m");
  const m = fm.match(re);
  if (!m) return null;
  const items = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    const mm = line.match(/^-\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(.+?))\s*$/);
    if (!mm) continue;
    const v = String(mm[1] ?? mm[2] ?? mm[3] ?? "").trim();
    if (v) items.push(v);
  }
  return items;
}

function replaceListBlock(fm, key, values, eol) {
  const re = new RegExp(`^${key}:\\r?\\n((?:[ \\t]*-[^\\r\\n]*\\r?\\n?)+)`, "m");
  const m = fm.match(re);
  if (!m) return fm;
  const block = key + ":" + eol + values.map((v) => `  - "${yamlEscape(v)}"`).join(eol) + eol;
  return fm.slice(0, m.index) + block + fm.slice(m.index + m[0].length);
}

const sortZh = (arr) => uniq(arr).sort((a, b) => a.localeCompare(b, "zh-CN"));

const files = fs.readdirSync(notesDir).filter((f) => f.toLowerCase().endsWith(".md"));
const allKp = new Set();
const allReason = new Set();
const changed = [];
const skipped = [];

for (const file of files) {
  const fp = path.join(notesDir, file);
  let content = fs.readFileSync(fp, "utf8");
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    skipped.push(`${file}: 无 frontmatter，跳过`);
    continue;
  }

  let fm = fmMatch[1];
  let kp = extractListItems(fm, "knowledge-point");
  let rs = extractListItems(fm, "error-reason");
  if (kp === null && rs === null) {
    skipped.push(`${file}: 无考点/错因字段，跳过`);
    continue;
  }

  const before = {
    kp: kp ? [...kp] : [],
    rs: rs ? [...rs] : []
  };
  const map = (list, alias) => (list || []).map((v) => alias[v] || v);
  kp = kp === null ? null : uniq(map(kp, kpAlias));
  rs = rs === null ? null : uniq(map(rs, reasonAlias));
  const after = {
    kp: kp || [],
    rs: rs || []
  };

  (after.kp || []).forEach((v) => allKp.add(v));
  (after.rs || []).forEach((v) => allReason.add(v));

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    if (kp !== null) fm = replaceListBlock(fm, "knowledge-point", kp, eol);
    if (rs !== null) fm = replaceListBlock(fm, "error-reason", rs, eol);
    content =
      content.slice(0, fmMatch.index) +
      "---" + eol + fm + eol + "---" +
      content.slice(fmMatch.index + fmMatch[0].length);
    fs.writeFileSync(fp, content, "utf8");
    changed.push({ file, before, after });
  }
}

const wordData = {
  "knowledge-point": sortZh(Array.from(allKp)),
  "error-reason": sortZh(Array.from(allReason))
};
fs.writeFileSync(wordPath, JSON.stringify(wordData, null, 2) + "\n", "utf8");

console.log("=== 迁移结果 ===");
console.log(`处理文件：${files.length} 个`);
console.log(`有改动的笔记：${changed.length} 个`);
for (const c of changed) {
  console.log(`\n${c.file}`);
  if (JSON.stringify(c.before.kp) !== JSON.stringify(c.after.kp)) {
    console.log(`  考点: ${c.before.kp.join("、")}  =>  ${c.after.kp.join("、")}`);
  }
  if (JSON.stringify(c.before.rs) !== JSON.stringify(c.after.rs)) {
    console.log(`  错因: ${c.before.rs.join("、")}  =>  ${c.after.rs.join("、")}`);
  }
}
for (const s of skipped) console.log(`跳过：${s}`);

console.log("\n=== 生成的规范词表 ===");
console.log("考点 (" + wordData["knowledge-point"].length + " 个)：");
console.log(wordData["knowledge-point"].join("、"));
console.log("错因 (" + wordData["error-reason"].length + " 个)：");
console.log(wordData["error-reason"].join("、"));
console.log(`\n已写入 ${wordPath}`);
