#!/usr/bin/env node
/*
 * 迁移工具：把「错题本」中已有的考点/错因统一为规范词表
 * 运行方式：在 Vault 根目录执行  node 脚本/迁移统一考点错因.js
 * 可选参数：
 *   --dry-run    只预览改动，不写入任何文件
 *   --no-backup  不创建备份（默认会先把将被修改的文件备份到 脚本/迁移备份/<时间戳>/）
 *
 * 会自动生成/更新 脚本/规范词表.json（与现有词表合并），并把错题笔记里的同义词改写成规范词
 *
 * 同义词映射配置在 脚本/别名映射.json（无需改本文件），例如：
 *   { "knowledge-point": { "无穷小": "无穷小量" } }
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noBackup = args.includes("--no-backup");

const notesDir = path.join(__dirname, "..", "错题本");
const wordPath = path.join(__dirname, "规范词表.json");
const backupRoot = path.join(__dirname, "迁移备份");

/* 同义词映射：别名 -> 规范名，配置在 脚本/别名映射.json */
const aliasPath = path.join(__dirname, "别名映射.json");
let aliasConfig = { "knowledge-point": {}, "error-reason": {} };
if (fs.existsSync(aliasPath)) {
  try {
    const raw = fs.readFileSync(aliasPath, "utf8");
    if (raw.trim()) aliasConfig = Object.assign(aliasConfig, JSON.parse(raw));
  } catch (e) {
    console.warn("⚠️ 别名映射读取失败，将跳过同义词合并：" + e.message);
  }
}
const kpAlias = aliasConfig["knowledge-point"] || {};
const reasonAlias = aliasConfig["error-reason"] || {};

const yamlEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const unescapeYaml = (s) => String(s).replace(/\\(.)/g, "$1");
const uniq = (arr) => Array.from(new Set(arr));

/* 备份：把将被修改的文件复制到 脚本/迁移备份/<时间戳>/<原文件名>.bak */
function backupFile(filePath) {
  if (noBackup || dryRun) return;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dir = path.join(backupRoot, stamp);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(filePath) + ".bak");
  fs.copyFileSync(filePath, dest);
  console.log(`已备份：${path.relative(__dirname, dest)}`);
}

/* 解析列表字段：支持块级列表、行内数组、单值三种写法 */
function parseList(fm, key) {
  // 块级列表：knowledge-point:\n  - "a"\n  - "b"
  const blockRe = new RegExp(`^${key}:\\r?\\n((?:[ \\t]*-[^\\r\\n]*\\r?\\n?)+)`, "m");
  const bm = fm.match(blockRe);
  if (bm) {
    const items = [];
    for (const raw of bm[1].split(/\r?\n/)) {
      const line = raw.trim();
      const mm = line.match(/^-\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(.+?))\s*$/);
      if (!mm) continue;
      const v = unescapeYaml(String(mm[1] ?? mm[2] ?? mm[3] ?? "")).trim();
      if (v) items.push(v);
    }
    return { items, match: bm };
  }
  // 行内数组：knowledge-point: [a, "b"]
  const inlineRe = new RegExp(`^${key}:\\s*\\[([^\\r\\n]*)\\]\\s*$(?:\\r?\\n)?`, "m");
  const im = fm.match(inlineRe);
  if (im) {
    const items = [];
    for (const part of im[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const qm = t.match(/^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$|^(.+)$/);
      const v = unescapeYaml(String(qm ? (qm[1] ?? qm[2] ?? qm[3] ?? "") : "")).trim();
      if (v) items.push(v);
    }
    return { items, match: im };
  }
  // 单值：knowledge-point: 函数
  const scalarRe = new RegExp(`^${key}:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)'|([^\\r\\n]+?))\\s*$(?:\\r?\\n)?`, "m");
  const sm = fm.match(scalarRe);
  if (sm) {
    const v = unescapeYaml(String(sm[1] ?? sm[2] ?? sm[3] ?? "")).trim();
    return { items: v ? [v] : [], match: sm };
  }
  return null;
}

/* 把列表字段改写为规范写法（统一输出块级列表） */
function replaceListBlock(fm, key, values, eol) {
  const parsed = parseList(fm, key);
  if (!parsed) return fm;
  const block = key + ":" + eol + values.map((v) => `  - "${yamlEscape(v)}"`).join(eol) + eol;
  return fm.slice(0, parsed.match.index) + block + fm.slice(parsed.match.index + parsed.match[0].length);
}

const sortZh = (arr) => uniq(arr).sort((a, b) => a.localeCompare(b, "zh-CN"));

if (!fs.existsSync(notesDir)) {
  console.error(`未找到错题本目录：${notesDir}，请确认在 Vault 根目录运行。`);
  process.exit(1);
}

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
  let kp = parseList(fm, "knowledge-point");
  let rs = parseList(fm, "error-reason");
  if (!kp && !rs) {
    skipped.push(`${file}: 无考点/错因字段，跳过`);
    continue;
  }

  const before = {
    kp: kp ? [...kp.items] : [],
    rs: rs ? [...rs.items] : []
  };
  const map = (list, alias) => (list || []).map((v) => alias[v] || v);
  let kpAfter = kp ? uniq(map(kp.items, kpAlias)) : null;
  let rsAfter = rs ? uniq(map(rs.items, reasonAlias)) : null;
  const after = {
    kp: kpAfter || [],
    rs: rsAfter || []
  };

  (after.kp || []).forEach((v) => allKp.add(v));
  (after.rs || []).forEach((v) => allReason.add(v));

  if (JSON.stringify(before) !== JSON.stringify(after)) {
    if (kpAfter !== null) fm = replaceListBlock(fm, "knowledge-point", kpAfter, eol);
    if (rsAfter !== null) fm = replaceListBlock(fm, "error-reason", rsAfter, eol);
    const newContent =
      content.slice(0, fmMatch.index) +
      "---" + eol + fm + eol + "---" +
      content.slice(fmMatch.index + fmMatch[0].length);
    if (!dryRun) {
      backupFile(fp);
      fs.writeFileSync(fp, newContent, "utf8");
    }
    changed.push({ file, before, after });
  }
}

// 与现有词表合并，而不是整体覆盖
let existingWords = { "knowledge-point": [], "error-reason": [] };
if (fs.existsSync(wordPath)) {
  try {
    const raw = fs.readFileSync(wordPath, "utf8");
    if (raw.trim()) existingWords = Object.assign(existingWords, JSON.parse(raw));
  } catch (e) {
    console.warn("⚠️ 现有规范词表读取失败，将基于笔记重建：" + e.message);
  }
}
const wordData = {
  // 合并现有词表 + 笔记词；被别名映射合并掉的旧词从词表剔除，防止再次被选用
  "knowledge-point": sortZh([...(existingWords["knowledge-point"] || []), ...allKp]).filter((w) => !(kpAlias[w])),
  "error-reason": sortZh([...(existingWords["error-reason"] || []), ...allReason]).filter((w) => !(reasonAlias[w]))
};
const newWordJson = JSON.stringify(wordData, null, 2) + "\n";
if (!dryRun) {
  const oldWordJson = fs.existsSync(wordPath) ? fs.readFileSync(wordPath, "utf8") : "";
  if (oldWordJson !== newWordJson) {
    backupFile(wordPath);
    fs.writeFileSync(wordPath, newWordJson, "utf8");
  }
}

console.log("=== 迁移结果" + (dryRun ? "（dry-run 预览，未写入任何文件）" : "") + " ===");
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
console.log(`\n${dryRun ? "dry-run：未写入" : "已写入"} ${wordPath}`);
