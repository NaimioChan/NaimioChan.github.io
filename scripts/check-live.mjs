// 验证线上 GitHub Pages 页面渲染
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const CDP = 'http://127.0.0.1:9222';
const TARGET = 'https://naimiochan.github.io/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};
await send('Page.navigate', { url: TARGET });
await sleep(4000);
const checks = await evalJs(`(() => ({
  title: document.title,
  theme: document.documentElement.dataset.theme,
  decorRemoved: document.querySelectorAll('.bubbles, .bubble, .cursor-glow, .sound-toggle').length,
  heroName: document.querySelector('.hero-name-row')?.textContent,
  announce: document.querySelector('.announce-head')?.textContent,
  workCards: document.querySelectorAll('.work-card').length,
  platforms: [...document.querySelectorAll('.platform-link')].map(a => a.textContent.trim()).join(' / '),
  contacts: [...document.querySelectorAll('.contact-name')].map(s => s.textContent).join(' / '),
  jsRunning: !!document.querySelector('.type-text') && document.querySelector('.type-text').textContent.length > 0
}))()`);
console.log(JSON.stringify(checks, null, 2));
// 截图
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(resolve('C:/Users/Administrator/projects/personal-page-aqua/preview-live.png'), Buffer.from(shot.data, 'base64'));
console.log('saved preview-live.png');
ws.close();
