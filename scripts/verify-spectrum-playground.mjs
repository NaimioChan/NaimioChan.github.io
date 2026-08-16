// 频谱可视化 v4（playground 版本）验证：返回链接 + 播放器化 + 全曲导出 + 视频带音轨
import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9226';
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
let pass = 0, fail = 0;
const check = (n, ok, d = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); ok ? pass++ : fail++; };

// 页面内生成 3s 440Hz 测试音频（离屏渲染，绕开跨端口 CORS）
const INJECT = `(async () => {
  const sr = 44100, dur = 3;
  const off = new OfflineAudioContext(1, sr*dur, sr);
  const b = off.createBuffer(1, sr*dur, sr); const d = b.getChannelData(0);
  for (let i=0;i<d.length;i++) d[i] = Math.sin(2*Math.PI*440*i/sr)*0.8;
  const src = off.createBufferSource(); src.buffer = b;
  src.connect(off.destination); src.start(0);
  const buf = await off.startRendering();
  playBuffer(buf, '测试音频', 0);
})()`;

try {
  await send('Page.navigate', { url: TARGET });
  await sleep(2500);

  // 返回链接
  const back = await evalJs(`document.querySelector('a.back') ? document.querySelector('a.back').getAttribute('href') : null`);
  check('返回首页链接存在', back === '../index.html', back);

  // 静默修复 + 播放器化 UI
  const d1 = await evalJs(`(() => ({
    freqSum: freqData.reduce((a,b)=>a+b,0),
    simMode, playing,
    hasSeek: !!document.getElementById('seekBar'),
    hasExpDur: !!document.getElementById('expDur'),
    hasNote: !!document.querySelector('.exp-note'),
  }))()`);
  check('进页面 freqData 全零', d1.freqSum === 0, `freqSum=${d1.freqSum} simMode=${d1.simMode}`);
  check('进度条存在 / 时长参数已删 / 说明已删', d1.hasSeek && !d1.hasExpDur && !d1.hasNote);

  // 注入音频 → 播放
  await evalJs(INJECT);
  await sleep(1200);
  const d2 = await evalJs(`(() => ({
    playing, btn: document.getElementById('btnPlay').textContent,
    dur: currentBuf ? currentBuf.duration : null,
    timeTotal: document.getElementById('timeTotal').textContent,
  }))()`);
  check('导入即播放（整曲 3s）', d2.playing === true && d2.dur !== null && Math.abs(d2.dur - 3) < 0.2, JSON.stringify(d2));

  // 暂停 → 从暂停处继续（seek 到 60% 再续播）
  await evalJs(`togglePlay()`);
  await sleep(300);
  await evalJs(`(() => {
    const sb = document.getElementById('seekBar');
    sb.value = 600;
    sb.dispatchEvent(new Event('input'));
    sb.dispatchEvent(new Event('change'));
  })()`);
  await sleep(300);
  await evalJs(`togglePlay()`);
  await sleep(300);
  const d3 = await evalJs(`(() => ({ playing, startAt, pauseOffset }))()`);
  check('暂停续播从 60% 处继续', d3.playing === true && Math.abs(d3.startAt - 1.8) < 0.15, `startAt=${d3.startAt}`);

  // 导出 PNG 全曲（3s @ 12fps = 36 帧）
  await evalJs(`(() => {
    window.__lastZip = null;
    window.downloadBlob = (blob, name) => { window.__lastZip = { name, size: blob.size, blob }; };
    document.getElementById('expW').value = 320;
    document.getElementById('expH').value = 180;
    document.getElementById('expFps').value = '12';
    document.getElementById('btnExpPng').click();
  })()`);
  let zipInfo = null;
  for (let i = 0; i < 40; i++) { await sleep(500); zipInfo = await evalJs(`window.__lastZip ? { name: window.__lastZip.name, size: window.__lastZip.size } : null`); if (zipInfo) break; }
  check('PNG 全曲导出（36 帧）', !!zipInfo && zipInfo.name.includes('36f'), zipInfo ? JSON.stringify(zipInfo) : 'timeout');
  if (zipInfo) {
    const b64 = await evalJs(`(async () => {
      const buf = new Uint8Array(await window.__lastZip.blob.arrayBuffer());
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return btoa(bin);
    })()`);
    writeFileSync('C:/Users/Administrator/AppData/Local/Temp/viz_export_playground.zip', Buffer.from(b64, 'base64'));
  }

  // 导出视频（MP4 带原曲音轨）
  await evalJs(`(() => {
    window.__lastVid = null;
    window.downloadBlob = (blob, name) => { window.__lastVid = { name, size: blob.size, blob }; };
    document.getElementById('btnExpVid').click();
  })()`);
  let vidInfo = null;
  for (let i = 0; i < 40; i++) { await sleep(500); vidInfo = await evalJs(`window.__lastVid ? { name: window.__lastVid.name, size: window.__lastVid.size } : null`); if (vidInfo && vidInfo.size > 0) break; }
  check('视频导出（非空）', !!vidInfo && vidInfo.size > 0, vidInfo ? JSON.stringify(vidInfo) : 'timeout/empty');
  if (vidInfo && vidInfo.size > 0) {
    const b64 = await evalJs(`(async () => {
      const buf = new Uint8Array(await window.__lastVid.blob.arrayBuffer());
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return btoa(bin);
    })()`);
    const ext = vidInfo.name.endsWith('webm') ? 'webm' : 'mp4';
    writeFileSync(`C:/Users/Administrator/AppData/Local/Temp/viz_export_playground.${ext}`, Buffer.from(b64, 'base64'));
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
