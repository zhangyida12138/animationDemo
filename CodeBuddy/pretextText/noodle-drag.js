/**
 * 面条拖拽 — Pretext 测段宽 + Canvas 软体链
 *
 * 整体流程：
 * 1. Pretext 把字符串拆成 Unicode 字素段（segments），并测量每段宽度
 * 2. 用 N+1 个质点 + N 条距离约束组成软体链，静息长度 = Pretext 段宽
 * 3. 每帧 Verlet 积分 + 约束求解，Canvas 沿链绘制各段文字
 */

import { prepareWithSegments, measureNaturalWidth } from '@chenglou/pretext';

// ─── 常量 ───────────────────────────────────────────────

const FONT_FAMILY = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const SAMPLE_TEXT = 'Pretext 让文字测量不再触发 reflow。Drag like noodles! 你好，世界。';
const NOODLE_FONT_SIZE = 22;
/** Canvas fillText 用的 font 字符串，须与 Pretext prepare 时一致 */
const NOODLE_FONT = `600 ${NOODLE_FONT_SIZE}px ${FONT_FAMILY}`;

// ─── DOM / Canvas ───────────────────────────────────────

const noodleStage = document.getElementById('noodleStage');
const noodleCanvas = document.getElementById('noodleCanvas');
const noodleCtx = noodleCanvas.getContext('2d');
const noodleStats = document.getElementById('noodleStats');

/**
 * 用 Pretext 测量每个字素段的「自然宽度」（不换行时的占位）。
 * 这些值会作为软体链相邻质点之间的目标间距（rest length）。
 */
function buildSegmentWidths(text) {
  const prepared = prepareWithSegments(text, NOODLE_FONT);
  return prepared.segments.map((seg) => {
    const segPrepared = prepareWithSegments(seg, NOODLE_FONT);
    return measureNaturalWidth(segPrepared);
  });
}

/** 创建一个质点；prevX/Y 用于 Verlet 速度推算 */
function makePoint(x, y, pinned = false) {
  return { x, y, prevX: x, prevY: y, pinned };
}

/**
 * 软体文字链
 *
 * 结构：segments.length 段文字 → segments.length + 1 个质点
 * 点 i 与点 i+1 之间夹着第 i 段文字，目标距离 = restLengths[i]
 */
class NoodleString {
  constructor(text, startX, startY) {
    this.segments = prepareWithSegments(text, NOODLE_FONT).segments;
    this.restLengths = buildSegmentWidths(text);
    // 左端第一个点固定（pinned），作为锚点
    this.points = [makePoint(startX, startY, true)];

    let x = startX;
    for (const len of this.restLengths) {
      x += len;
      this.points.push(makePoint(x, startY, false));
    }

    this.gravity = 0.38;       // 每帧向下加速度
    this.damping = 0.985;      // 速度衰减，避免永远弹跳
    this.iterations = 8;       // 约束迭代次数，越大链越「硬」
    this.dragIndex = -1;       // 当前被鼠标抓取的质点下标
  }

  /** 在半径内找离鼠标最近的质点，用于开始拖拽 */
  pickPoint(mx, my, radius = 28) {
    let best = -1;
    let bestD = radius * radius;
    this.points.forEach((p, i) => {
      const d = (p.x - mx) ** 2 + (p.y - my) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    this.dragIndex = best;
    return best;
  }

  /** 松开鼠标：取消质点钉住状态 */
  release() {
    if (this.dragIndex > 0) this.points[this.dragIndex].pinned = false;
    this.dragIndex = -1;
  }

  /** 拖拽中：把质点钉在鼠标位置（覆盖物理模拟） */
  dragTo(mx, my) {
    if (this.dragIndex < 0) return;
    const p = this.points[this.dragIndex];
    p.x = mx;
    p.y = my;
    p.prevX = mx;
    p.prevY = my;
    p.pinned = true;
  }

  /** 物理步进：先 Verlet，再多次距离约束拉回「面条」长度 */
  step() {
    const pts = this.points;

    // ① Verlet：根据上一帧位置推算速度，叠加重力
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (p.pinned) continue;
      const vx = (p.x - p.prevX) * this.damping;
      const vy = (p.y - p.prevY) * this.damping;
      p.prevX = p.x;
      p.prevY = p.y;
      p.x += vx;
      p.y += vy + this.gravity;
    }

    // ② 距离约束：相邻质点间距趋近 Pretext 测量的 restLength
    for (let k = 0; k < this.iterations; k++) {
      for (let i = 0; i < this.restLengths.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const rest = this.restLengths[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const diff = (dist - rest) / dist;
        const ox = dx * diff * 0.5;
        const oy = dy * diff * 0.5;
        if (!a.pinned) { a.x += ox; a.y += oy; }
        if (!b.pinned) { b.x -= ox; b.y -= oy; }
      }
    }
  }

  /** 绘制链身曲线 + 各段文字 + 质点手柄 */
  draw(ctx) {
    ctx.font = NOODLE_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // 链身（半透明折线，增强「面条」感）
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(this.points[0].x, this.points[0].y);
    for (let i = 1; i < this.points.length; i++) {
      ctx.lineTo(this.points[i].x, this.points[i].y);
    }
    ctx.stroke();

    // 每段文字画在相邻两质点的中点，旋转到链的切线方向
    for (let i = 0; i < this.segments.length; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.fillStyle = '#f8fafc';
      ctx.fillText(this.segments[i], 0, 0);
      ctx.restore();
    }

    // 质点小圆点：拖拽时高亮
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      ctx.beginPath();
      ctx.arc(p.x, p.y, i === 0 ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === this.dragIndex ? '#fbbf24' : 'rgba(56, 189, 248, 0.7)';
      ctx.fill();
    }
  }
}

// ─── 主循环与交互 ─────────────────────────────────────────

let noodle = null;
let noodleFrame = 0;
let noodleDragging = false;

/** 按舞台尺寸初始化链条起点（靠左上区域） */
function initNoodle() {
  const rect = noodleStage.getBoundingClientRect();
  noodle = new NoodleString(SAMPLE_TEXT, rect.width * 0.12, rect.height * 0.35);
}

/**
 * 同步 Canvas 位图分辨率。
 * CSS 宽高 100% 铺满舞台；width/height 属性 × dpr 避免高分屏模糊。
 */
function resizeNoodleStage() {
  const rect = noodleStage.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 2);
  noodleCanvas.width = Math.floor(rect.width * dpr);
  noodleCanvas.height = Math.floor(rect.height * dpr);
  noodleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initNoodle();
}

/** requestAnimationFrame 循环：物理步进 → 清屏 → 绘制 */
function renderNoodle() {
  if (!noodle) return;
  noodle.step();
  noodleFrame += 1;
  noodleCtx.clearRect(0, 0, noodleCanvas.width, noodleCanvas.height);
  noodle.draw(noodleCtx);
  noodleStats.textContent = `段数 ${noodle.segments.length} · 模拟帧 ${noodleFrame}`;
  requestAnimationFrame(renderNoodle);
}

/** 把 pointer 事件坐标转为 Canvas 内 CSS 像素坐标 */
function noodlePointerPos(e) {
  const rect = noodleCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

noodleCanvas.addEventListener('pointerdown', (e) => {
  const { x, y } = noodlePointerPos(e);
  if (noodle.pickPoint(x, y) >= 0) {
    noodleDragging = true;
    noodleCanvas.setPointerCapture(e.pointerId);
  }
});

noodleCanvas.addEventListener('pointermove', (e) => {
  if (!noodleDragging) return;
  const { x, y } = noodlePointerPos(e);
  noodle.dragTo(x, y);
});

noodleCanvas.addEventListener('pointerup', () => {
  noodleDragging = false;
  noodle.release();
});

noodleCanvas.addEventListener('pointercancel', () => {
  noodleDragging = false;
  noodle.release();
});

window.addEventListener('resize', resizeNoodleStage);
resizeNoodleStage();
renderNoodle();
