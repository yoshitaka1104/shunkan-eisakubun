/**
 * 相棒の絵。姿ごとに SVG の文字列を返す。絵はこのアプリのために描いたもの。
 * 色は姿の一部なので、画面の明るさの設定では変えない。輪郭は濃い茶色で、明るい地にも暗い地にも浮かぶ。
 * おとなの姿は、こどもの体の形に、学び方で決まる色と飾りを重ねて描く。ひみつの姿は、それぞれ別に描く。
 * 色ちがいは、体の色の色相を回して描き、まわりに小さな星を添える。
 */

const OUT = '#3d2f2b';
const LINE = 2.6;
const n = (value) => Math.round(value * 10) / 10;

/** 形を1つの輪郭で囲む。太い線で描いた上に同じ形を塗り、内側の線を隠す。 */
function outlined(shapes, fill) {
  return `<g fill="${fill}" stroke="${OUT}" stroke-width="${LINE * 2}" stroke-linejoin="round">${shapes}</g><g fill="${fill}">${shapes}</g>`;
}

/** 形ごとに輪郭を描く。 */
function stroked(shapes, fill, width = LINE) {
  return `<g fill="${fill}" stroke="${OUT}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round">${shapes}</g>`;
}

/** 太い線で描く、しっぽや手。 */
function tube(d, color) {
  return `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="11" stroke-linecap="round"/>`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="5.8" stroke-linecap="round"/>`;
}

/** 点の列を左右反転する(x を 120 − x にする)。 */
function mirrorPath(d) {
  return d.replace(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g, (_, x, y) => `${n(120 - Number(x))} ${y}`);
}

function shadow(rx) {
  return `<ellipse class="c-shadow" cx="60" cy="111" rx="${rx}" ry="4.5"/>`;
}

function face(cx, cy, s = 1, { mouth = true } = {}) {
  const eye = (x) => `<g class="c-eye"><ellipse cx="${n(x)}" cy="${n(cy)}" rx="${n(3.4 * s)}" ry="${n(4.3 * s)}" fill="${OUT}"/>`
    + `<circle cx="${n(x + 1.1 * s)}" cy="${n(cy - 1.6 * s)}" r="${n(1.3 * s)}" fill="#fff"/></g>`;
  const cheek = (x) => `<ellipse cx="${n(x)}" cy="${n(cy + 6.5 * s)}" rx="${n(4.4 * s)}" ry="${n(2.7 * s)}" fill="#ff8c9e" opacity="0.55"/>`;
  const smile = mouth
    ? `<path d="M${n(cx - 4 * s)} ${n(cy + 5.5 * s)}Q${n(cx)} ${n(cy + 10 * s)} ${n(cx + 4 * s)} ${n(cy + 5.5 * s)}" fill="none" stroke="${OUT}" stroke-width="2.2" stroke-linecap="round"/>`
    : '';
  return eye(cx - 9 * s) + eye(cx + 9 * s) + cheek(cx - 16.5 * s) + cheek(cx + 16.5 * s) + smile;
}

/** ねこの口とひげ。 */
function catFace(cx, cy, s = 1) {
  const y = cy + 6 * s;
  const whisker = (side) => `<path d="M${n(cx + side * 13 * s)} ${n(y - 1)}L${n(cx + side * 24 * s)} ${n(y - 3)}M${n(cx + side * 13 * s)} ${n(y + 2)}L${n(cx + side * 24 * s)} ${n(y + 4)}" stroke="${OUT}" stroke-width="1.5" stroke-linecap="round"/>`;
  return `${face(cx, cy, s, { mouth: false })}
    <path d="M${n(cx - 2.2 * s)} ${n(y - 2.6 * s)}H${n(cx + 2.2 * s)}L${cx} ${n(y - 0.6 * s)}Z" fill="#ff8c9e"/>
    <path d="M${n(cx - 4.5 * s)} ${n(y)}Q${n(cx - 2.2 * s)} ${n(y + 3.2 * s)} ${cx} ${n(y)}Q${n(cx + 2.2 * s)} ${n(y + 3.2 * s)} ${n(cx + 4.5 * s)} ${n(y)}" fill="none" stroke="${OUT}" stroke-width="2" stroke-linecap="round"/>
    ${whisker(-1)}${whisker(1)}`;
}

function circles(list) {
  return list.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`).join('');
}

function star(x, y, r, fill, width = 1.6) {
  return `<path d="M${x} ${y - r}L${n(x + r * 0.3)} ${n(y - r * 0.3)}L${x + r} ${y}L${n(x + r * 0.3)} ${n(y + r * 0.3)}L${x} ${y + r}L${n(x - r * 0.3)} ${n(y + r * 0.3)}L${x - r} ${y}L${n(x - r * 0.3)} ${n(y - r * 0.3)}Z" fill="${fill}" stroke="${OUT}" stroke-width="${width}" stroke-linejoin="round"/>`;
}

function crest(cx, baseY, length, spread, width) {
  const feather = `M${cx} ${baseY}C${cx - width} ${baseY - length * 0.45} ${cx - width * 0.8} ${baseY - length * 0.8} ${cx} ${baseY - length}`
    + `C${cx + width * 0.8} ${baseY - length * 0.8} ${cx + width} ${baseY - length * 0.45} ${cx} ${baseY}Z`;
  return [-spread, 0, spread].map((angle) => `<path d="${feather}" transform="rotate(${angle} ${cx} ${baseY})"/>`).join('');
}

function dragonTail(d, color, tip) {
  return `<path d="${d}" fill="none" stroke="${OUT}" stroke-width="11" stroke-linecap="round"/>`
    + `${stroked(`<path d="${tip}"/>`, color)}`
    + `<path d="${d}" fill="none" stroke="${color}" stroke-width="5.8" stroke-linecap="round"/>`;
}

function belly(cx, cy, rx, ry, fill, stripe) {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`
    + `<path d="M${cx - rx + 5} ${cy - 2}Q${cx} ${cy + 1.5} ${cx + rx - 5} ${cy - 2}M${cx - rx + 6} ${cy + 4}Q${cx} ${cy + 7.5} ${cx + rx - 6} ${cy + 4}" fill="none" stroke="${stripe}" stroke-width="2" stroke-linecap="round"/>`;
}

/** 手に持ったえんぴつ。(x, y) を持つところにして、angle だけ傾ける。 */
function pencil(x, y, angle, s = 1) {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${s})">
    ${stroked('<rect x="-4" y="-3" width="5" height="6" rx="1"/>', '#ff9fb0', 1.6)}
    ${stroked('<rect x="1" y="-3" width="18" height="6"/>', '#ffd84a', 1.6)}
    ${stroked('<path d="M19 -3L26 0L19 3Z"/>', '#f6d4a8', 1.6)}
    <path d="M24 -0.9L26 0L24 0.9Z" fill="${OUT}"/></g>`;
}

const BEAK = '#ffb347';
const SPOT = '#ffcb70';

/* 色ちがいの色。色相を回し、彩りを少し上げる。 */

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = (index) => (index + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const channel = (index) => {
    const value = l - a * Math.max(-1, Math.min(k(index) - 3, 9 - k(index), 1));
    return Math.round(value * 255).toString(16).padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

function rareColor(hex) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex((h + 150) % 360, Math.min(s * 1.1, 1), l);
}

function rarePalette(palette) {
  return Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, rareColor(value)]));
}

/** 色ちがいのしるし。まわりに小さな星を添える。 */
function rareMarks() {
  return `<g class="c-rare">${star(13, 98, 4.5, '#fff', 1.4)}${star(107, 94, 3.6, '#fff', 1.4)}${star(104, 14, 4, '#fff', 1.4)}</g>`;
}

/* たまご、あかちゃん、こどもの姿。p は色を受け取る。 */

const EGG_SHELL = 'M60 20C80 20 92 52 92 73C92 94 78 106 60 106C42 106 28 94 28 73C28 52 40 20 60 20Z';

function egg({ cracked }) {
  const crack = cracked
    ? `<path d="M36 66L44 60L50 67L57 58L64 66L71 58L78 65L84 61" fill="none" stroke="${OUT}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`
    : '';
  return `${shadow(26)}<g class="c-egg">${outlined(`<path d="${EGG_SHELL}"/>`, '#fff5df')}
    <circle cx="46" cy="56" r="6.5" fill="${SPOT}"/><circle cx="71" cy="42" r="5" fill="${SPOT}"/>
    <circle cx="74" cy="82" r="8" fill="${SPOT}"/><circle cx="46" cy="90" r="4.5" fill="${SPOT}"/>
    <circle cx="60" cy="70" r="3" fill="${SPOT}"/>${crack}</g>`;
}

const CHILD_PALETTES = {
  baby: { body: '#ffe27a', dark: '#ffc94a' },
  moko: { body: '#ffc3ad', dark: '#f7a58a' },
  piko: { body: '#8ad8cc', dark: '#69c3b6' },
  gau: { body: '#bba8f2', dark: '#9e8ae6', light: '#efe9ff', stripe: '#c9bbf4' },
  nyamo: { body: '#f6d7a4', dark: '#e3ad66', light: '#fff4e0', ear: '#f4a3a0' },
  tappi: { body: '#ffadc0', dark: '#f0869f', light: '#ffe3ea' },
};

function baby(p) {
  return `${shadow(24)}<g class="c-bob">
    ${outlined('<ellipse cx="49" cy="106" rx="7" ry="4"/><ellipse cx="71" cy="106" rx="7" ry="4"/>', p.dark)}
    ${outlined('<circle cx="60" cy="82" r="25"/>', p.body)}
    ${face(60, 88, 0.9)}
    ${stroked('<path d="M33 72C33 50 45 40 60 40C75 40 87 50 87 72L80 65.5L73.5 73L67 65.5L60 73L53 65.5L46.5 73L40 65.5Z"/>', '#fff5df')}
    <circle cx="50" cy="53" r="3.6" fill="${SPOT}"/><circle cx="69" cy="49" r="3" fill="${SPOT}"/></g>`;
}

function mokoChild(p) {
  const puffs = circles([[60, 80, 24], [40, 87, 15], [80, 87, 15], [45, 66, 14], [75, 66, 14], [60, 58, 15]]);
  return `${shadow(30)}<g class="c-bob">
    ${outlined('<ellipse cx="48" cy="104" rx="6.5" ry="4"/><ellipse cx="72" cy="104" rx="6.5" ry="4"/>', p.dark)}
    ${outlined(puffs, p.body)}
    <path d="M56 45C53 36 63 33 65 39" fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linecap="round"/>
    ${face(60, 79)}</g>`;
}

function pikoChild(p) {
  return `${shadow(26)}<g class="c-bob">
    ${outlined('<ellipse cx="51" cy="105" rx="5" ry="3"/><ellipse cx="69" cy="105" rx="5" ry="3"/>', BEAK)}
    ${outlined(`${crest(60, 54, 20, 28, 5)}<ellipse cx="60" cy="77" rx="25" ry="27"/>`, p.body)}
    ${stroked('<ellipse cx="35" cy="80" rx="8" ry="14" transform="rotate(18 35 80)"/><ellipse cx="85" cy="80" rx="8" ry="14" transform="rotate(-18 85 80)"/>', p.dark)}
    <ellipse cx="60" cy="92" rx="14" ry="9.5" fill="#fff" opacity="0.5"/>
    ${face(60, 72, 0.95, { mouth: false })}
    ${stroked('<path d="M54.5 80.5Q60 77.5 65.5 80.5L60 87.5Z"/>', BEAK, 2)}</g>`;
}

function gauChild(p) {
  const wing = 'M40 70L24 56L27 67L19 70L36 80Z';
  const horn = 'M47 60L44 43L56 55Z';
  return `${shadow(28)}<g class="c-bob">
    ${dragonTail('M80 96Q98 100 101 85', p.body, 'M96 86L101 74L107 86Z')}
    ${stroked(`<path d="${wing}"/><path d="${mirrorPath(wing)}"/>`, p.dark)}
    ${stroked(`<path d="${horn}"/><path d="${mirrorPath(horn)}"/>`, '#fff1c9')}
    ${outlined('<ellipse cx="48" cy="106" rx="7" ry="4"/><ellipse cx="72" cy="106" rx="7" ry="4"/>', p.body)}
    ${outlined('<ellipse cx="60" cy="81" rx="26" ry="25"/>', p.body)}
    ${belly(60, 93, 15, 9.5, p.light, p.stripe)}
    ${face(60, 77)}</g>`;
}

function nyamoChild(p) {
  const ear = 'M40 67L39 43L56 56Z';
  const inner = 'M43.5 61L43 50L51 56.5Z';
  return `${shadow(28)}<g class="c-bob">
    ${tube('M80 97C96 101 103 89 97 78', p.body)}
    ${outlined(`<path d="${ear}"/><path d="${mirrorPath(ear)}"/><ellipse cx="48" cy="106" rx="7" ry="4"/><ellipse cx="72" cy="106" rx="7" ry="4"/><ellipse cx="60" cy="81" rx="26" ry="25"/>`, p.body)}
    <path d="${inner}" fill="${p.ear}"/><path d="${mirrorPath(inner)}" fill="${p.ear}"/>
    <ellipse cx="60" cy="95" rx="13" ry="8" fill="${p.light}"/>
    <path d="M55 59L56 64M60 58V63M65 59L64 64" stroke="${p.dark}" stroke-width="2.4" stroke-linecap="round"/>
    ${catFace(60, 79)}</g>`;
}

function tappiChild(p) {
  const legs = [[41, 100, -16], [53, 103, -5], [67, 103, 5], [79, 100, 16]]
    .map(([x, y, angle]) => `<ellipse cx="${x}" cy="${y}" rx="6" ry="8" transform="rotate(${angle} ${x} ${y})"/>`).join('');
  return `${shadow(28)}<g class="c-bob">
    ${outlined(`${legs}<ellipse cx="60" cy="74" rx="27" ry="27"/>`, p.body)}
    <circle cx="47" cy="59" r="3.5" fill="${p.light}"/><circle cx="68" cy="54" r="4.5" fill="${p.light}"/><circle cx="77" cy="65" r="2.6" fill="${p.light}"/>
    ${face(60, 80, 0.95)}
    ${pencil(84, 98, -58)}</g>`;
}

/*
 * おとなの姿。p は色(body・dark・light)を受け取る。
 * anchors は飾りの位置。top は葉、flame は炎、forehead は宝石、scarf はマフラー [y, 左端, 右端]、
 * sparks は星や火の粉、bolt はいなずまのしるし。
 */
const ADULT_BODIES = {
  moko: {
    anchors: { top: [60, 32], flame: [60, 31], forehead: [60, 60], scarf: [92, 36, 84], sparks: [[24, 40], [96, 38]], bolt: [60, 96] },
    draw: (p) => {
      const puffs = circles([[60, 78, 28], [33, 84, 17], [87, 84, 17], [38, 62, 16], [82, 62, 16], [60, 50, 19], [48, 96, 14], [72, 96, 14]]);
      return `${outlined(puffs, p.body)}
        <path d="M55 33C52 24 62 20 65 26" fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linecap="round"/>
        ${face(60, 75, 1.12)}`;
    },
  },
  piko: {
    anchors: { top: [76, 47], flame: [60, 22], forehead: [60, 57], scarf: [94, 37, 83], sparks: [[20, 22], [100, 22]], bolt: [60, 97] },
    draw: (p) => {
      const wing = 'M38 70C24 70 12 60 10 44C18 50 22 50 26 49C20 43 20 37 22 31C30 40 37 50 44 58Z';
      return `${outlined('<ellipse cx="50" cy="106" rx="6" ry="3.5"/><ellipse cx="70" cy="106" rx="6" ry="3.5"/>', BEAK)}
        ${stroked(`<path d="${wing}"/><path d="${mirrorPath(wing)}"/>`, p.dark)}
        ${outlined(`${crest(60, 50, 32, 30, 7)}<ellipse cx="60" cy="76" rx="28" ry="29"/>`, p.body)}
        <ellipse cx="60" cy="94" rx="16" ry="10" fill="${p.light}" opacity="0.8"/>
        ${face(60, 70, 1.05, { mouth: false })}
        ${stroked('<path d="M53.5 79Q60 75.5 66.5 79L60 88Z"/>', BEAK, 2)}`;
    },
  },
  gau: {
    anchors: { top: [60, 55], flame: [60, 53], forehead: [60, 63], scarf: [95, 35, 85], sparks: [[22, 20], [98, 20]], bolt: [60, 97] },
    draw: (p) => {
      const wing = 'M40 64L14 40L18 56L6 60L18 68L10 78L38 84Z';
      const horn = 'M46 58C38 48 37 36 41 26C45 36 51 44 56 51Z';
      return `${dragonTail('M82 98Q104 104 107 86', p.body, 'M101 88L107 72L113 88Z')}
        ${stroked(`<path d="${wing}"/><path d="${mirrorPath(wing)}"/>`, p.dark)}
        ${stroked(`<path d="${horn}"/><path d="${mirrorPath(horn)}"/>`, '#fff1c9')}
        ${outlined('<ellipse cx="47" cy="107" rx="8" ry="4.5"/><ellipse cx="73" cy="107" rx="8" ry="4.5"/>', p.body)}
        ${outlined('<ellipse cx="60" cy="80" rx="29" ry="27"/>', p.body)}
        ${belly(60, 95, 17, 10, p.light, p.dark)}
        ${face(60, 76, 1.1)}`;
    },
  },
  nyamo: {
    anchors: { top: [60, 53], flame: [60, 52], forehead: [60, 63], scarf: [95, 34, 86], sparks: [[18, 26], [102, 26]], bolt: [60, 97] },
    draw: (p) => {
      const ear = 'M36 63L32 30L56 50Z';
      const inner = 'M40 57L37.5 39L51 50.5Z';
      return `${tube('M84 98C108 104 113 80 101 70', p.body)}
        ${outlined(`<path d="${ear}"/><path d="${mirrorPath(ear)}"/><ellipse cx="46" cy="107" rx="8" ry="4.5"/><ellipse cx="74" cy="107" rx="8" ry="4.5"/><ellipse cx="60" cy="79" rx="30" ry="28"/>`, p.body)}
        <path d="${inner}" fill="${p.light}"/><path d="${mirrorPath(inner)}" fill="${p.light}"/>
        <ellipse cx="60" cy="96" rx="16" ry="9" fill="${p.light}"/>
        ${catFace(60, 76, 1.1)}`;
    },
  },
  tappi: {
    anchors: { top: [60, 39], flame: [60, 39], forehead: [60, 55], scarf: [93, 32, 88], sparks: [[18, 24], [102, 24]], bolt: [60, 51] },
    draw: (p) => {
      const legs = [[29, 92, -48], [41, 101, -24], [54, 105, -7], [66, 105, 7], [79, 101, 24], [91, 92, 48]]
        .map(([x, y, angle]) => `<ellipse cx="${x}" cy="${y}" rx="6.5" ry="10" transform="rotate(${angle} ${x} ${y})"/>`).join('');
      return `${outlined(`${legs}<ellipse cx="60" cy="66" rx="32" ry="29"/>`, p.body)}
        <circle cx="42" cy="52" r="4" fill="${p.light}"/><circle cx="74" cy="46" r="5" fill="${p.light}"/><circle cx="84" cy="60" r="3" fill="${p.light}"/>
        ${face(60, 72, 1.1)}
        ${pencil(92, 94, -62, 1.2)}`;
    },
  },
};

const PALETTES = {
  sun: { body: '#ffcf6e', dark: '#f2a93b', light: '#fff3d6' },
  forest: { body: '#a6dd8e', dark: '#7cc466', light: '#f0fae8' },
  bolt: { body: '#aebdff', dark: '#8598f0', light: '#eef1ff' },
  flame: { body: '#ffa184', dark: '#ef7a56', light: '#fff0e9' },
  gem: { body: '#ffb8da', dark: '#f28fc0', light: '#fff0f7' },
  breeze: { body: '#a9e3f2', dark: '#79cbe3', light: '#eefbff' },
};

/** 体の後ろに描く飾り。 */
const BACK_ACCESSORIES = {
  sun: () => {
    const rays = [-90, -60, -30, 0, 30, 150, 180, 210, 240].map((degrees) => {
      const point = (radius, offset) => {
        const angle = ((degrees + offset) * Math.PI) / 180;
        return `${n(60 + radius * Math.cos(angle))} ${n(70 + radius * Math.sin(angle))}`;
      };
      return `<path d="M${point(41, -8)}L${point(55, 0)}L${point(41, 8)}Z"/>`;
    }).join('');
    return `<g class="c-rays"><circle cx="60" cy="70" r="42" fill="#ffe39a" opacity="0.55"/>${stroked(rays, '#ffb238', 2)}</g>`;
  },
};

function diamond(x, y, r, fill, width = 1.8) {
  return stroked(`<path d="M${x} ${y - r}L${n(x + r * 0.85)} ${y}L${x} ${y + r}L${n(x - r * 0.85)} ${y}Z"/>`, fill, width);
}

/** 体の前に描く飾り。 */
const FRONT_ACCESSORIES = {
  forest: ({ top: [x, y] }) => `
    <path d="M${x} ${y}C${x} ${y - 4} ${x} ${y - 7} ${x} ${y - 10}" fill="none" stroke="${OUT}" stroke-width="2.4" stroke-linecap="round"/>
    ${stroked(`<path d="M${x} ${y - 8}C${x - 3} ${y - 17} ${x - 12} ${y - 19} ${x - 17} ${y - 14}C${x - 12} ${y - 9} ${x - 5} ${y - 7} ${x} ${y - 8}Z"/>`
      + `<path d="M${x} ${y - 9}C${x + 4} ${y - 20} ${x + 14} ${y - 22} ${x + 19} ${y - 15}C${x + 13} ${y - 10} ${x + 6} ${y - 8} ${x} ${y - 9}Z"/>`, '#5fb85a', 2)}
    ${stroked('<path d="M24 111L27 102L30 108L33 100L36 111Z"/><path d="M84 111L87 100L90 108L93 102L96 111Z"/>', '#7cc466', 1.8)}`,
  bolt: ({ bolt: [x, y], sparks }) => `
    ${stroked(`<path d="M${x + 3} ${y - 11}L${x - 6} ${y + 1}L${x - 0.5} ${y + 1}L${x - 3} ${y + 11}L${x + 7} ${y - 2}L${x + 1.5} ${y - 2}L${x + 5} ${y - 11}Z"/>`, '#ffd84a', 2)}
    ${sparks.map(([sx, sy], index) => star(sx, sy, index ? 6 : 7, '#ffd84a')).join('')}`,
  flame: ({ flame: [x, y], sparks }) => `
    ${stroked(`<path d="M${x} ${y + 2}C${x - 11} ${y - 2} ${x - 10} ${y - 14} ${x - 3} ${y - 22}C${x - 3} ${y - 15} ${x + 2} ${y - 14} ${x + 3} ${y - 20}C${x + 11} ${y - 13} ${x + 11} ${y - 1} ${x} ${y + 2}Z"/>`, '#ff7a3d', 2)}
    <path d="M${x} ${y - 1}C${x - 5} ${y - 3} ${x - 5} ${y - 9} ${x - 1} ${y - 13}C${x} ${y - 9} ${x + 3} ${y - 9} ${x + 3} ${y - 12}C${x + 6} ${y - 7} ${x + 5} ${y - 2} ${x} ${y - 1}Z" fill="#ffd84a"/>
    ${sparks.map(([sx, sy], index) => `<circle cx="${sx}" cy="${sy + 8}" r="${index ? 2.6 : 3.2}" fill="#ffb238" stroke="${OUT}" stroke-width="1.4"/>`).join('')}`,
  gem: ({ forehead: [x, y], sparks }) => `
    ${diamond(x, y, 7, '#7fdcff')}
    <path d="M${x} ${y - 7}L${n(x + 5.95)} ${y}L${x} ${y}Z" fill="#fff" opacity="0.6"/>
    ${sparks.map(([sx, sy], index) => diamond(sx, sy, 5, index ? '#ff9fd0' : '#b8a4ff', 1.5)).join('')}`,
  breeze: ({ scarf: [y, x0, x1] }) => `
    ${stroked(`<path d="M${x1 - 12} ${y + 5}L${x1 - 6} ${y + 21}L${x1 + 2} ${y + 18}L${x1 - 3} ${y + 4}Z"/>`
      + `<path d="M${x0} ${y - 4}Q60 ${y + 3} ${x1} ${y - 4}L${x1} ${y + 4}Q60 ${y + 11} ${x0} ${y + 4}Z"/>`, '#ff8a8a', 2.2)}
    <path d="M6 22C13 15 24 18 21 25C19 29 13 27 15 23M98 16C105 9 116 12 113 19C111 23 105 21 107 17" fill="none" stroke="#79cbe3" stroke-width="2.6" stroke-linecap="round"/>`,
};

function adult(species, variant, rare) {
  const body = ADULT_BODIES[species];
  const palette = rare ? rarePalette(PALETTES[variant]) : PALETTES[variant];
  const back = BACK_ACCESSORIES[variant]?.(body.anchors) ?? '';
  const front = FRONT_ACCESSORIES[variant]?.(body.anchors) ?? '';
  return `${shadow(32)}${back}<g class="c-bob">${body.draw(palette)}${front}</g>`;
}

/* ひみつの姿 */

const SECRET_PALETTES = {
  niji: { body: '#ffffff', dark: '#dfe6ff', light: '#f4f7ff' },
  hikari: { body: '#ffd95a', dark: '#f5a524', light: '#fff4c7' },
};
/** 白い体は色相を回しても変わらないので、色ちがいの色を決めておく。 */
const RARE_SECRET_PALETTES = {
  niji: { body: '#ffd6ec', dark: '#f5b5d6', light: '#fff0f8' },
};

const SECRET_DRAWINGS = {
  niji: (p) => {
    const arcs = ['#ff8a8a', '#ffc46b', '#ffe27a', '#8fd88a', '#86b8ff', '#b49cff']
      .map((color, index) => {
        const r = 54 - index * 5;
        return `<path d="M${60 - r} 90A${r} ${r} 0 0 1 ${60 + r} 90" fill="none" stroke="${color}" stroke-width="5"/>`;
      }).join('');
    const puffs = circles([[60, 80, 24], [36, 86, 15], [84, 86, 15], [44, 68, 14], [76, 68, 14], [60, 60, 16], [48, 98, 12], [72, 98, 12]]);
    return `${shadow(30)}<g>${arcs}</g><g class="c-bob">
      ${outlined(puffs, p.body)}
      <ellipse cx="60" cy="98" rx="20" ry="7" fill="${p.dark}" opacity="0.7"/>
      ${face(60, 80, 1.05)}
      ${star(60, 43, 8, '#ffd84a', 1.8)}</g>`;
  },
  hikari: (p) => {
    const wing = 'M38 70C22 72 8 60 6 40C14 47 19 47 24 46C17 39 17 31 20 24C29 35 36 48 44 58Z';
    const tail = 'M52 99C38 101 24 96 12 82C15 100 34 111 56 106Z';
    return `${shadow(30)}<g class="c-bob">
      ${stroked(`<path d="${tail}"/><path d="${mirrorPath(tail)}"/>`, p.dark)}
      ${stroked(`<path d="${wing}"/><path d="${mirrorPath(wing)}"/>`, p.dark)}
      <ellipse cx="60" cy="14" rx="14" ry="4" fill="none" stroke="${OUT}" stroke-width="6"/>
      <ellipse cx="60" cy="14" rx="14" ry="4" fill="none" stroke="#ffe27a" stroke-width="2.6"/>
      ${outlined('<ellipse cx="51" cy="106" rx="5.5" ry="3.2"/><ellipse cx="69" cy="106" rx="5.5" ry="3.2"/>', BEAK)}
      ${outlined(`${crest(60, 48, 28, 26, 6)}<ellipse cx="60" cy="75" rx="26" ry="28"/>`, p.body)}
      <ellipse cx="60" cy="93" rx="15" ry="9.5" fill="${p.light}" opacity="0.9"/>
      ${face(60, 70, 1.05, { mouth: false })}
      ${stroked('<path d="M54 78.5Q60 75 66 78.5L60 87Z"/>', '#ff9a3c', 2)}
      ${star(22, 92, 4.5, '#fff7c2', 1.4)}${star(98, 88, 4, '#fff7c2', 1.4)}</g>`;
  },
};

function secret(variant, rare) {
  const palette = rare
    ? RARE_SECRET_PALETTES[variant] ?? rarePalette(SECRET_PALETTES[variant])
    : SECRET_PALETTES[variant];
  return SECRET_DRAWINGS[variant](palette);
}

const CHILD_DRAWINGS = {
  baby,
  moko: mokoChild,
  piko: pikoChild,
  gau: gauChild,
  nyamo: nyamoChild,
  tappi: tappiChild,
};

/**
 * 姿の SVG。
 * @param {string} id companion.js の姿の ID('egg'、'moko'、'moko-sun'、'niji' など)
 * @param {{ size?: number, cracked?: boolean, rare?: boolean }} [options]
 *   cracked は、かえる直前のたまごにひびを入れる。rare は色ちがいで描く。
 */
export function companionSvg(id, { size = 96, cracked = false, rare = false } = {}) {
  let art;
  if (id === 'egg') {
    art = egg({ cracked });
  } else if (id in SECRET_DRAWINGS) {
    art = secret(id, rare);
  } else if (id.includes('-')) {
    const [species, variant] = id.split('-');
    art = adult(species, variant, rare);
  } else {
    const palette = rare ? rarePalette(CHILD_PALETTES[id]) : CHILD_PALETTES[id];
    art = CHILD_DRAWINGS[id](palette);
  }
  if (rare && id !== 'egg') art += rareMarks();
  return `<svg class="companion-svg" viewBox="0 0 120 120" width="${size}" height="${size}" aria-hidden="true" focusable="false">${art}</svg>`;
}
