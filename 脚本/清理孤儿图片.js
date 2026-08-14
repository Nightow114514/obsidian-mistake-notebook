#!/usr/bin/env node
/*
 * 孤儿图片清理工具：找出「错题原图」里没有被任何错题笔记引用的图片
 * 运行方式：在 Vault 根目录执行  node 脚本/清理孤儿图片.js
 * 可选参数：
 *   --move   把孤儿图片移入 脚本/图片回收站/<时间戳>/（默认只预览，不动任何文件）
 *
 * 回收站里的图片确认无误后，手动删除对应文件夹即可。
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const doMove = args.includes("--move");

const notesDir = path.join(__dirname, "..", "错题本");
const imgDir = path.join(__dirname, "..", "错题原图");
const trashRoot = path.join(__dirname, "图片回收站");

const IMG_RE = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

/* 收集错题笔记里引用的图片路径（wikilink 嵌入 + markdown 链接两种写法） */
function collectReferences() {
  const refs = new Set();
  const add = (raw) => {
    if (!raw) return;
    let s = raw.trim().split("|")[0].trim(); // 去掉 ![[x.png|300]] 里的尺寸后缀
    if (!s) return;
    try { s = decodeURIComponent(s); } catch (_) {}
    refs.add(s);
    const base = s.includes("/") ? s.slice(s.lastIndexOf("/") + 1) : s;
    refs.add(base);
  };
  if (!fs.existsSync(notesDir)) return refs;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      if (!f.toLowerCase().endsWith(".md")) continue;
      const text = fs.readFileSync(fp, "utf8");
      for (const m of text.matchAll(/!\[\[([^\]\n]+)\]\]/g)) add(m[1]);
      for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) add(m[1]);
    }
  };
  walk(notesDir);
  return refs;
}

/* 扫描「错题原图」里的所有图片文件（递归） */
function collectImages() {
  const out = [];
  if (!fs.existsSync(imgDir)) return out;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) { walk(fp); continue; }
      if (!IMG_RE.test(f)) continue;
      out.push(fp);
    }
  };
  walk(imgDir);
  return out;
}

const refs = collectReferences();
const images = collectImages();
const vaultRoot = path.join(__dirname, "..");
const orphans = [];
let totalSize = 0;
for (const fp of images) {
  const rel = path.relative(vaultRoot, fp).split(path.sep).join("/");
  const base = path.posix.basename(fp);
  if (!refs.has(rel) && !refs.has(base)) {
    const size = fs.statSync(fp).size;
    totalSize += size;
    orphans.push({ fp, rel, size });
  }
}

const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : b >= 1024 ? (b / 1024).toFixed(1) + " KB" : b + " B";

console.log(`扫描图片：${images.length} 个（被引用 ${images.length - orphans.length} · 孤儿 ${orphans.length}）`);
if (orphans.length === 0) {
  console.log("🎉 没有孤儿图片。");
  process.exit(0);
}

for (const o of orphans) console.log(`  - ${o.rel}（${fmtSize(o.size)}）`);
console.log(`合计可释放：${fmtSize(totalSize)}`);

if (doMove) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const dir = path.join(trashRoot, stamp);
  fs.mkdirSync(dir, { recursive: true });
  for (const o of orphans) {
    const dest = path.join(dir, o.rel.split("/").join("__"));
    fs.renameSync(o.fp, dest);
  }
  console.log(`\n已移入回收站：${path.relative(__dirname, dir)}（确认无误后可手动删除该文件夹）`);
} else {
  console.log("\n提示：这是预览（dry-run），没有动任何文件。确认后加 --move 参数把孤儿图片移入 脚本/图片回收站/<时间戳>/。");
}
