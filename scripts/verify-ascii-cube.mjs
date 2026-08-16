// ascii-cube 修复验证 v2 — 零依赖 CDP（Node ≥22）
// 关键回归断言：视频模式下 cubeLoop 必须停止绘制（修复闪烁）
// 用 PASSTHROUGH_RAF 手动驱动 rAF 回调，规避 headless 后台标签 rAF 节流。
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CDP = 'http://127.0.0.1:9224';
const TARGET = 'http://127.0.0.1:8712/playground/ascii-cube.html';
const VID = 'C:/Users/Administrator/AppData/Local/Temp/test_video.mp4';
const shotDir = process.cwd();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${label}`)), ms))]);

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome://') && !t.url.startsWith('devtools://'));
if (!page) throw new Error('no page target');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await withTimeout(new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }), 10_000, 'ws open');

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
const send = (method, params = {}) => withTimeout(new Promise((res, rej) => {
  const i = ++id; pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
}), 15_000, method);
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result?.value;
};
const shot = async (file) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(shotDir, file), Buffer.from(r.data, 'base64'));
  console.log(`  saved ${file}`);
};
const step = (l) => console.log(`• ${l}`);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// 手动驱动 rAF 回调 n 次（每次给递增时间戳，模拟真实帧推进）
const DRIVE_RAF = (n) => `(() => {
  const cbs = [];
  const orig = window.requestAnimationFrame;
  window.requestAnimationFrame = (cb) => { cbs.push(cb); return cbs.length; };
  const t0 = performance.now();
  for (let i = 0; i < ${n}; i++) {
    const cb = cbs.shift(); if (cb) cb(t0 + i * 16.7);
  }
  window.requestAnimationFrame = orig;
  return cbs.length;
})()`;

const snapJs = `(() => {
  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let nonBg = 0; let h = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lit = d[i] + d[i+1] + d[i+2] > 60;
    if (lit) nonBg++;
    h = (h * 31 + d[i] + d[i+1] + d[i+2]) | 0;
  }
  return { w: cv.width, hh: cv.height, nonBg, hash: h >>> 0 };
})()`;

try {
  step('navigate');
  await send('Page.navigate', { url: TARGET });
  await sleep(2000);

  // 1. 立方体模式：驱动 2 帧 rAF 后 canvas 变化（cubeLoop 在画）
  const c1 = await evalJs(snapJs);
  await evalJs(DRIVE_RAF(2));
  await sleep(100);
  const c2 = await evalJs(snapJs);
  check('立方体模式 cubeLoop 绘制', c1.hash !== c2.hash, `hash ${c1.hash} -> ${c2.hash}`);

  // 2. 切到视频模式（未导入视频）：驱动 rAF，canvas 必须静止 —— 核心回归断言
  await evalJs(`document.getElementById('tabVideo').click()`);
  await sleep(300);
  const v1 = await evalJs(snapJs);
  await evalJs(DRIVE_RAF(3));
  await sleep(100);
  const v2 = await evalJs(snapJs);
  check('视频模式 cubeLoop 停止绘制（闪烁修复）', v1.hash === v2.hash,
    `hash ${v1.hash} -> ${v2.hash} nonBg=${v1.nonBg}`);

  // 3. 导入视频
  step('导入测试视频');
  const doc = await send('DOM.getDocument');
  const fq = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fileInput' });
  await send('DOM.setFileInputFiles', { nodeId: fq.nodeId, files: [VID] });
  await sleep(2500);

  const st = await evalJs(`document.getElementById('status').textContent`);
  check('导入成功状态栏', st.includes('已加载'), st);
  const state = await evalJs(`window.ASCII_EXPORT.getState()`);
  check('videoLoaded=true', state.loaded === true, `mode=${state.mode} rows=${state.rows} playing=${state.playing}`);

  // 4. 导入后 canvas 尺寸跟随网格（80x33 -> 480x330）
  const v3 = await evalJs(snapJs);
  check('导入后 canvas 尺寸跟随网格', v3.w === 480 && v3.hh === 330, `${v3.w}x${v3.hh}`);

  // 5. 播放绘制链路：seek 到不同帧 + 手动驱动 rAF → canvas 内容必须不同
  //    （headless 中 muted 自动播放不推进 currentTime，用 seek 代替验证绘制链路）
  async function seekDrive(t) {
    await evalJs(`document.getElementById('srcVideo').currentTime = ${t}`);
    await sleep(600);
    await evalJs(DRIVE_RAF(3));
    await sleep(150);
    return evalJs(snapJs);
  }
  const f1 = await seekDrive(0.3);
  const f2 = await seekDrive(1.5);
  check('不同视频帧绘制不同内容（videoLoop 正常）', f1.hash !== f2.hash,
    `t0.3 hash=${f1.hash} vs t1.5 hash=${f2.hash}`);
  check('视频帧满屏字符（非立方体）', f2.nonBg > 3000,
    `nonBg=${f2.nonBg}（立方体模式约 ${c1.nonBg}）`);

  // 8. 切回立方体模式恢复绘制
  await evalJs(`document.getElementById('tabCube').click()`);
  await sleep(300);
  const d1 = await evalJs(snapJs);
  await evalJs(DRIVE_RAF(2));
  await sleep(100);
  const d2 = await evalJs(snapJs);
  check('切回立方体恢复绘制', d1.hash !== d2.hash, `hash ${d1.hash} -> ${d2.hash}`);

  step('screenshots');
  await evalJs(`document.getElementById('tabVideo').click()`);
  await sleep(500);
  await shot('ascii-video-mode.png');
  await evalJs(`document.getElementById('tabCube').click()`);
  await sleep(500);
  await shot('ascii-cube-mode.png');

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
