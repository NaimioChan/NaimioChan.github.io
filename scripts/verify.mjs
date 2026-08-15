// CDP 验证（v2）：后台标签环境下 IO 不触发，reveal 用手动加类验证 CSS 路径
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CDP = 'http://127.0.0.1:9222';
const TARGET = 'http://localhost:4173/';
const shotDir = resolve(process.argv.includes('--shot-dir')
  ? process.argv[process.argv.indexOf('--shot-dir') + 1]
  : process.cwd());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 10_000, 'ws open');

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
  withTimeout(new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  }), 12_000, method);
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(shotDir, file), Buffer.from(r.data, 'base64'));
  console.log(`  saved ${file}`);
};
const step = (l) => console.log(`• ${l}`);

try {
  step('navigate');
  await send('Page.navigate', { url: TARGET });
  await sleep(3500);
  await evalJs("document.documentElement.style.scrollBehavior='auto'");

  const checks = {};
  checks.title = await evalJs('document.title');
  checks.theme = await evalJs('document.documentElement.dataset.theme');
  checks.bubbles = await evalJs("document.querySelectorAll('.bubble').length");
  checks.typeStart = await evalJs("document.querySelector('.type-text').textContent");
  await sleep(2200);
  checks.typeLater = await evalJs("document.querySelector('.type-text').textContent");
  checks.typeChanged = checks.typeStart !== checks.typeLater;

  step('theme switch');
  await evalJs("document.querySelector('.theme-toggle').click()");
  await sleep(1100);
  checks.darkApplied = (await evalJs('document.documentElement.dataset.theme')) === 'dark';
  checks.saved = await evalJs("localStorage.getItem('aqua-theme')");
  // 变量值不受 transition 冻结影响；背景色走变量
  checks.darkBgVar = await evalJs(
    "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()",
  );
  // 截图前禁掉 transition，确保画面是最终状态
  await evalJs("(() => { const s = document.createElement('style'); s.id = 'no-trans'; s.textContent = '* { transition: none !important; animation-duration: 0.01ms !important; }'; document.head.appendChild(s); })()");
  await sleep(400);
  await shot('preview-aqua-dark.png');
  await evalJs("document.getElementById('no-trans').remove()");
  await evalJs("document.querySelector('.theme-toggle').click()");
  await sleep(1100);
  checks.backToLight = (await evalJs('document.documentElement.dataset.theme')) === 'light';

  step('reveal CSS path (IO throttled in bg tab; add .in manually)');
  // 后台标签 CSS transition 冻结：注入直通再验证目标值
  await evalJs("(() => { const s = document.createElement('style'); s.id = 'no-trans3'; s.textContent = '* { transition: none !important; }'; document.head.appendChild(s); })()");
  checks.revealTotal = await evalJs("document.querySelectorAll('.reveal').length");
  checks.revealHiddenOpacity = await evalJs(
    "getComputedStyle(document.querySelector('.announce-card')).opacity",
  );
  await evalJs("document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'))");
  await sleep(300);
  checks.revealShownOpacity = await evalJs(
    "getComputedStyle(document.querySelector('.announce-card')).opacity",
  );
  checks.revealShownTransform = await evalJs(
    "getComputedStyle(document.querySelector('.announce-card')).transform",
  );
  await evalJs("document.getElementById('no-trans3').remove()");

  step('scroll-driven animations registered');
  checks.scrollDrivenCount = await evalJs(
    "document.getAnimations().filter(a => a.timeline && a.timeline.constructor.name !== 'DocumentTimeline').length",
  );

  step('scroll + progress bar (bg tab suppresses scroll events; dispatch manually)');
  await evalJs("window.requestAnimationFrame = (cb) => { cb(Date.now()); return 0; }");
  await evalJs('window.scrollTo(0, 2000)');
  await evalJs("window.dispatchEvent(new Event('scroll'))");
  await sleep(400);
  checks.scrollY = await evalJs('window.scrollY');
  checks.progressWidth = await evalJs("document.querySelector('.scroll-progress').style.width");
  checks.maxScroll = await evalJs(
    'document.documentElement.scrollHeight - window.innerHeight',
  );

  step('tilt simulation');
  await evalJs('window.scrollTo(0, 1000)');
  await sleep(600);
  await evalJs(
    "(() => { const c = document.querySelector('.work-card'); const r = c.getBoundingClientRect(); c.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + r.width * 0.85, clientY: r.top + r.height * 0.15, bubbles: true })); })()",
  );
  checks.tiltTransform = await evalJs("document.querySelector('.work-card').style.transform");
  await evalJs(
    "document.querySelector('.work-card').dispatchEvent(new PointerEvent('pointerleave'))",
  );
  checks.tiltCleared = await evalJs("document.querySelector('.work-card').style.transform");

  step('screenshots');
  await evalJs("(() => { const s = document.createElement('style'); s.id = 'no-trans2'; s.textContent = '* { transition: none !important; }'; document.head.appendChild(s); })()");
  await sleep(300);
  await shot('preview-aqua-works.png');
  await evalJs('window.scrollTo(0, 0)');
  await sleep(500);
  await shot('preview-aqua-hero.png');
  await evalJs("document.getElementById('no-trans2').remove()");

  console.log('\n' + JSON.stringify(checks, null, 2));
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
