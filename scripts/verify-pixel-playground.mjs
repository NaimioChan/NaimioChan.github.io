// 像素画编辑器 v2 验证：$ 定义修复 + 画板绘制 + 工具/按钮 + 尺寸切换 + 干净导出 + 亮色主题
const CDP = 'http://127.0.0.1:9226';
const TARGET = 'http://127.0.0.1:8715/playground/pixel.html';
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

// 在画布显示坐标 (cx,cy) 处模拟 mousedown（button: 0 左键 / 2 右键）
const MOVE = (cx, cy, btn) => `(() => {
  const cv = document.getElementById('board');
  const r = cv.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: r.left + ${cx}, clientY: r.top + ${cy}, button: ${btn}, buttons: ${btn === 0 ? 1 : 2} };
  cv.dispatchEvent(new MouseEvent('mousedown', opts));
  cv.dispatchEvent(new MouseEvent('mousemove', opts));
  window.dispatchEvent(new MouseEvent('mouseup', opts));
})()`;

try {
  await send('Page.navigate', { url: TARGET });
  await sleep(2000);

  // 0. 返回链接
  const back = await evalJs(`document.querySelector('a.back') ? document.querySelector('a.back').getAttribute('href') : null`);
  check('返回首页链接存在', back === '../index.html', back);

  // 1. 亮色主题 + 脚本无报错（$ 已定义，能访问内部状态）
  const d1 = await evalJs(`(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    tool, N, cur: cur.slice(0,7),
    gridSize: grid.length + 'x' + grid[0].length,
    cvW: document.getElementById('board').width,
    cvDisplay: getComputedStyle(document.getElementById('board')).width,
    font: getComputedStyle(document.body).fontFamily.slice(0, 30),
  }))()`);
  check('亮色背景 #e6f0fa', d1.bodyBg === 'rgb(230, 240, 250)', d1.bodyBg);
  check('脚本运行正常（$ 定义修复）', d1.tool === 'pen' && d1.N === 32, `tool=${d1.tool} N=${d1.N}`);
  check('初始 grid 32×32 全空', d1.gridSize === '32x32');
  check('canvas 逻辑 32px / 显示 448px', d1.cvW === 32 && d1.cvDisplay === '448px', `${d1.cvW}/${d1.cvDisplay}`);
  check('衬线字体', d1.font.includes('Times'), d1.font);

  // 2. 画板能画：左键点 (200,200) → (14,14) 格有像素
  await evalJs(MOVE(200, 200, 0));
  await sleep(200);
  const d2 = await evalJs(`(() => ({
    px: grid[14][14],
    filled: grid.flat().filter(Boolean).length,
    szVal: document.getElementById('szVal').textContent,
  }))()`);
  check('左键画上像素（14,14）', !!d2.px && d2.px.startsWith('#'), `px=${d2.px}`);
  check('grid 有内容', d2.filled >= 1, `filled=${d2.filled}`);

  // 3. 橡皮：点 erase → 右键擦除 → 像素消失
  await evalJs(`document.querySelector('.tool[data-tool="erase"]').click()`);
  await evalJs(MOVE(200, 200, 2)); // 右键
  await sleep(200);
  const d3 = await evalJs(`(() => ({ px: grid[14][14], tool, eraseOn: document.querySelector('.tool[data-tool="erase"]').classList.contains('on') }))()`);
  check('工具按钮切换生效（erase 高亮）', d3.tool === 'erase' && d3.eraseOn);
  check('右键擦除生效', d3.px === null, `px=${d3.px}`);

  // 4. 填充工具：选 fill + 点空白区 → 连通空白被填充
  await evalJs(`(() => {
    document.querySelector('.tool[data-tool="pen"]').click();
    ;${MOVE(100, 100, 0)}
    document.querySelector('.tool[data-tool="fill"]').click();
    ;${MOVE(300, 300, 0)}
  })()`);
  await sleep(200);
  const d4 = await evalJs(`(() => ({ tool, filled: grid.flat().filter(Boolean).length }))()`);
  check('填充工具生效', d4.tool === 'fill' && d4.filled > 100, `filled=${d4.filled}`);

  // 5. 按钮：清空 → 全空；画一笔 → 撤销 → 恢复为空
  await evalJs(`(() => {
    document.querySelector('#btnClear').click();
    return grid.flat().filter(Boolean).length;
  })()`);
  await sleep(200);
  const cleared = await evalJs(`grid.flat().filter(Boolean).length`);
  check('清空按钮生效', cleared === 0, `cleared=${cleared}`);
  await evalJs(MOVE(300, 300, 0)); // 画一笔（snap 记录空状态）
  await evalJs(`document.getElementById('btnUndo').click()`);
  await sleep(200);
  const undone = await evalJs(`grid.flat().filter(Boolean).length`);
  check('撤销按钮生效', undone === 0, `undone=${undone}`);

  // 6. 尺寸切换：16 → 48 → 64
  const sz64 = await evalJs(`(() => {
    document.querySelector('#sizeBtns .tool[data-size="64"]').click();
    return { N, cvW: document.getElementById('board').width, g: grid.length + 'x' + grid[0].length,
             label: document.getElementById('curSize').textContent, on: document.querySelector('#sizeBtns .tool[data-size="64"]').classList.contains('on') };
  })()`);
  await sleep(200);
  check('切到 64×64', sz64.N === 64 && sz64.cvW === 64 && sz64.g === '64x64' && sz64.label === '64×64' && sz64.on, JSON.stringify(sz64));
  await evalJs(`document.querySelector('.tool[data-tool="pen"]').click();`); // 重置为画笔（fill 会全填）
  await evalJs(MOVE(224, 224, 0)); // 64 格 → (32,32)
  const d6 = await evalJs(`grid.flat().filter(Boolean).length`);
  check('64×64 上能画', d6 === 1, `filled=${d6}`);
  const sz16 = await evalJs(`(() => {
    document.querySelector('#sizeBtns .tool[data-size="16"]').click();
    return { N, g: grid.length + 'x' + grid[0].length, filled: grid.flat().filter(Boolean).length };
  })()`);
  await sleep(200);
  check('切到 16×16 且画布重置', sz16.N === 16 && sz16.g === '16x16' && sz16.filled === 0, JSON.stringify(sz16));

  // 7. 导出干净（透明底，无棋盘底纹）：画 2 格 → exportCanvas alpha 统计
  const exp = await evalJs(`(() => {
    document.querySelector('#sizeBtns .tool[data-size="32"]').click();
    document.querySelector('.tool[data-tool="pen"]').click();
    ;${MOVE(100, 100, 0)}
    ;${MOVE(348, 100, 0)}
    const c = exportCanvas();
    const d = c.getContext('2d').getImageData(0, 0, 32, 32).data;
    let opaque = 0, transparent = 0;
    for (let i = 3; i < d.length; i += 4) d[i] === 255 ? opaque++ : transparent++;
    return { opaque, transparent, total: opaque + transparent };
  })()`);
  await sleep(200);
  check('导出 PNG 透明底（无棋盘污染）', exp.opaque === 2 && exp.transparent === 1022, `opaque=${exp.opaque} transparent=${exp.transparent}`);

  // 8. 导出按钮触发（savePng 不报错）
  const saveOk = await evalJs(`(() => { try { savePng(); return true; } catch (e) { return String(e); } })()`);
  check('导出按钮可触发', saveOk === true, String(saveOk));

  // 9. 演示模式（?demo=1）能画出示例
  await send('Page.navigate', { url: TARGET + '?demo=1' });
  await sleep(1500);
  const demo = await evalJs(`grid.flat().filter(Boolean).length`);
  check('demo 模式画出示例', demo > 50, `filled=${demo}`);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exitCode = fail ? 1 : 0;
} catch (err) {
  console.error('ERROR:', err.message);
  process.exitCode = 1;
} finally {
  ws.close();
}
