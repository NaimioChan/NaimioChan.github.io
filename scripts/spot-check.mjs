// 抽查：标题颜色/副行颜色/图位/页脚
import { resolve } from 'node:path';
const CDP = 'http://127.0.0.1:9222';
const TARGET = 'http://localhost:4173/';
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true });
  return r.result?.value;
};
await send('Page.navigate', { url: TARGET });
await sleep(3000);
const checks = await evalJs(`(() => {
  const name = getComputedStyle(document.querySelector('.hero-name'));
  const type = getComputedStyle(document.querySelector('.hero-type'));
  const cover = document.querySelector('.announce-cover');
  const cr = cover.getBoundingClientRect();
  return {
    heroNameColor: name.color,
    heroNameShadow: name.textShadow.slice(0, 40),
    heroTypeColor: type.color,
    heroTypeFont: type.fontStyle + ' ' + type.fontSize,
    coverSize: cr.width + 'x' + cr.height,
    coverHasIcon: !!cover.querySelector('svg'),
    footerText: document.querySelector('.footer p').textContent,
    reflectionGone: !document.querySelector('.hero-reflection'),
    typeHasPeriod: document.querySelector('.type-text').textContent.includes('.')
  };
})()`);
console.log(JSON.stringify(checks, null, 2));
ws.close();
