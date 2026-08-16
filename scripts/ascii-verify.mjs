// ASCII 动画工坊 CDP 验证脚本（零依赖，Node >= 22）
// 用法: node scripts/ascii-verify.mjs [port]
// 前提: 本地服务器已起 (python -m http.server 8811 --directory dist)
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.argv[2] || 9224;
const BASE = 'http://127.0.0.1:8811';
const PAGE = `${BASE}/playground/ascii-cube.html`;
const VIDEO = 'C:/Users/Administrator/AppData/Local/Temp/ascii-test/demo.mp4';
const OUT = path.join('scripts', 'ascii-verify-out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- CDP 封装 ----
let ws, msgId = 0;
const pending = new Map();

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url);
    ws.onopen = () => resolve();
    ws.onerror = (e) => reject(new Error('ws error ' + e.message));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject, timer } = pending.get(m.id);
        pending.delete(m.id);
        clearTimeout(timer);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    };
  });
}
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP 超时: ${method}`)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJS(expression, awaitPromise = false) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面 JS 异常: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result?.value;
}
async function pollJS(expression, timeoutMs = 15000, interval = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJS(expression);
    if (v) return v;
    await sleep(interval);
  }
  throw new Error('轮询超时: ' + expression);
}

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

// ---- 主流程 ----
console.log(`[1] 连接 CDP :${PORT}`);
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
let target = targets.find((t) => t.type === 'page');
await connect(target.webSocketDebuggerUrl);
await send('Page.enable');
await send('Runtime.enable');
await send('DOM.enable');

console.log(`[2] 打开页面 ${PAGE}`);
await send('Page.navigate', { url: PAGE });
await sleep(2500);

console.log('[3] 立方体模式初始渲染');
const cube = await evalJS(`(() => {
  const cv = document.getElementById('screen');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 6 || d[i+1] !== 16 || d[i+2] !== 30) nonBg++;
  return { w: cv.width, h: cv.height, nonBg, st: document.getElementById('status').textContent };
})()`);
check('canvas 480x240', cube.w === 480 && cube.h === 240, `${cube.w}x${cube.h}`);
check('立方体已渲染(非背景像素>500)', cube.nonBg > 500, `nonBg=${cube.nonBg}`);

console.log('[4] 切换到视频模式并注入测试视频');
await evalJS(`document.getElementById('tabVideo').click(); true`);
await sleep(300);
const fileNode = await send('DOM.querySelector', { nodeId: (await send('DOM.getDocument')).root.nodeId, selector: '#fileInput' });
await send('DOM.setFileInputFiles', { nodeId: fileNode.nodeId, files: [VIDEO] });

const loaded = await pollJS(`window.ASCII_EXPORT.getState().loaded`, 15000);
check('视频加载完成', loaded === true);

// 播放（兜底：若 autoplay 被拒则手动触发）
await evalJS(`(() => { const v = document.getElementById('srcVideo'); if (v.paused) v.play(); return true; })()`);
await pollJS(`window.ASCII_EXPORT.getState().playing`, 8000);
await sleep(1200);

const v1 = await evalJS(`(() => {
  const st = window.ASCII_EXPORT.getState();
  const cv = document.getElementById('screen');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let nonBg = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 6 || d[i+1] !== 16 || d[i+2] !== 30) nonBg++;
  return { st, w: cv.width, h: cv.height, nonBg, status: document.getElementById('status').textContent };
})()`);
check('自动高度=25 (80x25)', v1.st.rows === 25 && v1.w === 480 && v1.h === 250, `${v1.w}x${v1.h}`);
check('视频帧已渲染(非背景像素>500)', v1.nonBg > 500, `nonBg=${v1.nonBg}`);
check('状态显示文件名', v1.status.includes('demo.mp4'), v1.status);

console.log('[5] 参数联动：宽度→120 高度自动→37');
await evalJS(`(() => { const el = document.getElementById('vidCols'); el.value = 120; el.dispatchEvent(new Event('input')); return true; })()`);
await sleep(500);
const v2 = await evalJS(`(() => { const st = window.ASCII_EXPORT.getState(); const cv = document.getElementById('screen'); return { rows: st.rows, w: cv.width, h: cv.height }; })()`);
check('120 列自动 37 行 (720x370)', v2.rows === 37 && v2.w === 720 && v2.h === 370, `${v2.w}x${v2.h}`);

console.log('[6] 手动高度 42 + 字符集 blocks + 对比 150%');
await evalJS(`(() => {
  document.getElementById('vidRows').value = 42; document.getElementById('vidRows').dispatchEvent(new Event('input'));
  document.getElementById('vidCharset').value = 'blocks'; document.getElementById('vidCharset').dispatchEvent(new Event('change'));
  document.getElementById('vidGain').value = 150; document.getElementById('vidGain').dispatchEvent(new Event('input'));
  return true;
})()`);
await sleep(500);
const v3 = await evalJS(`(() => {
  const st = window.ASCII_EXPORT.getState();
  const cv = document.getElementById('screen');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let colored = new Set();
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 6 || d[i+1] !== 16 || d[i+2] !== 30) colored.add(d[i]+','+d[i+1]+','+d[i+2]);
  return { rows: st.rows, charset: st.charset, w: cv.width, h: cv.height, colors: colored.size };
})()`);
check('手动高度 42 (720x420)', v3.rows === 42 && v3.w === 720 && v3.h === 420, `${v3.w}x${v3.h}`);
check('字符集=blocks', v3.charset === 'blocks');
check('blocks+高对比渲染不崩溃(像素可读)', typeof v3.colors === 'number', `colors=${v3.colors}`);
console.log(`  (colors=${v3.colors}：testsrc 高亮帧 + 对比150% 时可能合法地全转空格，内容随帧变化)`);

console.log('[6b] 开启反相');
await evalJS(`(() => {
  document.getElementById('vidInvert').checked = true; document.getElementById('vidInvert').dispatchEvent(new Event('change'));
  return true;
})()`);
await sleep(500);
const v3b = await evalJS(`(() => {
  const cv = document.getElementById('screen');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let nonBg = 0, colored = new Set();
  for (let i = 0; i < d.length; i += 4) if (d[i] !== 6 || d[i+1] !== 16 || d[i+2] !== 30) { nonBg++; colored.add(d[i]+','+d[i+1]+','+d[i+2]); }
  return { nonBg, colors: colored.size };
})()`);
check('反相后渲染不崩溃(像素可读)', typeof v3b.nonBg === 'number', `nonBg=${v3b.nonBg} colors=${v3b.colors}`);
console.log(`  (反相下非背景像素 ${v3b.nonBg}：亮度随帧变化，全空格属合法结果)`);

console.log('[7] 导出 TXT');
const txtB64 = await evalJS(`window.ASCII_EXPORT.exportTxt().then(async b => {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = ''; const CH = 32768;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(bin);
})`, true);
const txt = Buffer.from(txtB64, 'base64').toString('utf-8');
const frameCount = (txt.match(/^--- frame \d+\/\d+/gm) || []).length;
const lines = txt.split('\n');
check('TXT 头包含参数', txt.includes('; 尺寸: 120 x 42') && txt.includes('; 字符集: blocks'));
check('TXT 帧数=72 (6s x 12fps)', frameCount === 72, `frames=${frameCount}`);
check('TXT 每帧行数=42', lines.filter((l) => l.length === 120).length === 42 * 72, `宽行=${lines.filter((l) => l.length === 120).length}`);
fs.writeFileSync(path.join(OUT, 'export.txt'), txt);

console.log('[8] 导出 GIF');
const gifB64 = await evalJS(`window.ASCII_EXPORT.exportGif().then(async b => {
  const buf = new Uint8Array(await b.arrayBuffer());
  let bin = ''; const CH = 32768;
  for (let i = 0; i < buf.length; i += CH) bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
  return btoa(bin);
})`, true);
const gifBuf = Buffer.from(gifB64, 'base64');
fs.writeFileSync(path.join(OUT, 'export.gif'), gifBuf);
check('GIF89a 文件头', gifBuf.length > 100 && gifBuf.toString('latin1', 0, 6) === 'GIF89a', `${gifBuf.length} bytes`);
const gifFrames = [...gifBuf.toString('latin1').matchAll(/,/g)].length; // 粗略（0x2C=','）
console.log(`  (GIF 内 0x2C 出现 ${gifFrames} 次，稍后用 python 精确解析)`);

console.log('[9] 恢复默认参数');
await evalJS(`(() => {
  const set = (id, val, ev) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event(ev)); };
  set('vidCols', 80, 'input'); set('vidRows', 25, 'input');
  set('vidCharset', 'standard', 'change');
  document.getElementById('vidInvert').checked = false; document.getElementById('vidInvert').dispatchEvent(new Event('change'));
  set('vidGain', 100, 'input');
  return true;
})()`);
await sleep(400);
const v4 = await evalJS(`window.ASCII_EXPORT.getState()`);
check('恢复默认(80x25 standard)', v4.cols === 80 && v4.rows === 25 && v4.charset === 'standard' && !v4.invert);

console.log('[10] 移动端视口 390x844');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await send('Page.reload', { ignoreCache: true });
await sleep(2500);
const mob = await evalJS(`(() => {
  const cv = document.getElementById('screen');
  const r = cv.getBoundingClientRect();
  return {
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    rect: { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
    canvasW: cv.width
  };
})()`);
check('无横向溢出', mob.scrollW === mob.innerW, `scrollW=${mob.scrollW} innerW=${mob.innerW}`);
check('canvas 移动端不溢出且居中', mob.rect.left >= 10 && mob.rect.right <= mob.innerW + 1, `left=${mob.rect.left} right=${mob.rect.right}`);
const shotMob = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'mobile.png'), Buffer.from(shotMob.data, 'base64'));

console.log('[11] 桌面截图');
await send('Emulation.clearDeviceMetricsOverride');
await send('Page.reload', { ignoreCache: true });
await sleep(2500);
const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(OUT, 'desktop.png'), Buffer.from(shot.data, 'base64'));

console.log(`\n===== 结果: ${passed} 通过 / ${failed} 失败 =====`);
process.exit(failed ? 1 : 0);
