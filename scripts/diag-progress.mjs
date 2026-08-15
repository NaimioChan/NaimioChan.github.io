// 诊断 progress：scroll 事件触发？rAF override 生效？
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
};

await send('Page.navigate', { url: TARGET });
await sleep(3000);
await evalJs("document.documentElement.style.scrollBehavior='auto'");

// 注入探针
const probe = await evalJs(`(() => {
  window.__scrollCount = 0;
  window.addEventListener('scroll', () => window.__scrollCount++, { passive: true });
  window.requestAnimationFrame = (cb) => { window.__rafCalled = true; cb(Date.now()); return 0; };
  window.scrollTo(0, 2000);
  return {
    scrollCount: window.__scrollCount,
    rafCalled: window.__rafCalled === true,
    scrollY: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    progressWidth: document.querySelector('.scroll-progress').style.width,
    barFound: !!document.querySelector('.scroll-progress')
  };
})()`);
console.log(JSON.stringify(probe, null, 2));
ws.close();
