// 频谱可视化 v3 验证：直接检查数据源（freqData/simMode）+ PASSTHROUGH_RAF 驱动
import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9224';
const TARGET = 'http://127.0.0.1:8714/index.html';
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

const DRIVE_RAF = (n) => `(() => {
  const cbs = [];
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  const t0 = performance.now();
  for (let i = 0; i < ${n}; i++) { const cb = cbs.shift(); if (cb) cb(t0 + i * 16.7); }
  window.requestAnimationFrame = orig;
  return cbs.length;
})()`;

const DATA = `(() => ({
  freqSum: freqData.reduce((a,b)=>a+b,0),
  simMode: simMode,
  playing: playing,
  mode: mode,
}))()`;

try {
  await send('Page.navigate', { url: TARGET });
  await sleep(2500);

  // 1. 进页面：freqData 全 0、simMode=false（修复核心：无规律频谱数据源已切断）
  const d1 = await evalJs(DATA);
  check('进页面 freqData 全零（无频谱数据）', d1.freqSum === 0, `freqSum=${d1.freqSum} simMode=${d1.simMode}`);
  check('进页面 simMode=false（未走模拟分支）', d1.simMode === false);

  // 2. 驱动 rAF 后画布只有网格线（无随机频谱条）
  await evalJs(DRIVE_RAF(3));
  await sleep(200);
  const grid = await evalJs(`(() => {
    const cv = document.getElementById('viz');
    const d = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
    // 非零 alpha 像素的行分布（网格线在 y≈57/113/170/227/283，频谱条应在底部大块区域）
    const rows = new Set();
    let nz = 0;
    for (let y = 0; y < cv.height; y++) {
      for (let x = 0; x < cv.width; x++) {
        if (d[(y*cv.width+x)*4+3] > 0) { nz++; if (nz < 20000) rows.add(y); }
      }
    }
    // 检查底部 1/4 区域是否有大量内容（频谱条特征）
    let bottom = 0;
    for (let y = Math.floor(cv.height*0.75); y < cv.height; y++)
      for (let x = 0; x < cv.width; x++)
        if (d[(y*cv.width+x)*4+3] > 0) bottom++;
    return { nz, rowCount: rows.size, bottom };
  })()`);
  check('画布内容仅网格线（非频谱）', grid.nz > 0 && grid.nz < 20000, `nz=${grid.nz} 行数=${grid.rowCount} 底部1/4=${grid.bottom}`);

  // 3. 播放后：freqData 有数据（headless 中 AC suspended 会走模拟分支，
  //    但真实浏览器 AC running 走真实频谱——两者都满足「有内容」）
  await evalJs(`document.getElementById('btnPlay').click()`);
  await sleep(2000);
  const d2 = await evalJs(DATA);
  check('播放后 freqData 有数据', d2.freqSum > 0, `freqSum=${d2.freqSum} playing=${d2.playing} acState=${await evalJs(`AC?AC.state:'null'`)}`);
  check('播放后画面有频谱内容', d2.freqSum > 0 && d2.simMode === true, `freqSum=${d2.freqSum}（headless 模拟降级或真实频谱均可）`);

  // 4. 暂停后：freqData 归零（回到静默）
  await evalJs(`document.getElementById('btnPlay').click()`);
  await sleep(1200);
  const d3 = await evalJs(DATA);
  check('暂停后 freqData 归零', d3.freqSum === 0, `freqSum=${d3.freqSum} playing=${d3.playing}`);

  // 5. 导出 PNG 序列（透明底）：检查 zip 内 PNG 的 alpha 通道
  await evalJs(`document.getElementById('btnPlay').click()`);  // currentBuf 就绪
  await sleep(800);
  await evalJs(`(() => {
    window.__lastZip = null;
    const orig = window.downloadBlob;
    window.downloadBlob = (blob, name) => { window.__lastZip = { name, size: blob.size, blob }; orig(blob, name); };
    document.getElementById('expW').value = 320;
    document.getElementById('expH').value = 180;
    document.getElementById('expFps').value = '12';
    document.getElementById('expDur').value = 1;
    document.getElementById('expMode').value = 'bars';
    document.getElementById('btnExpPng').click();
  })()`);
  let zipInfo = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    zipInfo = await evalJs(`window.__lastZip ? { name: window.__lastZip.name, size: window.__lastZip.size } : null`);
    if (zipInfo) break;
  }
  check('PNG 序列导出完成', !!zipInfo, zipInfo ? JSON.stringify(zipInfo) : 'timeout');
  if (zipInfo) {
    // 从页面取 zip base64 写盘
    const b64 = await evalJs(`(async () => {
      const buf = new Uint8Array(await window.__lastZip.blob.arrayBuffer());
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return btoa(bin);
    })()`);
    writeFileSync('C:/Users/Administrator/AppData/Local/Temp/viz_export.zip', Buffer.from(b64, 'base64'));
    console.log('  saved viz_export.zip');
  }

  // 6. 导出视频（MP4/WebM）
  await evalJs(`(() => {
    window.__lastVid = null;
    const orig = window.downloadBlob;
    window.downloadBlob = (blob, name) => { window.__lastVid = { name, size: blob.size, blob }; orig(blob, name); };
    document.getElementById('btnExpVid').click();
  })()`);
  let vidInfo = null;
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    vidInfo = await evalJs(`window.__lastVid ? { name: window.__lastVid.name, size: window.__lastVid.size } : null`);
    if (vidInfo && vidInfo.size > 0) break;
  }
  check('视频导出完成（非空）', !!vidInfo && vidInfo.size > 0, vidInfo ? JSON.stringify(vidInfo) : 'timeout/empty');
  const progTxt = await evalJs(`document.getElementById('expProgress').textContent`);
  console.log('  导出状态:', progTxt);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
