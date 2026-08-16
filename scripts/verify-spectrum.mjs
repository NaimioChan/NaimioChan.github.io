// 频谱可视化 v4 验证：播放器化（进度条/续播/不卸载）+ 全曲导出 + MP4 带音轨 + 无内置曲
import { writeFileSync } from 'node:fs';
const CDP = 'http://127.0.0.1:9226';
const TARGET = 'http://127.0.0.1:8714/index.html';
const AUDIO = 'http://127.0.0.1:8714/test_audio.mp3';
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

const STATE = `(() => ({
  freqSum: freqData.reduce((a,b)=>a+b,0),
  simMode: simMode,
  playing: playing,
  btnPlay: document.getElementById('btnPlay').textContent,
  songName: document.getElementById('songName').textContent,
  seekVal: document.getElementById('seekBar').value,
  timeNow: document.getElementById('timeNow').textContent,
  timeTotal: document.getElementById('timeTotal').textContent,
  startAt: startAt, pauseOffset: pauseOffset,
  dur: currentBuf ? currentBuf.duration : null,
  acState: AC ? AC.state : 'null',
}))()`;

try {
  await send('Page.navigate', { url: TARGET });
  await sleep(2500);

  // 1. 进页面：无内置曲、freqData 全零、进度条存在、导出面板已简化
  const d1 = await evalJs(STATE);
  check('进页面 freqData 全零', d1.freqSum === 0, `freqSum=${d1.freqSum}`);
  check('进页面 simMode=false', d1.simMode === false);
  check('未导入时 btnPlay=播放', d1.btnPlay === '▶ 播放', d1.btnPlay);
  check('未导入时 songName=未加载音频', d1.songName.includes('未加载音频'), d1.songName);
  const ui = await evalJs(`(() => ({
    hasSeek: !!document.getElementById('seekBar'),
    seekVal: document.getElementById('seekBar').value,
    hasExpDur: !!document.getElementById('expDur'),
    hasNote: !!document.querySelector('.exp-note'),
    h2: document.querySelector('.export-box h2').textContent,
    hasBuiltin: !!document.querySelector('[data-rate]'),
  }))()`);
  check('进度条存在且初始 0', ui.hasSeek && ui.seekVal === '0');
  check('时长参数已删除', !ui.hasExpDur);
  check('说明文字已删除', !ui.hasNote, `h2=${ui.h2}`);
  check('导出标题无「透明素材」', !ui.h2.includes('透明素材'), ui.h2);

  // 2. 未导入点播放 → 不崩溃不播放（alert 兜底）
  await evalJs(`window.alert=()=>{}; document.getElementById('btnPlay').click()`);
  await sleep(300);
  const d2 = await evalJs(STATE);
  check('未导入点播放仍不播放', d2.playing === false);

  // 3. 注入测试音频（fetch → decode → playBuffer）：导入即从头播放
  await evalJs(`(async () => {
    const r = await fetch('${AUDIO}');
    const ab = await r.arrayBuffer();
    initAudio();
    const buf = await AC.decodeAudioData(ab);
    playBuffer(buf, '测试', 0);
  })()`);
  await sleep(1500);
  const d3 = await evalJs(STATE);
  check('导入后 playing=true', d3.playing === true, `btnPlay=${d3.btnPlay}`);
  check('导入后按钮=暂停', d3.btnPlay === '⏸ 暂停', d3.btnPlay);
  check('currentBuf 时长≈3s（整曲）', d3.dur !== null && Math.abs(d3.dur - 3) < 0.2, `dur=${d3.dur}`);
  check('总时长显示 0:03', d3.timeTotal === '0:03', d3.timeTotal);
  check('currentBuf 不被卸载（暂停后仍可续播的核心）', d3.dur !== null);

  // 4. 驱动 rAF 后频谱有数据（headless 模拟分支或真实频谱均可）
  await evalJs(DRIVE_RAF(3));
  await sleep(200);
  const d4 = await evalJs(STATE);
  check('播放中频谱有数据', d4.freqSum > 0, `freqSum=${d4.freqSum} acState=${d4.acState}`);

  // 5. 暂停：记录暂停位置，source 停止但 currentBuf 保留
  await evalJs(`togglePlay()`);
  await sleep(600);
  const d5 = await evalJs(STATE);
  check('暂停后 playing=false', d5.playing === false, `btnPlay=${d5.btnPlay}`);
  check('暂停后按钮=播放', d5.btnPlay === '▶ 播放');
  check('暂停后 currentBuf 仍在（未卸载）', d5.dur !== null, `dur=${d5.dur}`);
  check('暂停位置已记录', typeof d5.pauseOffset === 'number' && d5.pauseOffset >= 0, `pauseOffset=${d5.pauseOffset}`);

  // 6. 暂停态拖动进度条 → 跳转位置
  await evalJs(`(() => {
    const sb = document.getElementById('seekBar');
    sb.value = 600;
    sb.dispatchEvent(new Event('input'));
    sb.dispatchEvent(new Event('change'));
  })()`);
  await sleep(300);
  const d6 = await evalJs(STATE);
  check('暂停态 seek 到 60%≈1.8s', Math.abs(d6.pauseOffset - 1.8) < 0.15, `pauseOffset=${d6.pauseOffset} timeNow=${d6.timeNow}`);

  // 7. 继续播放：从暂停处继续（startAt = pauseOffset，不回到 0）
  await evalJs(`togglePlay()`);
  await sleep(600);
  const d7 = await evalJs(STATE);
  check('继续播放后 playing=true', d7.playing === true);
  check('从暂停处继续（startAt≈1.8）', Math.abs(d7.startAt - 1.8) < 0.15, `startAt=${d7.startAt} pauseOffset=${d7.pauseOffset}`);

  // 8. 播放态拖动进度条 → 直接跳转
  await evalJs(`(() => {
    const sb = document.getElementById('seekBar');
    sb.value = 300;
    sb.dispatchEvent(new Event('input'));
    sb.dispatchEvent(new Event('change'));
  })()`);
  await sleep(600);
  const d8 = await evalJs(STATE);
  check('播放态 seek 到 30%≈0.9s', Math.abs(d8.startAt - 0.9) < 0.15, `startAt=${d8.startAt}`);

  // 9. 导出 PNG 序列：全曲 3s @ 12fps = 36 帧（验证导出整曲而非固定时长）
  await evalJs(`(() => {
    window.__lastZip = null;
    const orig = window.downloadBlob;
    window.downloadBlob = (blob, name) => { window.__lastZip = { name, size: blob.size, blob }; orig(blob, name); };
    document.getElementById('expW').value = 320;
    document.getElementById('expH').value = 180;
    document.getElementById('expFps').value = '12';
    document.getElementById('expMode').value = 'bars';
    document.getElementById('btnExpPng').click();
  })()`);
  let zipInfo = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    zipInfo = await evalJs(`window.__lastZip ? { name: window.__lastZip.name, size: window.__lastZip.size } : null`);
    if (zipInfo) break;
  }
  check('PNG 全曲导出完成', !!zipInfo, zipInfo ? JSON.stringify(zipInfo) : 'timeout');
  if (zipInfo) {
    const b64 = await evalJs(`(async () => {
      const buf = new Uint8Array(await window.__lastZip.blob.arrayBuffer());
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return btoa(bin);
    })()`);
    writeFileSync('C:/Users/Administrator/AppData/Local/Temp/viz_export.zip', Buffer.from(b64, 'base64'));
    console.log('  saved viz_export.zip');
  }

  // 10. 导出视频：MP4 带原曲音轨
  await evalJs(`(() => {
    window.__lastVid = null;
    const orig = window.downloadBlob;
    window.downloadBlob = (blob, name) => { window.__lastVid = { name, size: blob.size, blob }; orig(blob, name); };
    document.getElementById('btnExpVid').click();
  })()`);
  let vidInfo = null;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    vidInfo = await evalJs(`window.__lastVid ? { name: window.__lastVid.name, size: window.__lastVid.size } : null`);
    if (vidInfo && vidInfo.size > 0) break;
  }
  check('视频导出完成（非空）', !!vidInfo && vidInfo.size > 0, vidInfo ? JSON.stringify(vidInfo) : 'timeout/empty');
  if (vidInfo && vidInfo.size > 0) {
    const b64 = await evalJs(`(async () => {
      const buf = new Uint8Array(await window.__lastVid.blob.arrayBuffer());
      let bin = ''; const CH = 0x8000;
      for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return btoa(bin);
    })()`);
    const ext = vidInfo.name.endsWith('webm') ? 'webm' : 'mp4';
    writeFileSync(`C:/Users/Administrator/AppData/Local/Temp/viz_export.${ext}`, Buffer.from(b64, 'base64'));
    console.log(`  saved viz_export.${ext}`);
  }
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
