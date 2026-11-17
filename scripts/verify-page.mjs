// 页面验收：CDP 连到已启动的 Edge（127.0.0.1:9222），对本地构建产物做客观检查。
// 用法：先 `npm run build` 并 `npx vite preview --port 4173`，再 `node scripts/verify-page.mjs`
// 只输出断言结果，不做观感评价。

const CDP = 'http://127.0.0.1:9222';
const TARGET = process.env.TARGET_URL ?? 'http://localhost:4173/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 新开一个前台标签：后台标签里 rAF 与 CSS 动画不跑，会让 canvas/淡入断言假失败
const opened = await fetch(`${CDP}/json/new?${encodeURIComponent(TARGET)}`, { method: 'PUT' }).then((r) => r.json());
const ws = new WebSocket(opened.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(m.error.message)) : res(m.result);
  }
};

const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: TARGET });
await sleep(2500);
// 后台标签下 rAF 与 CSS 动画不跑，必须把页面切到前台
await send('Page.bringToFront').catch(() => {});
await sleep(600);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
};

// ── 结构：不该存在的旧模块 ──
const legacy = await evaluate(`(() => {
  const sels = ['.work-grid', '.work-card', '.announce-card', '.theme-toggle', '.scroll-progress', '.ripple-layer', '.hero-type', '.type-text', '.platform-link', '.contact-card'];
  return sels.filter(s => document.querySelector(s));
})()`);
check('旧模块已移除', legacy.length === 0, legacy.join(',') || 'none');

// ── 名称字符画 ──
const nameArt = await evaluate(`(() => {
  const spans = [...document.querySelectorAll('.name-art-lines span')];
  const host = document.querySelector('.name-art');
  return {
    lines: spans.length,
    text: spans.map(s => s.textContent.trim()).join('\\n'),
    opacity: spans.map(s => getComputedStyle(s).opacity),
    clip: spans.some(s => s.scrollWidth > Math.ceil(host.getBoundingClientRect().width) + 1),
  };
})()`);
check('NAIMIO 字符画 6 行', nameArt.lines === 6, `lines=${nameArt.lines}`);
check('字符画含块元素字形', /█|╗|╔/.test(nameArt.text));
check('字符画已淡入', nameArt.opacity.every((o) => Number(o) > 0.9), nameArt.opacity.join(','));
check('字符画未被裁切', nameArt.clip === false);

// ── 字符画字体：制表符与空格必须等宽，否则手机回退字体会让整块错位 ──
const metrics = await evaluate(`(async () => {
  await document.fonts.ready;
  const host = document.querySelector('.name-art');
  const spans = [...document.querySelectorAll('.name-art-lines span')];
  const widths = spans.map(s => Math.round(s.getBoundingClientRect().width));
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '100px ' + getComputedStyle(host).fontFamily;
  const per = ['\\u2588', '\\u2550', '\\u2551', '\\u2554', ' '].map(c => Math.round(probe.measureText(c).width * 10) / 10);
  const docW = document.documentElement.clientWidth;
  return {
    widths,
    equalLines: new Set(widths).size === 1,
    per,
    equalGlyphs: new Set(per).size === 1,
    family: getComputedStyle(host).fontFamily,
    fontSize: getComputedStyle(host).fontSize,
    withinViewport: Math.max(...widths) <= docW,
    fontLoaded: [...document.fonts].some(f => f.family.includes('Name Art Mono') && f.status === 'loaded'),
  };
})()`);
check('字符画字体已加载', metrics.fontLoaded, metrics.family);
check('制表符与空格等宽', metrics.equalGlyphs, metrics.per.join(','));
check('各行等宽', metrics.equalLines, metrics.widths.join(','));
check('字符画在视口内', metrics.withinViewport, `w=${Math.max(...metrics.widths)}`);

// ── ASCII 头像 canvas 真的有内容 ──
const canvas = await evaluate(`(() => {
  const c = document.querySelector('.ascii-canvas');
  if (!c) return { missing: true };
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let painted = 0;
  const colors = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 0) {
      painted++;
      colors.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2]);
    }
  }
  return { w: c.width, h: c.height, cssW: c.style.width, painted, ratio: painted / (c.width * c.height), colors: colors.size };
})()`);
check('头像 canvas 存在', !canvas.missing);
check('头像已绘制字符', (canvas.painted ?? 0) > 2000, `painted=${canvas.painted}`);
check('头像有明暗层次', (canvas.colors ?? 0) > 20, `colors=${canvas.colors}`);

// ── 逐帧变化：隔 300ms 取两次指纹应不同 ──
const fingerprint = `(() => {
  const c = document.querySelector('.ascii-canvas');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let h = 0;
  for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0;
  return h;
})()`;
const f1 = await evaluate(fingerprint);
await sleep(320);
const f2 = await evaluate(fingerprint);
check('头像是动态的', f1 !== f2, `${f1} vs ${f2}`);

// ── 链接齐全 ──
const links = await evaluate(`[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'))`);
const expected = [
  'https://x.com/fm_dtm',
  'https://space.bilibili.com/402800891',
  'mailto:naimiodtm@gmail.com',
  'https://music.163.com/artist?id=34556089',
  'https://youtube.com/@fm_dtm',
  'https://www.soundcloud.com/6Fb9F12o9fJ1226iuT',
];
for (const href of expected) check(`链接存在 ${href}`, links.includes(href));

// ── 版权 ──
const footer = await evaluate(`document.querySelector('.footer')?.textContent.trim() ?? ''`);
check('页脚版权声明', /©\s*2026/.test(footer) && footer.includes('Naimio'), footer);

// ── 无副标题式多余文案：正文只应有链接与页脚（.sr-only 无障碍文本不计） ──
const paragraphs = await evaluate(`[...document.querySelectorAll('.wrap p:not(.sr-only)')].map(p => p.textContent.trim()).filter(Boolean)`);
check('无多余段落文案', paragraphs.length === 0, JSON.stringify(paragraphs));

// ── 多宽度无横向溢出 ──
for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 700 });
  await sleep(400);
  const overflow = await evaluate(`(() => {
    const docW = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll('body *')]
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > docW + 1 || r.left < -1); })
      .map(el => el.className || el.tagName);
    return { bad, scrollW: document.documentElement.scrollWidth, docW };
  })()`);
  check(`${width}px 无横向溢出`, overflow.bad.length === 0 && overflow.scrollW <= overflow.docW + 1, JSON.stringify(overflow.bad));
}

await send('Emulation.clearDeviceMetricsOverride');

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
ws.close();
process.exit(failed.length === 0 ? 0 : 1);
