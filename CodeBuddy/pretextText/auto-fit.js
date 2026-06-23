/**
 * 自动计算字号 — HTML 排版 + Pretext 算字号与断行
 *
 * 分工：
 * - Pretext：二分搜索字号 + layoutWithLines 决定每一行有哪些文字（按词/空格规则断行）
 * - HTML：每行一个 <div class="fit-line">，white-space:nowrap，不再让浏览器二次折行
 *
 * 内容区宽度：必须从 DOM 实测（fitText.clientWidth），不能只用 fitRect.w - padding，
 * 因为 box-sizing:border-box 下还要扣除 border，且须与 CSS padding 保持同步。
 */

import { prepareWithSegments, layoutWithLines } from '@chenglou/pretext';

const FONT_FAMILY = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const SAMPLE_TEXT = 'Pretext 让文字测量不再触发 reflow。HTML 负责排版，库只算字号。你好，世界。';

/** 与 Pretext 测量一致的排版选项（按词断行，CJK 在合适边界换行） */
const PREPARE_OPTS = {
  whiteSpace: 'normal',
  wordBreak: 'normal',
};

/**
 * Pretext 用 Canvas measureText，浏览器 HTML 渲染可能有 1～2px 子像素误差。
 * layout 时略收窄 maxWidth，避免「算得过满」导致行尾被裁切或出现省略号。
 */
const LAYOUT_WIDTH_INSET = 2;

const fitBox = document.getElementById('fitBox');
const fitText = document.getElementById('fitText');
const fitHandle = document.getElementById('fitHandle');
const fitStats = document.getElementById('fitStats');

/** 排版框在舞台内的位置与尺寸（px，含 border + padding，对应 fit-box 的 offset 宽高） */
const fitRect = { x: 48, y: 48, w: 300, h: 150 };

/**
 * 读取 fit-box 内部文字区域的真实可用宽高（与 HTML 排版一致）。
 * 须先写好 fitBox 的 left/top/width/height 再调用。
 */
function measureContentBox() {
  const style = getComputedStyle(fitBox);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  // clientWidth：子元素 fit-text 的实际占位宽度（已扣除 border 与 padding）
  const width = Math.max(40, fitText.clientWidth);
  // clientHeight 含 padding，减去后得到内容区高度
  const height = Math.max(24, fitBox.clientHeight - padY);
  const layoutWidth = Math.max(1, Math.floor(width - LAYOUT_WIDTH_INSET));
  return { width, height, layoutWidth };
}

/**
 * 用 Pretext 二分搜索最大字号。
 * contentH / layoutWidth 来自 measureContentBox()，与 CSS 盒模型对齐。
 */
function findFontSizeWithPretext(text, layoutWidth, contentH, minPx = 10, maxPx = 96) {
  let lo = minPx;
  let hi = maxPx;
  let best = null;

  while (lo <= hi) {
    const size = Math.floor((lo + hi) / 2);
    const font = `700 ${size}px ${FONT_FAMILY}`;
    const prepared = prepareWithSegments(text, font, PREPARE_OPTS);
    const lineHeight = Math.round(size * 1.28);
    const layout = layoutWithLines(prepared, layoutWidth, lineHeight);

    if (layout.height <= contentH) {
      best = { size, lineHeight, font };
      lo = size + 1;
    } else {
      hi = size - 1;
    }
  }

  return best;
}

/** 在最终字号下，用当前内容区宽度再 layout 一次（与渲染同一 maxWidth） */
function layoutAtSize(text, sizePx, layoutWidth) {
  const font = `700 ${sizePx}px ${FONT_FAMILY}`;
  const prepared = prepareWithSegments(text, font, PREPARE_OPTS);
  const lineHeight = Math.round(sizePx * 1.28);
  const layout = layoutWithLines(prepared, layoutWidth, lineHeight);
  return { layout, lineHeight };
}

/**
 * 把 Pretext 断好的每一行写入 HTML。
 * 每行独立 div + nowrap，避免浏览器再次在中间拆词。
 */
function renderPretextLines(container, layout, sizePx, lineHeight) {
  container.style.fontFamily = FONT_FAMILY;
  container.style.fontSize = `${sizePx}px`;
  container.style.fontWeight = '700';
  container.style.lineHeight = `${lineHeight}px`;

  container.replaceChildren();
  for (const line of layout.lines) {
    const row = document.createElement('div');
    row.className = 'fit-line';
    row.textContent = line.text;
    container.appendChild(row);
  }
}

function applyFit() {
  fitBox.style.left = `${fitRect.x}px`;
  fitBox.style.top = `${fitRect.y}px`;
  fitBox.style.width = `${fitRect.w}px`;
  fitBox.style.height = `${fitRect.h}px`;

  // 必须先应用盒尺寸，再实测内容区（含 border/padding 的正确扣减）
  const { width: contentW, height: contentH, layoutWidth } = measureContentBox();

  const t0 = performance.now();
  const found = findFontSizeWithPretext(SAMPLE_TEXT, layoutWidth, contentH);
  const ms = (performance.now() - t0).toFixed(2);

  if (!found) {
    fitStats.textContent = '容器太小，无法排版';
    fitText.replaceChildren();
    return;
  }

  // 用实测 layoutWidth 再排一次，保证写入 DOM 的行与 Pretext 计算一致
  const { layout, lineHeight } = layoutAtSize(SAMPLE_TEXT, found.size, layoutWidth);
  renderPretextLines(fitText, layout, found.size, lineHeight);

  fitStats.textContent =
    `字号 ${found.size}px · ${layout.lineCount} 行 · 内容区 ${Math.round(contentW)}×${Math.round(contentH)}px · layout 宽 ${layoutWidth}px · 二分 ${ms}ms`;
}

// ─── 拖拽缩放排版框 ───────────────────────────────────────

let resizing = false;
let resizeStart = null;

fitHandle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  resizeStart = { px: e.clientX, py: e.clientY, w: fitRect.w, h: fitRect.h };
  fitHandle.setPointerCapture(e.pointerId);
});

fitHandle.addEventListener('pointermove', (e) => {
  if (!resizing) return;
  fitRect.w = Math.max(120, resizeStart.w + (e.clientX - resizeStart.px));
  fitRect.h = Math.max(80, resizeStart.h + (e.clientY - resizeStart.py));
  applyFit();
});

fitHandle.addEventListener('pointerup', () => { resizing = false; });
fitHandle.addEventListener('pointercancel', () => { resizing = false; });

let movingBox = false;
let moveStart = null;

fitBox.addEventListener('pointerdown', (e) => {
  if (e.target === fitHandle) return;
  movingBox = true;
  moveStart = { px: e.clientX, py: e.clientY, x: fitRect.x, y: fitRect.y };
  fitBox.setPointerCapture(e.pointerId);
});

fitBox.addEventListener('pointermove', (e) => {
  if (!movingBox) return;
  fitRect.x = moveStart.x + (e.clientX - moveStart.px);
  fitRect.y = moveStart.y + (e.clientY - moveStart.py);
  applyFit();
});

fitBox.addEventListener('pointerup', () => { movingBox = false; });
fitBox.addEventListener('pointercancel', () => { movingBox = false; });

applyFit();
