module.exports = async (params) => {
  const { app, quickAddApi, obsidian } = params;
  const Notice = obsidian ? obsidian.Notice : null;
  const notify = (msg) => { if (Notice) new Notice(msg); };

  const file = app.workspace.getActiveFile();
  if (!file) {
    notify("⚠️ 请先打开一道错题笔记");
    return;
  }

  const cache = app.metadataCache.getFileCache(file);
  const fm = cache && cache.frontmatter;
  if (!fm || fm.type !== "错题") {
    notify("⚠️ 当前笔记不是错题（缺少 type: 错题）");
    return;
  }

  const levels = ["未掌握", "部分掌握", "已掌握"];
  const current = fm.mastery || "未掌握";
  let next;
  try {
    next = await quickAddApi.suggester(
      levels.map((lv) => (lv === current ? lv + "（当前）" : lv)),
      levels
    );
  } catch (e) {
    return;
  }
  if (!next) return;

  const today = new Date();
  const fmtDate = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };
  const intervals = [1, 3, 7, 15, 30];
  const stepUp = (n) => {
    const i = intervals.indexOf(n);
    if (i === -1) return n >= 30 ? 30 : 3;
    return i < intervals.length - 1 ? intervals[i + 1] : 30;
  };

  const prevInt = Number(fm["review-interval"]) || 1;
  let interval;
  if (next === "未掌握") {
    interval = 1;
  } else if (next === "部分掌握") {
    interval = Math.max(3, stepUp(prevInt));
  } else {
    interval = Math.max(7, stepUp(prevInt));
  }
  const nextReview = fmtDate(addDays(today, interval));

  const content = await app.vault.read(file);
  if (!content.startsWith("---")) {
    notify("⚠️ 未找到 frontmatter");
    return;
  }
  const fmEnd = content.indexOf("\n---", 3);
  if (fmEnd === -1) {
    notify("⚠️ 未找到 frontmatter");
    return;
  }

  let fmBlock = content.slice(0, fmEnd + 4);
  if (!/^mastery:.*$/m.test(fmBlock)) {
    notify("⚠️ 缺少 mastery 字段");
    return;
  }

  const setProp = (block, key, value) => {
    const re = new RegExp("^" + key + ":.*$", "m");
    if (re.test(block)) return block.replace(re, key + ": " + value);
    const idx = block.lastIndexOf("\n---");
    return block.slice(0, idx) + "\n" + key + ": " + value + block.slice(idx);
  };

  const countMatch = fmBlock.match(/^review-count:\s*(\d+)/m);
  const newCount = countMatch ? Number(countMatch[1]) + 1 : 1;

  fmBlock = fmBlock.replace(/^mastery:.*$/m, "mastery: " + next);
  fmBlock = setProp(fmBlock, "next-review", nextReview);
  fmBlock = setProp(fmBlock, "review-interval", String(interval));
  fmBlock = setProp(fmBlock, "review-count", String(newCount));

  await app.vault.modify(file, fmBlock + content.slice(fmEnd + 4));
  notify(`✅ 已更新为「${next}」，下次复习 ${nextReview}，复习次数 +1`);
};