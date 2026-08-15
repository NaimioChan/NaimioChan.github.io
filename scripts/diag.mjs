// 诊断：滚动后主线程是否卡死
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

console.log('t0', await evalJs('1+1'));
await send('Page.navigate', { url: TARGET });
await sleep(3000);
console.log('loaded', await evalJs('document.readyState'));
// 关掉 smooth scroll 再滚动
await evalJs("document.documentElement.style.scrollBehavior='auto'");
const t1 = Date.now();
await evalJs('window.scrollTo(0, 1500)');
console.log('scrollTo returned in', Date.now() - t1, 'ms');
await sleep(2500);
const t2 = Date.now();
console.log('post-scroll eval:', await evalJs('1+1'), 'in', Date.now() - t2, 'ms');
console.log('scrollY:', await evalJs('window.scrollY'));
// 再滚动到更下面
const t3 = Date.now();
await evalJs('window.scrollTo(0, 4000)');
console.log('scrollTo2 returned in', Date.now() - t3, 'ms');
await sleep(2500);
console.log('scrollY2:', await evalJs('window.scrollY'));
console.log('reveal in:', await evalJs("document.querySelectorAll('.reveal.in').length + '/' + document.querySelectorAll('.reveal').length"));
ws.close();
