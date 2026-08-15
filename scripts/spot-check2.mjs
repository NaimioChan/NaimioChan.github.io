// 抽查：公告卡+作品卡链接、颜色
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
await send('Page.navigate', { url: 'http://localhost:4173/' });
await sleep(3500);
const r = await evalJs(`(() => {
  const links = [...document.querySelectorAll('.work-card, .announce-card')].map(a => a.getAttribute('href'));
  return {
    cardLinks: links,
    tagColor: getComputedStyle(document.querySelector('.announce-tag')).color,
    numColor: getComputedStyle(document.querySelector('.work-num')).color,
    announceHead: document.querySelector('.announce-head').textContent,
    announceSub: document.querySelector('.announce-sub').textContent
  };
})()`);
console.log(JSON.stringify(r, null, 2));
ws.close();
