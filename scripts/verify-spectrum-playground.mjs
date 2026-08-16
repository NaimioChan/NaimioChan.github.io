// 频谱可视化（playground 版本）验证
import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9224';
const TARGET = 'http://127.0.0.1:8715/playground/spectrum.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { __exc: r.exceptionDetails.exception?.description || r.exceptionDetails.text };
  return r.result?.value;
};
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++; };

try {
  await send('Page.navigate', { url: TARGET });
  await sleep(2500);

  // 返回链接存在
  const back = await evalJs(`document.querySelector('a.back') ? document.querySelector('a.back').getAttribute('href') : null`);
  check('返回首页链接存在', back === '../index.html', back);

  // 静默修复
  const d1 = await evalJs(`(() => ({ freqSum: freqData.reduce((a,b)=>a+b,0), simMode, playing }))()`);
  check('进页面 freqData 全零', d1.freqSum === 0, `freqSum=${d1.freqSum} simMode=${d1.simMode}`);

  // 导出 PNG
  await evalJs(`(() => {
    window.__lastZip = null;
    window.downloadBlob = (blob, name) => { window.__lastZip = { name, size: blob.size, blob }; };
    document.getElementById('expW').value = 320;
    document.getElementById('expH').value = 180;
    document.getElementById('expFps').value = '12';
    document.getElementById('expDur').value = 1;
    document.getElementById('btnExpPng').click();
  })()`);
  let zipInfo = null;
  for (let i = 0; i < 60; i++) { await sleep(500); zipInfo = await evalJs(`window.__lastZip ? { name: window.__lastZip.name, size: window.__lastZip.size } : null`); if (zipInfo) break; }
  check('PNG 序列导出（playground 版）', !!zipInfo, zipInfo ? JSON.stringify(zipInfo) : 'timeout');

  // 导出视频
  await evalJs(`(() => {
    window.__lastVid = null;
    window.downloadBlob = (blob, name) => { window.__lastVid = { name, size: blob.size, blob }; };
    document.getElementById('btnExpVid').click();
  })()`);
  let vidInfo = null;
  for (let i = 0; i < 60; i++) { await sleep(500); vidInfo = await evalJs(`window.__lastVid ? { name: window.__lastVid.name, size: window.__lastVid.size } : null`); if (vidInfo && vidInfo.size > 0) break; }
  check('视频导出（playground 版）', !!vidInfo && vidInfo.size > 0, vidInfo ? JSON.stringify(vidInfo) : 'timeout/empty');

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
