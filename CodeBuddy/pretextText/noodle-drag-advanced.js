/**
 * 面条拖拽 · 进阶版
 *
 * - 每行独立：点击哪一行，仅该行变软（面条物理）
 * - 未点击行保持刚性横排
 * - 行间 S 形连接：第1-2行尾↔尾，第2-3头↔头，第3-4尾↔尾……
 * - 面条质点之间碰撞，避免字重叠
 */

import { prepareWithSegments, layoutWithLines, measureNaturalWidth } from '@chenglou/pretext';

const FONT_FAMILY = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const SAMPLE_TEXT =
  'Pretext 让文字测量不再触发 reflow。点击某一行使其变软。' +
  'Drag a line to soften it. 你好，世界。多行自动换行，S 形相连。';

const FONT_SIZE = 20;
const FONT = `600 ${FONT_SIZE}px ${FONT_FAMILY}`;
const LINE_HEIGHT = Math.round(FONT_SIZE * 1.45);
const PREPARE_OPTS = { whiteSpace: 'normal', wordBreak: 'normal' };
const MAX_LAYOUT_WIDTH = 440;

const GRAVITY = 0.34;
const DAMPING = 0.984;
const SOLVER_ITERS = 10;
const COLLISION_R = 9;
const COLLISION_ITERS = 4;

const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const statsEl = document.getElementById('stats');

function segmentWidth(seg) {
  return measureNaturalWidth(prepareWithSegments(seg, FONT, PREPARE_OPTS));
}

function makePoint(x, y) {
  return { x, y, prevX: x, prevY: y, pinned: false };
}

function distPointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function satisfyDistance(a, b, rest, pinA, pinB) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const diff = (dist - rest) / dist;
  const ox = dx * diff;
  const oy = dy * diff;

  if (pinA && pinB) return;

  if (pinA && !pinB) {
    b.x -= ox;
    b.y -= oy;
    return;
  }
  if (!pinA && pinB) {
    a.x += ox;
    a.y += oy;
    return;
  }

  a.x += ox * 0.5;
  a.y += oy * 0.5;
  b.x -= ox * 0.5;
  b.y -= oy * 0.5;
}

/** 单行文字链 */
class TextLine {
  constructor(lineText, startX, baselineY, lineIndex) {
    this.lineIndex = lineIndex;
    this.lineText = lineText;
    this.mode = 'rigid';
    this.segments = prepareWithSegments(lineText, FONT, PREPARE_OPTS).segments;
    this.restLengths = this.segments.map((s) => segmentWidth(s));
    this.startX = startX;
    this.baselineY = baselineY;
    this.points = [];
    this.dragIndex = -1;
    this.anchorHead = lineIndex === 0;
    this.resetRigid();
  }

  /** 第一行头部始终固定在起始位置 */
  pinAnchorHead() {
    if (!this.anchorHead || this.points.length === 0) return;
    const h = this.head;
    h.x = this.startX;
    h.y = this.baselineY;
    h.prevX = h.x;
    h.prevY = h.y;
    h.pinned = true;
  }

  get head() {
    return this.points[0];
  }

  get tail() {
    return this.points[this.points.length - 1];
  }

  isPinned(i) {
    if (this.anchorHead && i === 0) return true;
    return this.mode === 'rigid' || this.points[i].pinned;
  }

  /** 恢复刚性横排坐标 */
  resetRigid() {
    this.points = [makePoint(this.startX, this.baselineY)];
    let x = this.startX;
    for (const len of this.restLengths) {
      x += len;
      this.points.push(makePoint(x, this.baselineY));
    }
    for (const p of this.points) {
      p.prevX = p.x;
      p.prevY = p.y;
      p.pinned = false;
    }
    this.pinAnchorHead();
  }

  soften() {
    if (this.mode === 'noodle') return;
    this.mode = 'noodle';
    for (const p of this.points) {
      p.pinned = false;
      p.prevX = p.x;
      p.prevY = p.y;
    }
    this.pinAnchorHead();
  }

  segmentHitRadius(i) {
    return Math.max(14, this.restLengths[i] * 0.5);
  }

  hitSegment(mx, my, segIndex) {
    const a = this.points[segIndex];
    const b = this.points[segIndex + 1];
    return distPointToSegment(mx, my, a.x, a.y, b.x, b.y) <= this.segmentHitRadius(segIndex);
  }

  /** 命中该行任意文字段 */
  pick(mx, my) {
    for (let i = 0; i < this.segments.length; i++) {
      if (!this.hitSegment(mx, my, i)) continue;
      const a = this.points[i];
      const b = this.points[i + 1];
      const da = Math.hypot(mx - a.x, my - a.y);
      const db = Math.hypot(mx - b.x, my - b.y);
      this.dragIndex = da <= db ? i : i + 1;
      if (this.anchorHead && this.dragIndex === 0) {
        this.dragIndex = this.points.length > 1 ? 1 : -1;
      }
      return this.dragIndex;
    }
    this.dragIndex = -1;
    return -1;
  }

  release() {
    if (this.dragIndex >= 0) this.points[this.dragIndex].pinned = false;
    this.dragIndex = -1;
    this.pinAnchorHead();
  }

  dragTo(mx, my) {
    if (this.dragIndex < 0 || this.mode !== 'noodle') return;
    if (this.anchorHead && this.dragIndex === 0) return;
    const p = this.points[this.dragIndex];
    p.x = mx;
    p.y = my;
    p.prevX = mx;
    p.prevY = my;
    p.pinned = true;
  }

  verletStep() {
    if (this.mode !== 'noodle') return;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.pinned) continue;
      const vx = (p.x - p.prevX) * DAMPING;
      const vy = (p.y - p.prevY) * DAMPING;
      p.prevX = p.x;
      p.prevY = p.y;
      p.x += vx;
      p.y += vy + GRAVITY;
    }
  }

  draw(ctx) {
    ctx.font = FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    for (let i = 0; i < this.segments.length; i++) {
      const a = this.points[i];
      const b = this.points[i + 1];
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.fillStyle = this.mode === 'noodle' ? '#f8fafc' : '#e2e8f0';
      ctx.fillText(this.segments[i], 0, 0);
      ctx.restore();
    }
  }
}

/**
 * 多行场景
 * S 连接：行 i 与 i+1 之间，i 为偶数→尾尾，i 为奇数→头头
 */
class TextScene {
  constructor(lines, marginX, marginY) {
    this.lines = lines;
    this.marginX = marginX;
    this.marginY = marginY;
    this.links = this.buildLinks();
    this.activeLine = null;
    this.dragging = false;
  }

  buildLinks() {
    const links = [];
    for (let i = 0; i < this.lines.length - 1; i++) {
      const tailTail = i % 2 === 0;
      const lineA = this.lines[i];
      const lineB = this.lines[i + 1];
      const pa = tailTail ? lineA.tail : lineA.head;
      const pb = tailTail ? lineB.tail : lineB.head;
      links.push({
        lineA: i,
        lineB: i + 1,
        pointA: tailTail ? lineA.points.length - 1 : 0,
        pointB: tailTail ? lineB.points.length - 1 : 0,
        type: tailTail ? 'tail-tail' : 'head-head',
        rest: Math.hypot(pb.x - pa.x, pb.y - pa.y),
      });
    }
    return links;
  }

  getPoint(lineIdx, pointIdx) {
    return this.lines[lineIdx].points[pointIdx];
  }

  isPointPinned(lineIdx, pointIdx) {
    return this.lines[lineIdx].isPinned(pointIdx);
  }

  /** 任一行文字段命中；优先检测靠上的行 */
  pickLine(mx, my) {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      if (this.lines[i].pick(mx, my) >= 0) return this.lines[i];
    }
    return null;
  }

  /** 收集所有面条行质点用于碰撞 */
  collectNoodlePoints() {
    const out = [];
    for (const line of this.lines) {
      if (line.mode !== 'noodle') continue;
      line.points.forEach((p, i) => out.push({ p, line, i }));
    }
    return out;
  }

  resolveCollisions() {
    const pts = this.collectNoodlePoints();
    const minDist = COLLISION_R * 2;

      for (let k = 0; k < COLLISION_ITERS; k++) {
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          if (a.line === b.line && Math.abs(a.i - b.i) <= 1) continue;

          const dx = b.p.x - a.p.x;
          const dy = b.p.y - a.p.y;
          const dist = Math.hypot(dx, dy) || 0.0001;
          if (dist >= minDist) continue;

          const push = (minDist - dist) / dist * 0.5;
          const px = dx * push;
          const py = dy * push;

          if (!a.p.pinned && !b.p.pinned) {
            a.p.x -= px;
            a.p.y -= py;
            b.p.x += px;
            b.p.y += py;
          } else if (!a.p.pinned) {
            a.p.x -= px * 2;
            a.p.y -= py * 2;
          } else if (!b.p.pinned) {
            b.p.x += px * 2;
            b.p.y += py * 2;
          }
        }
      }
    }
  }

  step() {
    for (const line of this.lines) {
      if (line.mode === 'rigid') line.resetRigid();
    }

    for (const line of this.lines) line.verletStep();

    for (let k = 0; k < SOLVER_ITERS; k++) {
      for (const line of this.lines) {
        if (line.mode !== 'noodle') continue;
        for (let i = 0; i < line.restLengths.length; i++) {
          satisfyDistance(
            line.points[i],
            line.points[i + 1],
            line.restLengths[i],
            line.isPinned(i),
            line.isPinned(i + 1),
          );
        }
      }

      for (const link of this.links) {
        const lineA = this.lines[link.lineA];
        const lineB = this.lines[link.lineB];
        const needsLink = lineA.mode === 'noodle' || lineB.mode === 'noodle';
        if (!needsLink) continue;

        const pa = this.getPoint(link.lineA, link.pointA);
        const pb = this.getPoint(link.lineB, link.pointB);
        satisfyDistance(
          pa,
          pb,
          link.rest,
          this.isPointPinned(link.lineA, link.pointA),
          this.isPointPinned(link.lineB, link.pointB),
        );
      }

      this.resolveCollisions();
    }

    for (const line of this.lines) line.pinAnchorHead();
  }

  draw(ctx) {
    for (const link of this.links) {
      const lineA = this.lines[link.lineA];
      const lineB = this.lines[link.lineB];
      if (lineA.mode !== 'noodle' && lineB.mode !== 'noodle') continue;

      const pa = this.getPoint(link.lineA, link.pointA);
      const pb = this.getPoint(link.lineB, link.pointB);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    for (const line of this.lines) line.draw(ctx);
  }

  noodleCount() {
    return this.lines.filter((l) => l.mode === 'noodle').length;
  }
}

function buildScene(width, height) {
  const marginX = Math.max(24, width * 0.06);
  const marginY = Math.max(32, height * 0.08);
  const layoutWidth = Math.max(180, Math.min(width - marginX * 2, MAX_LAYOUT_WIDTH));

  const prepared = prepareWithSegments(SAMPLE_TEXT, FONT, PREPARE_OPTS);
  const layout = layoutWithLines(prepared, layoutWidth, LINE_HEIGHT);

  const lines = layout.lines.map((line, i) => {
    const y = marginY + i * LINE_HEIGHT + FONT_SIZE * 0.55;
    return new TextLine(line.text, marginX, y, i);
  });

  return {
    scene: new TextScene(lines, marginX, marginY),
    lineCount: layout.lineCount,
    layoutWidth,
  };
}

let scene = null;
let frame = 0;
let layoutMeta = { lineCount: 0, layoutWidth: 0 };
let stageW = 0;
let stageH = 0;

function resizeStage() {
  const rect = stage.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio, 2);
  stageW = rect.width;
  stageH = rect.height;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const built = buildScene(stageW, stageH);
  scene = built.scene;
  return { lineCount: built.lineCount, layoutWidth: built.layoutWidth };
}

function pointerPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function render() {
  frame += 1;
  if (scene) scene.step();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
  for (let x = 0; x < stageW; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, stageH);
    ctx.stroke();
  }

  if (scene) scene.draw(ctx);

  statsEl.textContent =
    `共 ${layoutMeta.lineCount} 行 · 换行宽 ${layoutMeta.layoutWidth}px · 面条行 ${scene?.noodleCount() ?? 0} · 帧 ${frame}`;

  requestAnimationFrame(render);
}

canvas.addEventListener('pointerdown', (e) => {
  if (!scene) return;
  const { x, y } = pointerPos(e);
  const line = scene.pickLine(x, y);
  if (!line) return;

  if (line.mode === 'rigid') line.soften();

  scene.activeLine = line;
  scene.dragging = true;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
  line.dragTo(x, y);
});

canvas.addEventListener('pointermove', (e) => {
  if (!scene?.dragging || !scene.activeLine) return;
  const { x, y } = pointerPos(e);
  scene.activeLine.dragTo(x, y);
});

function endDrag() {
  if (scene) {
    scene.dragging = false;
    scene.activeLine?.release();
    scene.activeLine = null;
  }
  canvas.classList.remove('dragging');
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

window.addEventListener('resize', () => {
  layoutMeta = resizeStage();
});

layoutMeta = resizeStage();
requestAnimationFrame(render);
