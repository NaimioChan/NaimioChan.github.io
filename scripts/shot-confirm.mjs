// 截图给用户确认：hero + works
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const CDP = 'http://127.0.0.1:9222';
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
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(file), Buffer.from(r.data, 'base64'));
  console.log('saved', file);
};
await send('Page.navigate', { url: 'http://localhost:4173/' });
await sleep(4000);
await evalJs('window.scrollTo(0, 1000)');
await sleep(900);
await shot('C:/Users/Administrator/projects/personal-page-aqua/preview-confirm-works.png');
await evalJs('window.scrollTo(0, 0)');
await sleep(700);
await shot('C:/Users/Administrator/projects/personal-page-aqua/preview-confirm-hero.png');
ws.close();
