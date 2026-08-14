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
  const pad2 = (x) => String(x).padStart(2, "0");
  const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const addDays = (d, n) => {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  };

  // 掌握度递进规则：与 试卷/随机组卷.md 的组卷脚本保持一致
  // 未掌握 1 天；部分掌握 3/7/15/30 递进；已掌握 7/15/30 递进；
  // 连续「已掌握」第 2 次 60 天、第 3 次起 90 天
  const intervals = [1, 3, 7, 15, 30];
  const stepUp = (n) => {
    const i = intervals.indexOf(n);
    if (i === -1) return n >= 30 ? 30 : 3;
    return i < intervals.length - 1 ? intervals[i + 1] : 30;
  };

  const prevInt = Number(fm["review-interval"]) || 1;
  const prevStreak = Number(fm["mastery-streak"]) || 0;
  let interval;
  let streak = 0;
  if (next === "未掌握") {
    interval = 1;
  } else if (next === "部分掌握") {
    interval = Math.max(3, stepUp(prevInt));
  } else {
    streak = (current === "已掌握" ? prevStreak : 0) + 1;
    interval = Math.max(7, stepUp(prevInt));
    if (streak >= 3) interval = 90;
    else if (streak >= 2) interval = 60;
  }
  const nextReview = fmtDate(addDays(today, interval));
  const todayStr = fmtDate(today);

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

  // 往 frontmatter 追加一条 review-log（兼容块级列表 / 空行内数组 / 行内数组三种写法）
  const appendLog = (block, entry) => {
    if (/^review-log:(\s*\[\])?\s*$/m.test(block)) {
      return block.replace(/^review-log:(\s*\[\])?\s*$/m, 'review-log:\n  - "' + entry + '"');
    }
    if (/^review-log:\s*\[[^\r\n]*\]\s*$/m.test(block)) {
      return block.replace(/^review-log:\s*\[([^\r\n]*)\]\s*$/m, (m0, inner) => {
        const sep = inner.trim() ? ", " : "";
        return 'review-log: [' + inner.trimEnd() + sep + '"' + entry + '"]';
      });
    }
    const idx = block.lastIndexOf("\n---");
    return block.slice(0, idx) + '\nreview-log:\n  - "' + entry + '"' + block.slice(idx);
  };

  const countMatch = fmBlock.match(/^review-count:\s*(\d+)/m);
  const newCount = countMatch ? Number(countMatch[1]) + 1 : 1;

  const logEntry = `${todayStr} ${current}→${next}（间隔${interval}天）`;

  fmBlock = fmBlock.replace(/^mastery:.*$/m, "mastery: " + next);
  fmBlock = setProp(fmBlock, "next-review", nextReview);
  fmBlock = setProp(fmBlock, "review-interval", String(interval));
  fmBlock = setProp(fmBlock, "review-count", String(newCount));
  fmBlock = setProp(fmBlock, "mastery-streak", String(streak));
  fmBlock = appendLog(fmBlock, logEntry);

  await app.vault.modify(file, fmBlock + content.slice(fmEnd + 4));
  notify(`✅ 已更新为「${next}」，下次复习 ${nextReview}（间隔 ${interval} 天），复习次数 +1`);
};
