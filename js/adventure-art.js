/**
 * 冒険の地図の絵。
 *
 * スタート(下)からゴール(上)へ、4マスずつ斜めに登りながら折り返す道に、場所を並べる。
 * 木や家、川などの景色は、島ごとに決まった乱数で、道と場所をよけて置く(同じ島は、いつも同じ景色になる)。
 * 座標は幅340の viewBox で決め、画面の幅に合わせて広げる。場所のボタンは、この座標に重ねて置く。
 * 色は CSS の変数(--adv-*)で塗り、暗い画面では夜の景色にする。絵は、どれもこのアプリのために描いたもの。
 */

const WIDTH = 340;
const COLUMNS = [70, 136, 204, 270];
const PER_ROW = COLUMNS.length;
const ROW_HEIGHT = 100;
/** 行の中で、1マス進むごとに上がる高さ。道が斜めに登って見える。 */
const RISE = 10;
/** 折り返しで、道が外へふくらむ幅。 */
const TURN_OUT = 33;
const TOP = 100;
const BOTTOM = 84;
const ROAD_HALF = 12.5;
/** 場所の位置を少しずつずらして、手で描いた道のように見せる。 */
const WOBBLE = [0, 4, -3, 3, -4, 2, -2, 1];

const f = (value) => Math.round(value * 10) / 10;

/** パスの文字列を作る。数は小数1桁にそろえる。 */
function d(strings, ...values) {
  return strings.reduce((out, text, index) => out + text + (index < values.length ? f(values[index]) : ''), '');
}

/**
 * 道のマス目の位置。0番はスタート、最後はゴールで、その間に場所が並ぶ。
 * @param {number} count 場所の数
 */
export function boardLayout(count) {
  const total = count + 2;
  const rows = Math.ceil(total / PER_ROW);
  const height = TOP + (rows - 1) * ROW_HEIGHT + ((total - 1) % PER_ROW) * RISE + BOTTOM;
  const base = height - BOTTOM;
  const cells = Array.from({ length: total }, (_, index) => {
    const row = Math.floor(index / PER_ROW);
    const step = index % PER_ROW;
    const column = row % 2 === 0 ? step : PER_ROW - 1 - step;
    const wobble = index === 0 || index === total - 1 ? 0 : WOBBLE[(index * 3 + row) % WOBBLE.length];
    return { x: COLUMNS[column] + wobble, y: base - row * ROW_HEIGHT - step * RISE, row, column };
  });
  return { width: WIDTH, height, cells };
}

/** 道が通る点。マス目に、行の端で外へふくらむ折り返しの点を足す。at[マスの番号] が、そのマスの点の番号。 */
function roadPoints(cells) {
  const points = [];
  const at = [];
  cells.forEach((cell, index) => {
    const previous = cells[index - 1];
    if (previous && previous.row !== cell.row) {
      const right = previous.column === PER_ROW - 1;
      points.push({
        x: right ? Math.max(previous.x, cell.x) + TURN_OUT : Math.min(previous.x, cell.x) - TURN_OUT,
        y: (previous.y + cell.y) / 2,
      });
    }
    at.push(points.length);
    points.push({ x: cell.x, y: cell.y });
  });
  return { points, at };
}

/** 点をなめらかにつなぐ3次ベジェ曲線(Catmull-Rom)。 */
function curves(points) {
  return points.slice(0, -1).map((p1, index) => {
    const p0 = points[index - 1] ?? p1;
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    return [
      p1,
      { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      p2,
    ];
  });
}

function curvePath(list) {
  return list.map(([, c1, c2, p2]) => d`C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`).join('');
}

function smoothPath(points) {
  return d`M${points[0].x} ${points[0].y}` + curvePath(curves(points));
}

/** スタートから upto 番目のマスまでの道。 */
export function roadPath(cells, upto = cells.length - 1) {
  const { points, at } = roadPoints(cells);
  const end = at[Math.min(Math.max(upto, 0), cells.length - 1)];
  return d`M${points[0].x} ${points[0].y}` + curvePath(curves(points).slice(0, end));
}

function bezierPoint([p0, c1, c2, p3], t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return { x: a * p0.x + b * c1.x + c * c2.x + e * p3.x, y: a * p0.y + b * c1.y + c * c2.y + e * p3.y };
}

function samplePath(points, perCurve = 10) {
  const samples = [];
  for (const curve of curves(points)) {
    for (let step = 0; step < perCurve; step += 1) samples.push(bezierPoint(curve, step / perCurve));
  }
  samples.push(points.at(-1));
  return samples;
}

/** ゴールの横で相棒が立つ側(-1 は左、1 は右)。道が来る側に立ち、反対側に「ゴール」の札を立てる。 */
function goalSide(layout) {
  const cell = layout.cells.at(-1);
  const previous = layout.cells.at(-2);
  if (previous.row === cell.row) return Math.sign(previous.x - cell.x) || 1;
  return cell.x < layout.width / 2 ? 1 : -1;
}

/** 相棒が立つ位置。ゴールでは、宝箱が見えるよう、宝箱の横に立つ。 */
export function standPoint(layout, at) {
  const cell = layout.cells[at + 1];
  if (at + 1 < layout.cells.length - 1) return cell;
  return { x: cell.x + goalSide(layout) * 30, y: cell.y };
}

/* ---- 決まった乱数 ---- */

function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i, j, seed) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** なめらかに変わる 0〜1 の値。森や林のまとまりを作る。 */
function smoothNoise(x, y, seed, size) {
  const gx = x / size;
  const gy = y / size;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, seed);
  const b = hash(i + 1, j, seed);
  const c = hash(i, j + 1, seed);
  const e = hash(i + 1, j + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + e) * sx * sy;
}

function shuffle(list, rand) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const other = Math.floor(rand() * (index + 1));
    [list[index], list[other]] = [list[other], list[index]];
  }
  return list;
}

/** 置いたものの場所。道や場所(hard)とは重ねず、景色どうしは少しだけ重ねてよい。 */
class Space {
  constructor() {
    this.buckets = new Map();
  }

  key(i, j) {
    return `${i},${j}`;
  }

  add(x, y, r, hard = false) {
    const key = this.key(Math.floor(x / 40), Math.floor(y / 40));
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push({ x, y, r, hard });
  }

  free(x, y, r, strict = false) {
    const i = Math.floor(x / 40);
    const j = Math.floor(y / 40);
    for (let di = -2; di <= 2; di += 1) {
      for (let dj = -2; dj <= 2; dj += 1) {
        for (const item of this.buckets.get(this.key(i + di, j + dj)) ?? []) {
          const limit = strict || item.hard ? r + item.r : (r + item.r) * 0.78;
          if (Math.hypot(item.x - x, item.y - y) < limit) return false;
        }
      }
    }
    return true;
  }
}

/* ---- 絵の部品。どれも (x, y) を足もとにして描く ---- */

const circle = (cls, x, y, r) => `<circle class="${cls}" cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
const ellipse = (cls, x, y, rx, ry) => `<ellipse class="${cls}" cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}"/>`;
const rect = (cls, x, y, w, h, r = 0) =>
  `<rect class="${cls}" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${r ? ` rx="${f(r)}"` : ''}/>`;
const path = (cls, value) => `<path class="${cls}" d="${value}"/>`;
const shadow = (x, y, rx, ry = rx * 0.32) => ellipse('a-shadow', x, y, rx, ry);

function starPath(cx, cy, outer, inner) {
  let value = '';
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 ? inner : outer;
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    value += `${index ? 'L' : 'M'}${f(cx + radius * Math.cos(angle))} ${f(cy + radius * Math.sin(angle))}`;
  }
  return `${value}Z`;
}

function tree(x, y, s, fruit) {
  let out = shadow(x, y, 9.5 * s)
    + rect('a-trunk', x - 1.8 * s, y - 9 * s, 3.6 * s, 9 * s, 1.2 * s)
    + circle('a-leaf-dark', x - 5 * s, y - 11 * s, 6 * s)
    + circle('a-leaf-dark', x + 5 * s, y - 11 * s, 6 * s)
    + circle('a-leaf-dark', x, y - 17 * s, 8 * s)
    + circle('a-leaf', x - 2 * s, y - 17.5 * s, 6.6 * s)
    + circle('a-leaf', x - 5 * s, y - 12.5 * s, 4.2 * s)
    + circle('a-leaf-light', x - 4 * s, y - 20.5 * s, 2.6 * s);
  if (fruit) {
    out += circle('a-fruit', x + 3.5 * s, y - 12.5 * s, 1.4 * s)
      + circle('a-fruit', x - 1 * s, y - 10.5 * s, 1.4 * s)
      + circle('a-fruit', x + 2 * s, y - 19 * s, 1.4 * s);
  }
  return out;
}

function pine(x, y, s, snowy) {
  const tiers = [[y - 4 * s, y - 17 * s, 10 * s], [y - 10 * s, y - 22.5 * s, 8 * s], [y - 15.5 * s, y - 28 * s, 6 * s]];
  let out = shadow(x, y, 8.5 * s) + rect('a-trunk', x - 1.5 * s, y - 6 * s, 3 * s, 6 * s, 1 * s);
  for (const [bottom, top, half] of tiers) {
    out += path('a-pine-dark', d`M${x - half} ${bottom}Q${x} ${bottom + 2 * s} ${x + half} ${bottom}L${x} ${top}Z`);
    out += path('a-pine', d`M${x - half} ${bottom}Q${x - half * 0.4} ${bottom + 1.6 * s} ${x} ${bottom + 1.8 * s}L${x} ${top}Z`);
    if (snowy) {
      const line = top + (bottom - top) * 0.42;
      const reach = half * 0.42;
      out += path('a-snow', d`M${x - reach} ${line}L${x} ${top}L${x + reach} ${line}Q${x + reach * 0.4} ${line - 1.4 * s} ${x} ${line + 0.6 * s}Q${x - reach * 0.5} ${line - 1.2 * s} ${x - reach} ${line}Z`);
    }
  }
  return out;
}

function frond(cls, x0, y0, x1, y1, width) {
  const length = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / length;
  const ny = (x1 - x0) / length;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 - length * 0.28;
  return path(cls, d`M${x0} ${y0}Q${cx + nx * width} ${cy + ny * width} ${x1} ${y1}Q${cx - nx * width} ${cy - ny * width} ${x0} ${y0}Z`);
}

function palm(x, y, s, lean) {
  const cx = x + 5 * s * lean;
  const cy = y - 24 * s;
  let out = shadow(x + 4 * s * lean, y, 11 * s, 3 * s)
    + path('a-palm-trunk', d`M${x - 2.2 * s} ${y}Q${x + 2 * s * lean - 1 * s} ${y - 13 * s} ${cx - 1.3 * s} ${cy}L${cx + 1.3 * s} ${cy + 0.6 * s}Q${x + 2 * s * lean + 1.6 * s} ${y - 12 * s} ${x + 2.2 * s} ${y}Z`);
  let rings = '';
  for (const t of [0.22, 0.46, 0.7]) {
    const px = x + (cx - x) * t * t;
    const py = y + (cy - y) * t;
    rings += d`M${px - 1.8 * s} ${py}Q${px} ${py + 1.2 * s} ${px + 1.8 * s} ${py}`;
  }
  out += path('a-palm-ring', rings);
  for (const [angle, length, cls] of [[-172, 14, 'a-leaf-dark'], [-8, 14, 'a-leaf-dark'], [-140, 12, 'a-leaf'], [-40, 12, 'a-leaf'], [-92, 9, 'a-leaf-light']]) {
    const radians = (angle * Math.PI) / 180;
    const tx = cx + Math.cos(radians) * length * s;
    const ty = cy + Math.sin(radians) * length * s + Math.abs(Math.cos(radians)) * 6 * s;
    out += frond(cls, cx, cy, tx, ty, 3.4 * s);
  }
  return out + circle('a-trunk-dark', cx - 1.4 * s, cy + 1.6 * s, 1.6 * s) + circle('a-trunk-dark', cx + 1.5 * s, cy + 1.9 * s, 1.6 * s);
}

function bush(x, y, s, berries) {
  let out = shadow(x, y, 10 * s, 2.8 * s)
    + circle('a-leaf-dark', x - 5 * s, y - 4 * s, 5 * s)
    + circle('a-leaf-dark', x + 5 * s, y - 4 * s, 5 * s)
    + circle('a-leaf-dark', x, y - 7.5 * s, 6 * s)
    + circle('a-leaf', x - 1.8 * s, y - 8 * s, 4.6 * s)
    + circle('a-leaf', x - 5.5 * s, y - 5 * s, 3 * s)
    + circle('a-leaf-light', x - 3 * s, y - 10 * s, 1.8 * s);
  if (berries) {
    out += [[3, -6], [-1, -3.5], [5.5, -3]].map(([dx, dy]) => circle('a-fruit', x + dx * s, y + dy * s, 1.2 * s)).join('');
  }
  return out;
}

const PETALS = ['a-petal', 'a-petal-2', 'a-petal-3', 'a-petal-4'];

function flower(x, y, cls, size) {
  return circle(cls, x - size, y, size) + circle(cls, x + size, y, size) + circle(cls, x, y - size, size)
    + circle(cls, x, y + size, size) + circle('a-heart', x, y, size * 0.8);
}

function flowers(x, y, rand) {
  let out = ellipse('a-tuft', x - 3, y + 0.8, 3, 1.1) + ellipse('a-tuft', x + 3.4, y - 0.4, 3, 1.1);
  for (const [dx, dy] of [[-4, -2], [3.4, -4], [0, 1]]) out += flower(x + dx, y + dy, PETALS[Math.floor(rand() * PETALS.length)], 1.6);
  return out;
}

function tuft(x, y, s, cls = 'a-tuft-line') {
  return path(cls, d`M${x - 3.5 * s} ${y}Q${x - 3.5 * s} ${y - 3.5 * s} ${x - 5.5 * s} ${y - 5.5 * s}M${x} ${y}Q${x - 0.2 * s} ${y - 5 * s} ${x + 0.8 * s} ${y - 7.5 * s}M${x + 3.5 * s} ${y}Q${x + 3.5 * s} ${y - 3.5 * s} ${x + 5.5 * s} ${y - 5.5 * s}`);
}

function rock(x, y, s, snowy = false) {
  let out = shadow(x, y, 9 * s, 2.6 * s)
    + path('a-rock-dark', d`M${x - 8.5 * s} ${y}Q${x - 9 * s} ${y - 6 * s} ${x - 3 * s} ${y - 9 * s}Q${x + 4 * s} ${y - 11.5 * s} ${x + 8 * s} ${y - 4 * s}Q${x + 9 * s} ${y - 1 * s} ${x + 8 * s} ${y}Z`)
    + path('a-rock', d`M${x - 7.6 * s} ${y - 1 * s}Q${x - 8 * s} ${y - 6 * s} ${x - 3 * s} ${y - 8.4 * s}Q${x + 2 * s} ${y - 10.2 * s} ${x + 4.5 * s} ${y - 7 * s}Q${x} ${y - 4 * s} ${x - 1 * s} ${y - 0.6 * s}Z`)
    + circle('a-rock-light', x - 3.6 * s, y - 6.4 * s, 1.3 * s);
  if (snowy) {
    out += path('a-snow', d`M${x - 5.5 * s} ${y - 7.4 * s}Q${x + 1 * s} ${y - 12 * s} ${x + 6.4 * s} ${y - 5.6 * s}Q${x + 2.4 * s} ${y - 7 * s} ${x} ${y - 6.2 * s}Q${x - 3 * s} ${y - 5.8 * s} ${x - 5.5 * s} ${y - 7.4 * s}Z`);
  }
  return out;
}

function house(x, y, s, roof) {
  return shadow(x + 1 * s, y, 13 * s, 3.4 * s)
    + rect('a-rock-dark', x + 3.5 * s, y - 22 * s, 2.8 * s, 6 * s)
    + rect('a-wall', x - 8 * s, y - 11 * s, 16 * s, 11 * s, 0.8 * s)
    + rect('a-wall-dark', x + 4 * s, y - 11 * s, 4 * s, 11 * s)
    + path(roof, d`M${x - 10.5 * s} ${y - 10 * s}L${x - 6.5 * s} ${y - 19.5 * s}H${x + 6.5 * s}L${x + 10.5 * s} ${y - 10 * s}Z`)
    + path('a-shade', d`M${x + 3 * s} ${y - 19.5 * s}H${x + 6.5 * s}L${x + 10.5 * s} ${y - 10 * s}H${x + 6 * s}Z`)
    + rect('a-wood-dark', x - 5.6 * s, y - 6.6 * s, 3.8 * s, 6.6 * s, 1 * s)
    + rect('a-window', x + 0.2 * s, y - 8.4 * s, 3.4 * s, 3.4 * s, 0.6 * s);
}

function hut(x, y, s) {
  return shadow(x, y, 12 * s, 3 * s)
    + rect('a-wall', x - 7 * s, y - 8.5 * s, 14 * s, 8.5 * s, 1.5 * s)
    + path('a-wood-dark', d`M${x - 2.4 * s} ${y}V${y - 4.5 * s}Q${x} ${y - 7.5 * s} ${x + 2.4 * s} ${y - 4.5 * s}V${y}Z`)
    + path('a-straw', d`M${x - 11.5 * s} ${y - 7 * s}Q${x - 4 * s} ${y - 20 * s} ${x} ${y - 22 * s}Q${x + 4 * s} ${y - 20 * s} ${x + 11.5 * s} ${y - 7 * s}Q${x} ${y - 9.5 * s} ${x - 11.5 * s} ${y - 7 * s}Z`)
    + path('a-straw-line', d`M${x - 5 * s} ${y - 9 * s}L${x - 1.5 * s} ${y - 18 * s}M${x + 1 * s} ${y - 9 * s}L${x + 1.5 * s} ${y - 19 * s}M${x + 6 * s} ${y - 8.6 * s}L${x + 3.5 * s} ${y - 17 * s}`);
}

function windmill(x, y) {
  const hy = y - 27;
  const blade = (angle) => `<path class="a-sail" transform="rotate(${angle} ${f(x)} ${f(hy)})" d="${d`M${x - 1.2} ${hy - 2}V${hy - 18}H${x + 4.2}V${hy - 4}Z`}"/>`;
  return shadow(x, y, 12, 3.4)
    + path('a-wall', d`M${x - 7.5} ${y}L${x - 4.6} ${y - 26}H${x + 4.6}L${x + 7.5} ${y}Z`)
    + path('a-wall-dark', d`M${x + 1.6} ${y - 26}H${x + 4.6}L${x + 7.5} ${y}H${x + 2.6}Z`)
    + rect('a-wood-dark', x - 2.2, y - 6.5, 4.4, 6.5, 1.2)
    + rect('a-window', x - 1.4, y - 17, 2.8, 3.2, 0.6)
    + path('a-roof', d`M${x - 6.4} ${y - 25}Q${x} ${y - 35} ${x + 6.4} ${y - 25}Z`)
    + `<g class="a-blades" style="transform-origin:${f(x)}px ${f(hy)}px">${[15, 105, 195, 285].map(blade).join('')}</g>`
    + circle('a-wood-dark', x, hy, 2);
}

function field(x, y, s, green) {
  const w = 34 * s;
  const h = 18 * s;
  let rows = '';
  for (let k = 1; k < 6; k += 1) {
    const t = (w * k) / 6;
    rows += d`M${x - w / 2 + 5 + t} ${y - h + 1.5}L${x - w / 2 - 5 + t} ${y - 1.5}`;
  }
  return path(green ? 'a-field-2' : 'a-field', d`M${x - w / 2 + 5} ${y - h}H${x + w / 2 + 5}L${x + w / 2 - 5} ${y}H${x - w / 2 - 5}Z`)
    + path(green ? 'a-field-2-line' : 'a-field-line', rows);
}

function duck(x, y) {
  return ellipse('a-duck', x, y, 3.2, 1.9) + circle('a-duck', x + 2.4, y - 2, 1.5)
    + path('a-beak', d`M${x + 3.7} ${y - 2.3}L${x + 5.4} ${y - 1.8}L${x + 3.7} ${y - 1.3}Z`)
    + circle('a-eye', x + 2.7, y - 2.4, 0.4);
}

function pond(x, y, s, withDuck = true) {
  const rx = 17 * s;
  const ry = 9 * s;
  return ellipse('a-bank', x, y, rx + 3, ry + 2.5)
    + ellipse('a-water', x, y, rx, ry)
    + ellipse('a-water-dark', x + 2, y + 1.5, rx * 0.66, ry * 0.5)
    + path('a-water-shine', d`M${x - rx * 0.6} ${y - ry * 0.3}Q${x - rx * 0.2} ${y - ry * 0.75} ${x + rx * 0.2} ${y - ry * 0.55}`)
    + circle('a-leaf', x + rx * 0.45, y + ry * 0.25, 2.3) + circle('a-leaf', x + rx * 0.62, y - ry * 0.08, 1.6)
    + (withDuck ? duck(x - rx * 0.25, y + ry * 0.2) : '');
}

function haystack(x, y, s) {
  return shadow(x, y, 9 * s, 2.6 * s)
    + path('a-straw', d`M${x - 7.5 * s} ${y}Q${x - 8 * s} ${y - 11 * s} ${x} ${y - 12 * s}Q${x + 8 * s} ${y - 11 * s} ${x + 7.5 * s} ${y}Z`)
    + path('a-straw-line', d`M${x - 4 * s} ${y - 2 * s}Q${x - 3 * s} ${y - 7 * s} ${x - 1 * s} ${y - 10 * s}M${x + 2 * s} ${y - 1.5 * s}Q${x + 3 * s} ${y - 6 * s} ${x + 4.5 * s} ${y - 8 * s}`);
}

function fence(x, y) {
  let out = shadow(x, y, 13, 1.8);
  for (const k of [-11, -3.5, 4, 11]) out += rect('a-wood-dark', x + k - 1, y - 9, 2, 9, 0.6);
  return out + rect('a-wood', x - 12.5, y - 7, 25, 1.8, 0.6) + rect('a-wood', x - 12.5, y - 3.6, 25, 1.8, 0.6);
}

function mushroom(x, y, s) {
  return shadow(x, y, 4 * s, 1.3 * s) + rect('a-wall', x - 1.3 * s, y - 4.5 * s, 2.6 * s, 4.5 * s, 1 * s)
    + path('a-roof', d`M${x - 4.6 * s} ${y - 3.6 * s}Q${x - 4.4 * s} ${y - 9.5 * s} ${x} ${y - 9.6 * s}Q${x + 4.4 * s} ${y - 9.5 * s} ${x + 4.6 * s} ${y - 3.6 * s}Z`)
    + circle('a-petal-2', x - 1.8 * s, y - 6.4 * s, 0.9 * s) + circle('a-petal-2', x + 1.9 * s, y - 7.2 * s, 0.8 * s);
}

function peak(x, y, s) {
  const w = 30 * s;
  const h = 46 * s;
  const tx = x - 3 * s;
  const top = y - h;
  const lx = tx + (x - w - tx) * 0.32;
  const rx = tx + (x + w - tx) * 0.32;
  const sy = top + h * 0.32;
  return path('a-mtn', d`M${x - w} ${y}L${tx} ${top}L${x + w} ${y}Z`)
    + path('a-mtn-dark', d`M${tx} ${top}L${x + w} ${y}H${x + 4 * s}Z`)
    + path('a-mtn-light', d`M${tx} ${top}L${x - w} ${y}H${x - w + 9 * s}Z`)
    + path('a-snow', d`M${tx} ${top}L${rx} ${sy}L${tx + 5 * s} ${sy - 3 * s}L${tx + 1.5 * s} ${sy + 1 * s}L${tx - 3 * s} ${sy - 3.5 * s}L${lx} ${sy}Z`)
    + path('a-snow-shade', d`M${tx} ${top}L${rx} ${sy}L${tx + 5 * s} ${sy - 3 * s}L${tx + 1.6 * s} ${top + 6 * s}Z`);
}

function cloud(x, y, s) {
  return `<g class="a-cloud">${ellipse('a-cloud-part', x, y, 15 * s, 4.6 * s)}${circle('a-cloud-part', x - 7 * s, y - 2.5 * s, 5.5 * s)}${circle('a-cloud-part', x + 1 * s, y - 5 * s, 7.5 * s)}${circle('a-cloud-part', x + 8.5 * s, y - 2 * s, 5 * s)}</g>`;
}

function bird(x, y) {
  return path('a-bird-line', d`M${x - 4} ${y}Q${x - 2} ${y - 2.6} ${x} ${y}Q${x + 2} ${y - 2.6} ${x + 4} ${y}`);
}

function wave(x, y) {
  return path('a-wave-line', d`M${x - 6} ${y}Q${x - 3} ${y - 2.6} ${x} ${y}Q${x + 3} ${y - 2.6} ${x + 6} ${y}`);
}

function boat(x, y) {
  return ellipse('a-foam', x, y + 1.2, 13, 2.2)
    + path('a-wood', d`M${x - 11} ${y - 5}H${x + 11}L${x + 7.5} ${y + 0.5}H${x - 7.5}Z`)
    + rect('a-wood-dark', x - 10.5, y - 3.5, 21, 1.1)
    + rect('a-wood-dark', x - 0.6, y - 22, 1.2, 17)
    + path('a-sail', d`M${x + 1.2} ${y - 21}V${y - 7}H${x + 10}Z`)
    + path('a-sail', d`M${x - 1.2} ${y - 18}V${y - 7}H${x - 7.5}Z`)
    + path('a-flag', d`M${x + 0.6} ${y - 22}L${x + 5} ${y - 20.6}L${x + 0.6} ${y - 19.2}Z`);
}

function pier(x, top, bottom) {
  let out = rect('a-wood-dark', x - 6.5, bottom - 3, 2.4, 6, 0.6) + rect('a-wood-dark', x + 4.1, bottom - 3, 2.4, 6, 0.6)
    + rect('a-wood', x - 5.5, top, 11, bottom - top, 1);
  for (let y = top + 3.5; y < bottom - 1; y += 3.8) out += rect('a-wood-dark', x - 5.5, y, 11, 0.8);
  return out;
}

function lighthouse(x, y) {
  const halfAt = (at) => 6.5 - ((y - 5 - at) / 33) * 2;
  const band = (top, bottom) => path('a-roof', d`M${x - halfAt(bottom)} ${bottom}L${x - halfAt(top)} ${top}H${x + halfAt(top)}L${x + halfAt(bottom)} ${bottom}Z`);
  return path('a-beam', d`M${x + 3} ${y - 43}L${x + 46} ${y - 54}V${y - 31}Z`)
    + path('a-beam', d`M${x - 3} ${y - 43}L${x - 46} ${y - 54}V${y - 31}Z`)
    + shadow(x, y, 15, 3.5)
    + path('a-rock-dark', d`M${x - 13} ${y}Q${x - 11} ${y - 7} ${x - 2} ${y - 8}Q${x + 10} ${y - 8} ${x + 13} ${y}Z`)
    + path('a-rock', d`M${x - 12} ${y - 0.6}Q${x - 10} ${y - 6.6} ${x - 2} ${y - 7.4}Q${x + 2} ${y - 7.4} ${x + 3} ${y - 6}Q${x - 4} ${y - 4} ${x - 6} ${y - 0.6}Z`)
    + path('a-wall', d`M${x - 6.5} ${y - 5}L${x - 4.5} ${y - 38}H${x + 4.5}L${x + 6.5} ${y - 5}Z`)
    + band(y - 17, y - 11) + band(y - 30, y - 24)
    + path('a-shade', d`M${x + 2} ${y - 38}H${x + 4.5}L${x + 6.5} ${y - 5}H${x + 3}Z`)
    + rect('a-wood-dark', x - 1.4, y - 9.5, 2.8, 4.5, 1)
    + rect('a-wood-dark', x - 7, y - 40, 14, 2.4, 0.8)
    + rect('a-window', x - 3.6, y - 46, 7.2, 6, 1)
    + path('a-roof', d`M${x - 5.4} ${y - 45.6}L${x} ${y - 52}L${x + 5.4} ${y - 45.6}Z`);
}

function castle(x, y) {
  let out = shadow(x, y, 36, 5);
  for (const tx of [x - 24, x + 24]) {
    out += rect('a-castle', tx - 6.5, y - 40, 13, 40) + rect('a-castle-dark', tx + 2, y - 40, 4.5, 40)
      + path('a-roof-2', d`M${tx - 8.5} ${y - 39}L${tx} ${y - 56}L${tx + 8.5} ${y - 39}Z`)
      + path('a-shade', d`M${tx} ${y - 56}L${tx + 8.5} ${y - 39}H${tx + 2}Z`)
      + rect('a-window', tx - 1.6, y - 31, 3.2, 5, 1.6);
  }
  out += rect('a-castle', x - 18, y - 26, 36, 26);
  for (let k = 0; k < 5; k += 1) out += rect('a-castle', x - 18 + k * 8, y - 30, 4.5, 4.5);
  out += rect('a-castle-dark', x + 9, y - 26, 9, 26)
    + rect('a-castle', x - 8.5, y - 44, 17, 18) + rect('a-castle-dark', x + 3, y - 44, 5.5, 18)
    + path('a-roof', d`M${x - 11} ${y - 43}L${x} ${y - 62}L${x + 11} ${y - 43}Z`)
    + path('a-shade', d`M${x} ${y - 62}L${x + 11} ${y - 43}H${x + 2.5}Z`)
    + rect('a-wood-dark', x - 0.5, y - 71, 1, 9)
    + path('a-flag', d`M${x + 0.5} ${y - 71}L${x + 8} ${y - 68.5}L${x + 0.5} ${y - 66}Z`)
    + rect('a-window', x - 2, y - 39, 4, 5, 2)
    + path('a-castle-door', d`M${x - 6} ${y}V${y - 9}Q${x} ${y - 16} ${x + 6} ${y - 9}V${y}Z`);
  return out;
}

function summit(x, y) {
  const s = 1.3;
  const tx = x - 3 * s;
  const top = y - 46 * s;
  return peak(x, y, s) + rect('a-wood-dark', tx - 0.6, top - 13, 1.2, 13.5)
    + path('a-flag', d`M${tx + 0.6} ${top - 13}L${tx + 9} ${top - 10.2}L${tx + 0.6} ${top - 7.4}Z`);
}

function tent(x, y) {
  return shadow(x, y, 14, 3)
    + path('a-tent', d`M${x - 12.5} ${y}L${x} ${y - 19}L${x + 12.5} ${y}Z`)
    + path('a-tent-dark', d`M${x} ${y - 19}L${x + 12.5} ${y}H${x + 3}Z`)
    + path('a-wood-dark', d`M${x - 4} ${y}L${x} ${y - 10}L${x + 3} ${y}Z`)
    + rect('a-wood-dark', x - 0.6, y - 22, 1.2, 4);
}

function campfire(x, y) {
  return shadow(x, y, 7, 2)
    + `<rect class="a-wood" x="${f(x - 6)}" y="${f(y - 2.4)}" width="12" height="2.6" rx="1.2" transform="rotate(-14 ${f(x)} ${f(y - 1)})"/>`
    + `<rect class="a-wood-dark" x="${f(x - 6)}" y="${f(y - 2.4)}" width="12" height="2.6" rx="1.2" transform="rotate(14 ${f(x)} ${f(y - 1)})"/>`
    + `<g class="a-flicker" style="transform-origin:${f(x)}px ${f(y - 2)}px">`
    + path('a-flame', d`M${x - 3.6} ${y - 2.4}Q${x - 4.2} ${y - 7} ${x} ${y - 12}Q${x + 4.2} ${y - 7} ${x + 3.6} ${y - 2.4}Z`)
    + path('a-flame-core', d`M${x - 1.8} ${y - 2.6}Q${x - 2} ${y - 5.5} ${x} ${y - 8}Q${x + 2} ${y - 5.5} ${x + 1.8} ${y - 2.6}Z`)
    + '</g>';
}

function snowMound(x, y, s) {
  return ellipse('a-snow-shade', x + 1 * s, y - 1.6 * s, 9 * s, 3.6 * s) + ellipse('a-snow', x, y - 2.4 * s, 8 * s, 3.4 * s);
}

function bridge({ x, y }) {
  let out = shadow(x, y + 17, 15, 2.4) + rect('a-wood', x - 12, y - 17, 24, 34, 2);
  for (let k = -14; k <= 13; k += 4) out += rect('a-wood-dark', x - 12, y + k, 24, 0.9);
  return out + rect('a-wood-dark', x - 14.5, y - 18, 3, 36, 1.5) + rect('a-wood-dark', x + 11.5, y - 18, 3, 36, 1.5)
    + rect('a-trunk-dark', x - 15.5, y - 20, 5, 5, 1.2) + rect('a-trunk-dark', x + 10.5, y - 20, 5, 5, 1.2)
    + rect('a-trunk-dark', x - 15.5, y + 15, 5, 5, 1.2) + rect('a-trunk-dark', x + 10.5, y + 15, 5, 5, 1.2);
}

function ropeBridge({ x, y }) {
  let out = '';
  for (let k = -16; k <= 13; k += 4.2) out += rect('a-wood', x - 11, y + k, 22, 3, 0.8);
  return out + path('a-rope', d`M${x - 13} ${y - 19}Q${x - 15} ${y} ${x - 13} ${y + 19}M${x + 13} ${y - 19}Q${x + 15} ${y} ${x + 13} ${y + 19}`)
    + rect('a-trunk-dark', x - 15, y - 22, 4, 6, 1) + rect('a-trunk-dark', x + 11, y - 22, 4, 6, 1)
    + rect('a-trunk-dark', x - 15, y + 17, 4, 6, 1) + rect('a-trunk-dark', x + 11, y + 17, 4, 6, 1);
}

/** 景色の部品。r は重ならないための半径、lift は足もとから半径の中心までの高さ。 */
const scaled = (rand) => 0.85 + rand() * 0.3;
const KINDS = {
  tree: { r: 11, lift: 14, scale: scaled, draw: (x, y, s, rand) => tree(x, y, s, rand() < 0.22) },
  pine: { r: 10.5, lift: 14, scale: scaled, draw: (x, y, s) => pine(x, y, s, false) },
  snowPine: { r: 10.5, lift: 14, scale: scaled, draw: (x, y, s) => pine(x, y, s, true) },
  palm: { r: 13, lift: 19, scale: scaled, draw: (x, y, s, rand) => palm(x, y, s, rand() < 0.5 ? -1 : 1) },
  bush: { r: 9, lift: 6, scale: scaled, draw: (x, y, s, rand) => bush(x, y, s, rand() < 0.3) },
  flowers: { r: 6, lift: 1, draw: (x, y, s, rand) => flowers(x, y, rand) },
  tuft: { r: 4.5, lift: 3, draw: (x, y) => tuft(x, y, 1) },
  dryTuft: { r: 4.5, lift: 3, draw: (x, y) => tuft(x, y, 1, 'a-tuft-dry-line') },
  rock: { r: 8, lift: 5, draw: (x, y) => rock(x, y, 1) },
  snowRock: { r: 8, lift: 5, draw: (x, y) => rock(x, y, 1, true) },
  boulder: { r: 12, lift: 5, draw: (x, y) => rock(x - 4, y, 1.25) + rock(x + 6, y + 1, 0.8) },
  mushroom: { r: 5, lift: 5, draw: (x, y) => mushroom(x, y, 1) },
  shell: { r: 3.5, lift: 1.5, draw: (x, y, s, rand) => (rand() < 0.5
    ? path('a-starfish', starPath(x, y - 2, 3.2, 1.3))
    : path('a-shell', d`M${x - 2.6} ${y}Q${x - 3} ${y - 3.6} ${x} ${y - 3.8}Q${x + 3} ${y - 3.6} ${x + 2.6} ${y}Z`)) },
  wave: { r: 6, lift: 1, draw: (x, y) => wave(x, y) },
  seaRock: { r: 9, lift: 4, draw: (x, y) => ellipse('a-foam', x, y, 9, 2.4) + rock(x, y, 0.8) },
  snowMound: { r: 8, lift: 2, draw: (x, y) => snowMound(x, y, 1) },
  hut: { r: 13, lift: 10, draw: (x, y) => hut(x, y, 1) },
  house: { r: 13, lift: 10, draw: (x, y, s, rand) => house(x, y, 1, ['a-roof', 'a-roof-2', 'a-roof-3'][Math.floor(rand() * 3)]) },
  windmill: { r: 22, lift: 22, draw: (x, y) => windmill(x, y) },
  pond: { r: 20, lift: 0, draw: (x, y) => pond(x, y, 1) },
  lake: { r: 22, lift: 0, draw: (x, y) => pond(x, y, 1.15, false) },
  field: { r: 21, lift: 9, draw: (x, y, s, rand) => field(x, y, 1, rand() < 0.5) },
  haystack: { r: 9, lift: 6, draw: (x, y) => haystack(x, y, 1) },
  fence: { r: 13, lift: 4, draw: (x, y) => fence(x, y) },
  peak: { r: 31, lift: 22, scale: (rand) => 0.85 + rand() * 0.25, draw: (x, y, s) => peak(x, y, s) },
  cloud: { r: 16, lift: 2, scale: scaled, draw: (x, y, s) => cloud(x, y, s) },
  bird: { r: 5, lift: 0, draw: (x, y) => bird(x, y) },
};

/** roll が小さい順に表を見て、最初に当てはまった部品を返す。どれにも当てはまらなければ何も置かない。 */
function pick(roll, table) {
  return table.find(([limit]) => roll < limit)?.[1] ?? null;
}

/* ---- 地面 ---- */

function roundedRect({ l, t, r, b }, radius, step) {
  const points = [];
  const line = (x0, y0, x1, y1, nx, ny) => {
    const count = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 0; k < count; k += 1) points.push({ x: x0 + ((x1 - x0) * k) / count, y: y0 + ((y1 - y0) * k) / count, nx, ny });
  };
  const arc = (cx, cy, from) => {
    const count = Math.max(2, Math.round((radius * Math.PI) / 2 / step));
    for (let k = 0; k < count; k += 1) {
      const angle = from + ((Math.PI / 2) * k) / count;
      points.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle), nx: Math.cos(angle), ny: Math.sin(angle) });
    }
  };
  line(l + radius, t, r - radius, t, 0, -1);
  arc(r - radius, t + radius, -Math.PI / 2);
  line(r, t + radius, r, b - radius, 1, 0);
  arc(r - radius, b - radius, 0);
  line(r - radius, b, l + radius, b, 0, 1);
  arc(l + radius, b - radius, Math.PI / 2);
  line(l, b - radius, l, t + radius, -1, 0);
  arc(l + radius, t + radius, Math.PI);
  return points;
}

/** 輪郭を外へ offset だけ広げ、波打たせた、閉じた形。 */
function blob(cls, outline, offset, seed) {
  const moved = outline.map((point, index) => {
    const k = offset + 2.6 * Math.sin(index * 0.9 + seed) + 1.6 * Math.sin(index * 0.37 + seed * 2);
    return { x: point.x + point.nx * k, y: point.y + point.ny * k };
  });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const first = mid(moved.at(-1), moved[0]);
  let value = d`M${first.x} ${first.y}`;
  moved.forEach((point, index) => {
    const next = mid(point, moved[(index + 1) % moved.length]);
    value += d`Q${point.x} ${point.y} ${next.x} ${next.y}`;
  });
  return path(cls, `${value}Z`);
}

/** 地面のところどころを明るく(暗く)して、草原にむらをつける。 */
function patches(rand, cls, count, width, height, inside = () => true) {
  let out = '';
  for (let made = 0, tries = 0; made < count && tries < count * 20; tries += 1) {
    const x = rand() * width;
    const y = rand() * height;
    if (!inside(x, y)) continue;
    out += ellipse(cls, x, y, 24 + rand() * 22, 10 + rand() * 9);
    made += 1;
  }
  return out;
}

function waveLine(y0, width, seed, amplitude = 7) {
  const points = [];
  for (let x = -20; x <= width + 20; x += 20) {
    points.push({ x, y: y0 + amplitude * Math.sin(x * 0.045 + seed) + amplitude * 0.5 * Math.sin(x * 0.11 + seed * 1.7) });
  }
  return points;
}

function band(cls, edgeCls, line, width, height) {
  const top = smoothPath(line);
  return path(cls, `${top}L${width + 20} ${height + 20}L-20 ${height + 20}Z`) + path(edgeCls, top);
}

function lineY(line, x) {
  const index = Math.min(Math.max(Math.floor((x + 20) / 20), 0), line.length - 2);
  const a = line[index];
  const b = line[index + 1];
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** 行と次の行の間を流れる川。外側の端から入り、折り返しの道の下をくぐって、反対の端へ出る。 */
function riverPoints(layout, pair) {
  const { cells, width } = layout;
  const lower = cells.filter((cell) => cell.row === pair);
  const upper = cells.filter((cell) => cell.row === pair + 1);
  if (lower.length < PER_ROW || upper.length < PER_ROW) return null;
  const at = (list, column) => list.find((cell) => cell.column === column);
  const turnRight = pair % 2 === 0;
  const mids = COLUMNS.map((_, column) => ({
    x: (at(lower, column).x + at(upper, column).x) / 2,
    y: (at(lower, column).y + at(upper, column).y) / 2,
  }));
  const ordered = turnRight ? mids : [...mids].reverse();
  [5, -4, 2, 0].forEach((wiggle, index) => { ordered[index].y += wiggle; });
  const last = lower.at(-1);
  const next = upper[0];
  const apex = {
    x: turnRight ? Math.max(last.x, next.x) + TURN_OUT : Math.min(last.x, next.x) - TURN_OUT,
    y: (last.y + next.y) / 2,
  };
  const far = turnRight ? -16 : width + 16;
  const beyond = turnRight ? width + 16 : -16;
  return { points: [{ x: far, y: ordered[0].y + 6 }, ...ordered, apex, { x: beyond, y: apex.y - 5 }], apex };
}

function addRiver(layout, pair, scene, space, rope) {
  const river = riverPoints(layout, pair);
  if (!river) return;
  const line = smoothPath(river.points);
  scene.back.push({ y: -1, svg: path('a-river-bank', line) + path('a-river', line) + path('a-river-shine', line) });
  for (const point of samplePath(river.points, 8)) space.add(point.x, point.y, 13.5, true);
  scene.bridges += rope ? ropeBridge(river.apex) : bridge(river.apex);
}

/* ---- 島ごとの景色 ---- */

const WORLDS = {
  /** はじまりの島。海に浮かぶ島で、入り江があり、スタートには桟橋と船、ゴールには灯台がある。 */
  island(layout, rand, space, scene) {
    const { width, height, cells } = layout;
    const box = { l: 8, t: 20, r: width - 8, b: height - 50 };
    const radius = 30;
    const rows = cells.at(-1).row + 1;
    const bays = [];
    for (let pair = 1; pair <= rows - 3; pair += 1) {
      const lower = cells[pair * PER_ROW];
      const upper = cells[(pair + 2) * PER_ROW - 1];
      if (lower && upper) bays.push({ side: pair % 2 === 0 ? -1 : 1, y: (lower.y + upper.y) / 2 });
    }
    const inward = (side, y) => bays
      .filter((bay) => bay.side === side)
      .reduce((sum, bay) => sum + 46 * Math.exp(-((y - bay.y) ** 2) / (2 * 19 ** 2)), 0);
    const outline = roundedRect(box, radius, 7).map((point) => {
      const k = point.nx < -0.99 ? inward(-1, point.y) : point.nx > 0.99 ? inward(1, point.y) : 0;
      return { ...point, x: point.x - point.nx * k };
    });
    const land = (x, y, margin) => {
      const left = box.l + inward(-1, y) + margin;
      const right = box.r - inward(1, y) - margin;
      if (x < left || x > right || y < box.t + margin || y > box.b - margin) return false;
      const cx = Math.min(Math.max(x, box.l + radius), box.r - radius);
      const cy = Math.min(Math.max(y, box.t + radius), box.b - radius);
      return Math.hypot(x - cx, y - cy) <= radius - margin;
    };
    scene.ground = rect('a-sea', 0, 0, width, height)
      + blob('a-shallow', outline, 9, 2.3) + blob('a-sand', outline, 0, 2.3) + blob('a-ground', outline, -8, 2.3)
      + patches(rand, 'a-ground-light', Math.round(height / 80), width, height, (x, y) => land(x, y, 44));

    const start = cells[0];
    scene.back.push({ y: height, svg: pier(start.x - 4, box.b - 10, height - 12) });
    scene.items.push({ y: height - 12, svg: boat(start.x + 27, height - 12) });
    space.add(start.x - 4, height - 34, 13, true);
    space.add(start.x + 27, height - 24, 14, true);

    const goal = cells.at(-1);
    scene.items.push({ y: goal.y - 22, svg: lighthouse(goal.x, goal.y - 22) });
    space.add(goal.x, goal.y - 50, 20, true);
    space.add(goal.x, goal.y - 28, 15, true);

    return {
      pieces: [
        { kind: KINDS.hut, count: 3, where: (x, y) => land(x, y, 18) },
        { kind: KINDS.seaRock, count: 3, where: (x, y) => !land(x, y, -16) },
        { kind: KINDS.bird, count: 3, layer: 'top', where: (x, y) => !land(x, y, -6) },
      ],
      choose(x, y, rand, grove) {
        if (!land(x, y, -10)) return rand() < 0.1 ? KINDS.wave : null;
        if (!land(x, y, 10)) return land(x, y, 1) && rand() < 0.1 ? KINDS.shell : null;
        const roll = rand();
        if (grove > 0.56) return pick(roll, [[0.34, KINDS.palm], [0.52, KINDS.bush], [0.64, KINDS.tuft], [0.72, KINDS.flowers]]);
        return pick(roll, [[0.15, KINDS.tuft], [0.27, KINDS.flowers], [0.33, KINDS.bush], [0.38, KINDS.palm], [0.41, KINDS.rock]]);
      },
    };
  },

  /** ひろい大陸。草原に森や村、畑、風車があり、川を橋で渡る。ゴールには城がある。 */
  land(layout, rand, space, scene) {
    const { width, height, cells } = layout;
    const rows = cells.at(-1).row + 1;
    scene.ground = rect('a-ground', 0, 0, width, height)
      + patches(rand, 'a-ground-light', Math.round(height / 60), width, height)
      + patches(rand, 'a-ground-dark', Math.round(height / 160), width, height);
    for (const pair of new Set([Math.round(rows * 0.28), Math.round(rows * 0.64)])) {
      if (pair >= 1 && pair <= rows - 3) addRiver(layout, pair, scene, space, false);
    }
    const goal = cells.at(-1);
    scene.items.push({ y: goal.y - 20, svg: castle(goal.x, goal.y - 20) });
    space.add(goal.x, goal.y - 48, 30, true);
    space.add(goal.x - 24, goal.y - 30, 14, true);
    space.add(goal.x + 24, goal.y - 30, 14, true);
    const start = cells[0];
    const nearStart = (x, y) => y > start.y - 20 && x < width - 30;
    return {
      pieces: [
        { kind: KINDS.house, count: 3, where: nearStart },
        { kind: KINDS.windmill, count: 2 },
        { kind: KINDS.pond, count: 2, layer: 'back' },
        { kind: KINDS.field, count: 4, layer: 'back' },
        { kind: KINDS.house, count: 4 },
        { kind: KINDS.haystack, count: 3 },
        { kind: KINDS.fence, count: 3 },
      ],
      choose(x, y, rand, grove) {
        const roll = rand();
        if (grove > 0.6) return pick(roll, [[0.48, KINDS.tree], [0.6, KINDS.pine], [0.76, KINDS.bush], [0.8, KINDS.mushroom], [0.88, KINDS.tuft]]);
        if (grove > 0.5) return pick(roll, [[0.16, KINDS.tree], [0.26, KINDS.bush], [0.4, KINDS.tuft], [0.52, KINDS.flowers]]);
        return pick(roll, [[0.18, KINDS.tuft], [0.32, KINDS.flowers], [0.36, KINDS.bush], [0.38, KINDS.rock], [0.41, KINDS.tree]]);
      },
    };
  },

  /** そびえる山々。ふもとの草原から岩場、雪の頂上へと登る。スタートにはテント、ゴールには旗の立つ頂上がある。 */
  mountain(layout, rand, space, scene) {
    const { width, height, cells } = layout;
    const rows = cells.at(-1).row + 1;
    const play = height - TOP - BOTTOM;
    const snowLine = waveLine(TOP + play * 0.36, width, 1.1);
    const meadowLine = waveLine(TOP + play * 0.68, width, 2.7);
    const zone = (x, y) => (y < lineY(snowLine, x) ? 'snow' : y < lineY(meadowLine, x) ? 'rock' : 'meadow');
    scene.ground = rect('a-snowland', 0, 0, width, height)
      + patches(rand, 'a-snowland-shade', Math.round(height / 220), width, TOP + play * 0.3)
      + band('a-rockland', 'a-rockland-edge', snowLine, width, height)
      + band('a-ground', 'a-ground-edge', meadowLine, width, height)
      + patches(rand, 'a-ground-light', Math.round(height / 200), width, height, (x, y) => zone(x, y) === 'meadow');
    if (rows >= 5) addRiver(layout, 1, scene, space, true);
    const start = cells[0];
    scene.items.push({ y: start.y + 44, svg: tent(start.x + 50, start.y + 44) });
    scene.items.push({ y: start.y + 50, svg: campfire(start.x + 80, start.y + 50) });
    space.add(start.x + 50, start.y + 34, 15, true);
    space.add(start.x + 80, start.y + 45, 9, true);
    const goal = cells.at(-1);
    scene.back.push({ y: goal.y - 14, svg: summit(goal.x, goal.y - 14) });
    space.add(goal.x - 4, goal.y - 50, 30, true);
    return {
      pieces: [
        { kind: KINDS.cloud, count: 3, layer: 'top', where: (x, y) => zone(x, y) === 'snow' && (x < 90 || x > width - 90) },
        { kind: KINDS.peak, count: rows + 2, layer: 'back', where: (x, y) => zone(x, y) !== 'meadow' },
        { kind: KINDS.lake, count: 1, layer: 'back', where: (x, y) => zone(x, y) === 'meadow' },
        { kind: KINDS.boulder, count: 3, where: (x, y) => zone(x, y) === 'rock' },
        { kind: KINDS.bird, count: 3, layer: 'top', where: (x, y) => zone(x, y) === 'snow' },
      ],
      choose(x, y, rand, grove) {
        const roll = rand();
        const here = zone(x, y);
        if (here === 'snow') {
          if (grove > 0.55) return pick(roll, [[0.42, KINDS.snowPine], [0.5, KINDS.snowRock], [0.6, KINDS.snowMound]]);
          return pick(roll, [[0.1, KINDS.snowPine], [0.15, KINDS.snowRock], [0.24, KINDS.snowMound]]);
        }
        if (here === 'rock') {
          if (grove > 0.55) return pick(roll, [[0.4, KINDS.pine], [0.54, KINDS.rock], [0.66, KINDS.dryTuft]]);
          return pick(roll, [[0.1, KINDS.rock], [0.18, KINDS.pine], [0.32, KINDS.dryTuft]]);
        }
        if (grove > 0.55) return pick(roll, [[0.32, KINDS.pine], [0.5, KINDS.tree], [0.6, KINDS.bush], [0.7, KINDS.tuft]]);
        return pick(roll, [[0.2, KINDS.tuft], [0.36, KINDS.flowers], [0.42, KINDS.tree], [0.48, KINDS.pine], [0.52, KINDS.bush]]);
      },
    };
  },
};

const SEEDS = { island: 1201, land: 2402, mountain: 3603 };

/* ---- 札 ---- */

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** 文字の幅の見積もり。全角は1文字分、半角は0.6文字分。 */
function textWidth(text, size) {
  return [...text].reduce((sum, character) => sum + (character.charCodeAt(0) < 256 ? 0.6 : 1), 0) * size;
}

function signWidth(text) {
  return textWidth(text, 10) + 14;
}

/** 木の札。(cx, cy) が板の中心。postTo があれば、そこまで1本の柱を立てる。 */
function sign(cx, cy, text, className, postTo = null) {
  const width = signWidth(text);
  const left = cx - width / 2;
  const posts = postTo === null
    ? rect('a-wood-dark', left + 6, cy + 6, 2.4, 6, 0.8) + rect('a-wood-dark', left + width - 8.4, cy + 6, 2.4, 6, 0.8)
    : rect('a-wood-dark', cx - 1.5, cy + 6, 3, postTo - cy - 6, 1);
  return `<g class="${className}">${posts}${rect('a-sign-edge', left, cy - 7, width, 16.5, 4)}${rect('a-sign', left, cy - 8.5, width, 15.5, 4)}${rect('a-sign-light', left + 4, cy - 7, width - 8, 1.2, 0.6)}<text class="a-sign-text" x="${f(cx)}" y="${f(cy + 3.4)}" text-anchor="middle" font-size="10">${escapeText(text)}</text></g>`;
}

function reserveSign(space, cx, cy, width) {
  for (let x = cx - width / 2 + 9; x <= cx + width / 2 - 9 + 0.1; x += 8) space.add(x, cy + 1, 10.5, true);
}

function signFits(space, cx, cy, width) {
  for (let x = cx - width / 2 + 9; x <= cx + width / 2 - 9 + 0.1; x += 8) {
    if (!space.free(x, cy + 1, 10.5, true)) return false;
  }
  return true;
}

/** 地域の名前の札を、地域の最初の場所の近くの空いたところに立てる。 */
function areaSign(space, cell, text) {
  const width = signWidth(text);
  const clamp = (x) => Math.min(Math.max(x, width / 2 + 6), WIDTH - width / 2 - 6);
  const options = [[0, 44], [0, -48], [-30, 44], [30, 44], [-30, -48], [30, -48], [0, 56], [0, -60]];
  const spot = options
    .map(([dx, dy]) => [clamp(cell.x + dx), cell.y + dy])
    .find(([x, y]) => signFits(space, x, y, width)) ?? [clamp(cell.x), cell.y + 44];
  reserveSign(space, spot[0], spot[1], width);
  return sign(spot[0], spot[1], text, 'adv-sign adv-area');
}

/* ---- 景色を組み立てる ---- */

function placePieces(scene, space, rand, layout, { kind, count, where = () => true, layer = 'items' }) {
  let placed = 0;
  for (let attempt = 0; attempt < 500 && placed < count; attempt += 1) {
    const x = 14 + rand() * (layout.width - 28);
    const y = 14 + rand() * (layout.height - 28);
    if (!where(x, y)) continue;
    const s = kind.scale ? kind.scale(rand) : 1;
    const cy = y - kind.lift * s;
    if (!space.free(x, cy, kind.r * s, true)) continue;
    space.add(x, cy, kind.r * s, true);
    scene[layer].push({ y, svg: kind.draw(x, y, s, rand) });
    placed += 1;
  }
}

/** 空いたところを、木や草花で埋める。先に大きなもの、次に小さなものを置く。 */
function fillScene(scene, space, rand, layout, world, seed) {
  const spacing = 12;
  const spots = [];
  for (let y = 4; y < layout.height; y += spacing) {
    for (let x = 4; x < layout.width; x += spacing) {
      spots.push([x + (rand() - 0.5) * spacing, y + (rand() - 0.5) * spacing]);
    }
  }
  shuffle(spots, rand);
  for (const big of [true, false]) {
    for (const [x, y] of spots) {
      const kind = world.choose(x, y, rand, smoothNoise(x, y, seed, 64));
      if (!kind || (kind.r >= 8) !== big) continue;
      const s = kind.scale ? kind.scale(rand) : 1;
      const cy = y - kind.lift * s;
      if (!space.free(x, cy, kind.r * s)) continue;
      space.add(x, cy, kind.r * s);
      scene.items.push({ y, svg: kind.draw(x, y, s, rand) });
    }
  }
}

const byDepth = (list) => list.sort((a, b) => a.y - b.y).map((item) => item.svg).join('');

function buildScene(region, layout) {
  const theme = WORLDS[region.theme] ? region.theme : 'land';
  const seed = SEEDS[theme] + layout.cells.length * 31;
  const rand = random(seed);
  const { cells } = layout;
  const space = new Space();
  const samples = samplePath(roadPoints(cells).points);
  for (const point of samples) space.add(point.x, point.y, ROAD_HALF + 2, true);
  for (const cell of cells.slice(1, -1)) space.add(cell.x, cell.y - 5, 28, true);

  let pebbles = '';
  samples.forEach((point, index) => {
    if (index % 3) return;
    const angle = rand() * Math.PI * 2;
    const reach = rand() * 6.5;
    pebbles += ellipse('a-pebble', point.x + Math.cos(angle) * reach, point.y + Math.sin(angle) * reach, 1.1 + rand() * 0.6, 0.8);
  });

  const scene = { ground: '', back: [], items: [], top: [], bridges: '' };
  const world = WORLDS[theme](layout, rand, space, scene);

  const start = cells[0];
  scene.top.push(sign(start.x, start.y - 34, 'スタート', 'adv-sign adv-start-sign', start.y + 1));
  reserveSign(space, start.x, start.y - 34, signWidth('スタート'));
  const goal = cells.at(-1);
  const goalWidth = signWidth('ゴール');
  const goalX = Math.min(Math.max(goal.x - goalSide(layout) * 50, goalWidth / 2 + 6), WIDTH - goalWidth / 2 - 6);
  scene.top.push(sign(goalX, goal.y - 4, 'ゴール', 'adv-sign adv-goal-sign', goal.y + 8));
  reserveSign(space, goalX, goal.y - 4, goalWidth);
  space.add(goal.x, goal.y - 12, 19, true);
  space.add(goal.x + goalSide(layout) * 30, goal.y - 18, 22, true);

  for (const place of region.places.filter((item) => item.areaStart)) scene.top.push(areaSign(space, cells[place.index + 1], place.area));
  for (const piece of world.pieces) placePieces(scene, space, rand, layout, piece);
  fillScene(scene, space, rand, layout, world, seed);

  return {
    ground: scene.ground,
    back: byDepth(scene.back),
    pebbles,
    bridges: scene.bridges,
    items: byDepth(scene.items),
    top: scene.top.map((item) => (typeof item === 'string' ? item : item.svg)).join(''),
  };
}

function goalChest(cell, open) {
  const { x, y } = cell;
  let out = shadow(x, y + 1, 18, 4);
  if (open) {
    out += circle('a-glow', x, y - 16, 24)
      + path('a-chest-lid', d`M${x - 14} ${y - 14}L${x - 12.5} ${y - 29}Q${x} ${y - 34} ${x + 12.5} ${y - 29}L${x + 14} ${y - 14}Z`)
      + rect('a-chest-in', x - 13, y - 17.5, 26, 4, 1.5);
  }
  out += rect('adv-chest a-chest', x - 14, y - 14, 28, 14, 2)
    + rect('a-chest-dark', x - 14, y - 7.6, 28, 1.2)
    + rect('a-metal', x - 14, y - 14, 3, 14, 1) + rect('a-metal', x + 11, y - 14, 3, 14, 1)
    + rect('a-metal', x - 3.2, y - 12.5, 6.4, 7, 1.4) + circle('a-chest-in', x, y - 9.6, 1);
  if (open) {
    out += ellipse('a-coin', x, y - 14.5, 12, 3.4)
      + circle('a-coin', x - 5, y - 16.5, 2.6) + circle('a-coin', x + 3.5, y - 17.4, 2.6) + circle('a-coin', x - 0.5, y - 19.4, 2.6)
      + circle('a-gem', x + 7.5, y - 16.2, 2)
      + `<g class="adv-shine"><path d="${d`M${x} ${y - 44}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z`}"/><path d="${d`M${x + 15} ${y - 36}l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z`}"/><path d="${d`M${x - 15} ${y - 33}l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z`}"/></g>`;
  } else {
    out += path('a-chest-lid', d`M${x - 14} ${y - 14}V${y - 19.5}Q${x} ${y - 29} ${x + 14} ${y - 19.5}V${y - 14}Z`)
      + rect('a-metal', x - 14, y - 15.6, 28, 1.8, 0.8)
      + rect('a-metal', x - 3.2, y - 18, 6.4, 4.4, 1.2);
  }
  return `<g class="adv-goal${open ? ' is-open' : ''}">${out}</g>`;
}

const sceneCache = new Map();

/**
 * 島の絵(地面、道、通った道、景色、札、スタートとゴール)。場所のボタンは別に重ねる。
 * すべての場所に旗が立つと、ゴールの宝箱が開く。
 * @param {{places: object[], theme: string}} region
 * @param {ReturnType<typeof boardLayout>} layout
 * @param {number} trailTo 通った道を、このマスまで塗る(場所の番号 + 1)。
 */
export function boardScene(region, layout, trailTo) {
  const { width, height, cells } = layout;
  const key = `${region.theme}|${cells.length}|${region.places.map((place) => (place.areaStart ? place.area : '')).join(',')}`;
  if (!sceneCache.has(key)) sceneCache.set(key, buildScene(region, layout));
  const scene = sceneCache.get(key);
  const road = roadPath(cells);
  return `<svg class="adv-scene" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
    ${scene.ground}
    ${scene.back}
    <path class="adv-road-edge" d="${road}"/>
    <path class="adv-road" d="${road}"/>
    <path class="adv-road-light" d="${road}"/>
    ${scene.pebbles}
    ${scene.bridges}
    <path class="adv-trail" d="${roadPath(cells, Math.min(trailTo, cells.length - 1))}"/>
    ${scene.items}
    ${goalChest(cells.at(-1), region.places.every((place) => place.flaggedOn))}
    ${scene.top}
  </svg>`;
}

/* ---- 場所の印 ---- */

const STAR_SPOTS = [[10, 6.8], [22, 3], [34, 6.8]];

/** 習熟度の星。未挑戦は白、練習中は銅、覚えかけは銀、マスターは金。 */
export function starSvg(state, size = 16) {
  return `<svg class="adv-star-icon" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false"><path class="adv-star is-${state}" d="${starPath(8, 8.6, 7, 3.1)}"/></svg>`;
}

/** 場所の印。上の3つの星が3問の習熟度で、旗が立てば石が金色になり、数字の代わりに旗を出す。 */
export function placeSvg(place) {
  const flagged = place.flaggedOn ? ' is-flagged' : '';
  const stars = place.questions
    .map(({ state }, index) => {
      const [x, y] = STAR_SPOTS[index % STAR_SPOTS.length];
      return `<path class="adv-star is-${state}" d="${starPath(x, y, 6.4, 2.9)}"/>`;
    })
    .join('');
  const middle = place.flaggedOn
    ? `<g class="adv-flag"><ellipse class="adv-flag-base" cx="19" cy="34.4" rx="4.5" ry="1.6"/><path class="adv-flag-pole" d="M19 34V14.5"/><path class="adv-flag-cloth" d="M20 14.8L31 19 20 23.2Z"/></g>`
    : `<text class="adv-number" x="22" y="29.6" text-anchor="middle">${place.index + 1}</text>`;
  return `<svg class="adv-place-svg" viewBox="0 0 44 44" width="44" height="44" aria-hidden="true" focusable="false">
    <circle class="adv-ring-back" cx="22" cy="25" r="21.5"/>
    <circle class="adv-ring" cx="22" cy="25" r="21.5"/>
    <ellipse class="adv-node-shadow" cx="22.5" cy="41" rx="17" ry="4.2"/>
    <circle class="adv-face-side${flagged}" cx="22" cy="28" r="16"/>
    <circle class="adv-face${flagged}" cx="22" cy="24.5" r="16"/>
    <ellipse class="adv-face-shine" cx="15.5" cy="17.5" rx="5.5" ry="2.6" transform="rotate(-32 15.5 17.5)"/>
    ${middle}
    ${stars}
  </svg>`;
}

/** 相棒を地図に出さない設定のときの、今いる場所の印。 */
export function markerSvg(size = 40) {
  return `<svg class="adv-marker" viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true" focusable="false">
    <path class="adv-marker-pin" d="M20 37C20 37 8 24 8 15.5A12 12 0 0 1 32 15.5C32 24 20 37 20 37Z"/>
    <circle class="adv-marker-dot" cx="20" cy="15.5" r="4.5"/>
  </svg>`;
}
