/**
 * 育つ相棒。
 *
 * 初回の回答1問ごとに1つ育ち、たまご → あかちゃん → こども → おとな と姿を変える。
 * こどもの姿は、たまごとあかちゃんの間の解き方で決まる(どのレベルを多く解いたか、文字で答えることが多いか)。
 * おとなの姿は、こどもの間の学び方で決まる。とくに条件のそろった子は、ひみつの姿になる。
 * 姿が変わるときは、まれにめずらしい色(色ちがい)になる。
 * 姿の決まり方は、育ててのお楽しみとして、一人前になるまで画面に出さない(app.js)。
 * 育った姿は戻さず、休んでも弱らない。一人前になったら新しいたまごを受け取れ、育てた相棒は「なかま」に残る。
 * 記録は progress.companion に置く。保存は呼び出す側が行う。
 */
import { addDays } from './review.js';

export const STAGES = ['egg', 'baby', 'child', 'adult'];
export const STAGE_LABELS = { egg: 'たまご', baby: 'あかちゃん', child: 'こども', adult: 'おとな' };
/** その段階になるまでの回答数(この相棒が来てからの数)。 */
export const STAGE_POINTS = { egg: 0, baby: 5, child: 50, adult: 150 };
/** 一人前になる回答数。新しいたまごを受け取れるようになる。 */
export const GROWN_POINTS = 300;
/** この時間までに話し始めた正解を、すばやい回答として数える。 */
export const FAST_MS = 4000;
/** 復習として数える学習の種類(今日の復習、苦手な問題、間違えた問題をもう一度)。 */
export const REVIEW_MODES = ['review', 'weak', 'missed'];
/** 姿が変わるときに、色ちがいになる確率。 */
export const RARE_CHANCE = 1 / 20;
/** 文字で答えた回答がこの割合以上なら、タッピになる。 */
const TYPED_SHARE = 0.6;
/** いちばん多いレベルでもこの割合に届かなければ、まんべんなく解いたとしてニャモになる。 */
const MAIN_LEVEL_SHARE = 0.5;
/** この数より多く答えた日を、たくさん答えた日として数える(ほのお)。 */
const BIG_DAY_ANSWERS = 30;
/** おとなの条件のうち、この数以上に届いたら、ひかりどりになる。 */
const LEGEND_GOALS = 4;
/** こどもの間に、3つのレベルをそれぞれこの数以上解いたら、にじくもになる。 */
const RAINBOW_EACH = 25;
export const NAME_MAX_LENGTH = 10;

/** こどもの姿。 */
export const SPECIES = {
  moko: { name: 'モコ', reason: '小学校の問題をたくさん解いた' },
  piko: { name: 'ピコ', reason: '中学校の問題をたくさん解いた' },
  gau: { name: 'ガウ', reason: '高校の問題をたくさん解いた' },
  nyamo: { name: 'ニャモ', reason: '3つのレベルの問題を、まんべんなく解いた' },
  tappi: { name: 'タッピ', reason: '文字で答えることが多かった' },
};
const LEVEL_SPECIES = { 1: 'moko', 2: 'piko', 3: 'gau' };

/**
 * おとなの姿。こどもの間の学び方で決まり、こどもの姿と組み合わせて名前がつく。
 * goal に届いたものの中で、届き方(goal に対する割合)がいちばん大きいものになる。どれにも届かなければ breeze。
 * 並び順は、同じ大きさだったときに選ぶ順。
 */
export const VARIANTS = {
  sun: { name: 'おひさま', goal: 5, reason: '毎日続けて学習した' },
  forest: { name: 'もりの', goal: 30, reason: '復習をがんばった' },
  bolt: { name: 'いなずま', goal: 30, reason: 'すばやく答えた' },
  flame: { name: 'ほのお', goal: 2, reason: '1日にたくさんの問題に答えた' },
  gem: { name: 'ほうせき', goal: 90, reason: 'たくさん正解した' },
  breeze: { name: 'そよかぜ', goal: null, reason: 'のびのび学習した' },
};

/** ひみつの姿。こどもの姿に関係なく、条件がそろったときだけなる。 */
export const SECRETS = {
  hikari: { name: 'ひかりどり', reason: 'いろいろな学び方を、どれもがんばった' },
  niji: { name: 'にじくも', reason: '3つのレベルの問題を、どれもたくさん解いた' },
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GENERATION = 10_000;
const MAX_POINTS = 10_000_000;
const MAX_FRIENDS = 1_000;
const MAX_NEWS = 20;
/** 図鑑の記録で、色ちがいに会ったことを表す ID の後ろの印。 */
export const RARE_SUFFIX = ':rare';

function adultId(species, variant) {
  return variant in SECRETS ? variant : `${species}-${variant}`;
}

/** 図鑑に並べる姿。並び順のまま表示する。 */
export const FORMS = [
  { id: 'egg', stage: 'egg', name: 'たまご' },
  { id: 'baby', stage: 'baby', name: 'ころん' },
  ...Object.entries(SPECIES).map(([species, { name }]) => ({ id: species, stage: 'child', species, name })),
  ...Object.entries(SPECIES).flatMap(([species, { name }]) => Object.entries(VARIANTS).map(([variant, info]) => ({
    id: adultId(species, variant), stage: 'adult', species, variant, name: `${info.name}${name}`,
  }))),
  ...Object.entries(SECRETS).map(([variant, { name }]) => ({ id: variant, stage: 'adult', variant, secret: true, name })),
];

const FORM_BY_ID = new Map(FORMS.map((form) => [form.id, form]));

export function formById(id) {
  return FORM_BY_ID.get(id) ?? null;
}

function emptyCounts() {
  return { levels: { 1: 0, 2: 0, 3: 0 }, review: 0, fast: 0, typed: 0, correct: 0 };
}

/** この世代の記録を、新しいたまごの状態にする。図鑑、なかま、表示の設定は残す。 */
function resetGeneration(companion, today) {
  Object.assign(companion, {
    points: 0,
    stage: 'egg',
    species: null,
    variant: null,
    rare: false,
    name: '',
    born: today,
    since: today,
    grownOn: null,
    counts: emptyCounts(),
  });
  companion.seen.egg ??= today;
}

export function newCompanion(today) {
  const companion = { generation: 1, news: [], seen: {}, friends: [], hidden: false };
  resetGeneration(companion, today);
  return companion;
}

/** 今の姿の ID。 */
export function formId(companion) {
  if (companion.stage === 'child') return companion.species;
  if (companion.stage === 'adult') return adultId(companion.species, companion.variant);
  return companion.stage;
}

export function formName(companion) {
  return formById(formId(companion))?.name ?? '';
}

/** 画面に出す名前。名前をつけていなければ、姿の名前。 */
export function displayName(companion) {
  return companion.name || formName(companion);
}

/**
 * こどもの姿。文字で答えることが多ければタッピ。
 * そうでなければ、いちばん多く解いたレベルの姿(同じ数なら低いレベル)。そのレベルでも半分に届かなければニャモ。
 */
export function chooseSpecies(counts) {
  const { levels } = counts;
  const total = (levels[1] ?? 0) + (levels[2] ?? 0) + (levels[3] ?? 0);
  if (total === 0) return 'moko';
  if (counts.typed / total >= TYPED_SHARE) return 'tappi';
  let best = 1;
  for (const level of [2, 3]) {
    if ((levels[level] ?? 0) > (levels[best] ?? 0)) best = level;
  }
  return levels[best] / total < MAIN_LEVEL_SHARE ? 'nyamo' : LEVEL_SPECIES[best];
}

/** since から today までの間で、続けて学習したいちばん長い日数。 */
export function longestRun(days, since, today) {
  let best = 0;
  let run = 0;
  for (let day = since; day <= today; day = addDays(day, 1)) {
    run = (days[day] ?? 0) > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** since から today までの間で、たくさん答えた日の数。 */
export function bigDays(days, since, today) {
  let count = 0;
  for (let day = since; day <= today; day = addDays(day, 1)) {
    if ((days[day] ?? 0) >= BIG_DAY_ANSWERS) count += 1;
  }
  return count;
}

/** こどもの間の学び方を、おとなの姿の条件ごとに数える。 */
export function habitMeasures(companion, days, today) {
  return {
    sun: longestRun(days, companion.since, today),
    forest: companion.counts.review,
    bolt: companion.counts.fast,
    flame: bigDays(days, companion.since, today),
    gem: companion.counts.correct,
  };
}

/** 学び方から決まる、おとなの姿。届いた条件がなければ breeze。 */
export function chooseVariant(measures) {
  let best = 'breeze';
  let bestScore = 1;
  for (const [variant, { goal }] of Object.entries(VARIANTS)) {
    if (goal === null) continue;
    const score = (measures[variant] ?? 0) / goal;
    if (score >= bestScore && (best === 'breeze' || score > bestScore)) {
      best = variant;
      bestScore = score;
    }
  }
  return best;
}

/** おとなの姿。ひみつの姿の条件を先に見る。 */
export function chooseAdult(measures, levels) {
  const reached = Object.entries(VARIANTS)
    .filter(([variant, { goal }]) => goal !== null && (measures[variant] ?? 0) >= goal).length;
  if (reached >= LEGEND_GOALS) return 'hikari';
  if ([1, 2, 3].every((level) => (levels[level] ?? 0) >= RAINBOW_EACH)) return 'niji';
  return chooseVariant(measures);
}

function evolve(companion, stage, today, random) {
  const from = formId(companion);
  companion.stage = stage;
  companion.rare = random() < RARE_CHANCE;
  const to = formId(companion);
  companion.seen[to] ??= today;
  if (companion.rare) companion.seen[to + RARE_SUFFIX] ??= today;
  return { kind: 'evolve', from, to, day: today, ...(companion.rare ? { rare: true } : {}) };
}

/**
 * 初回の回答を1問ぶん与えて育てる。
 * @param {object} companion progress.companion
 * @param {{ level: number, mode: string, fast: boolean, spoken: boolean, correct: boolean }} answer
 *   fast は、声で FAST_MS 以内に話し始めて正解したとき true。spoken は声で答えたとき true。
 * @param {{ today: string, days: Record<string, number>, random?: () => number }} context
 *   days は学習した日ごとの回答数。random は色ちがいを決めるのに使う。
 * @returns {object[]} この回答で起きた出来事(姿が変わった、一人前になった)。companion.news にも残す。
 */
export function feedCompanion(companion, { level, mode, fast, spoken, correct }, { today, days, random = Math.random }) {
  const { counts } = companion;
  companion.points = Math.min(companion.points + 1, MAX_POINTS);
  if (level in counts.levels) counts.levels[level] += 1;
  if (REVIEW_MODES.includes(mode)) counts.review += 1;
  if (fast) counts.fast += 1;
  if (!spoken) counts.typed = (counts.typed ?? 0) + 1;
  if (correct) counts.correct = (counts.correct ?? 0) + 1;

  const events = [];
  if (companion.stage === 'egg' && companion.points >= STAGE_POINTS.baby) {
    events.push(evolve(companion, 'baby', today, random));
  }
  if (companion.stage === 'baby' && companion.points >= STAGE_POINTS.child) {
    companion.species = chooseSpecies(companion.counts);
    events.push({ ...evolve(companion, 'child', today, random), reason: SPECIES[companion.species].reason });
    companion.counts = emptyCounts();
    companion.since = today;
  }
  if (companion.stage === 'child' && companion.points >= STAGE_POINTS.adult) {
    companion.variant = chooseAdult(habitMeasures(companion, days, today), companion.counts.levels);
    const info = SECRETS[companion.variant] ?? VARIANTS[companion.variant];
    events.push({ ...evolve(companion, 'adult', today, random), reason: info.reason });
    companion.counts = emptyCounts();
    companion.since = today;
  }
  if (companion.stage === 'adult' && companion.points >= GROWN_POINTS && !companion.grownOn) {
    companion.grownOn = today;
    events.push({ kind: 'grown', from: formId(companion), to: formId(companion), day: today });
  }
  companion.news.push(...events);
  companion.news = companion.news.slice(-MAX_NEWS);
  return events;
}

/** まだ画面で知らせていない出来事を取り出す。 */
export function takeNews(companion) {
  const news = companion.news;
  companion.news = [];
  return news;
}

/** 一人前になって、新しいたまごを受け取れるか。 */
export function canReceiveEgg(companion) {
  return companion.stage === 'adult' && Boolean(companion.grownOn);
}

/** 育てた相棒をなかまに加え、新しいたまごを受け取る。 */
export function receiveEgg(companion, today) {
  if (!canReceiveEgg(companion)) return false;
  companion.friends.push({
    form: formId(companion),
    species: companion.species,
    rare: companion.rare,
    name: companion.name,
    born: companion.born,
    grown: companion.grownOn,
    generation: companion.generation,
  });
  companion.friends = companion.friends.slice(-MAX_FRIENDS);
  companion.generation = Math.min(companion.generation + 1, MAX_GENERATION);
  companion.news = [];
  resetGeneration(companion, today);
  return true;
}

/**
 * 次の段階までの進み具合。一人前になっていれば null。
 * @returns {{ next: string, remaining: number, ratio: number }|null} next は次の段階('baby' など)か 'grown'。
 */
export function nextStep(companion) {
  if (companion.grownOn) return null;
  const order = [...STAGES, 'grown'];
  const next = order[order.indexOf(companion.stage) + 1];
  const start = STAGE_POINTS[companion.stage];
  const goal = next === 'grown' ? GROWN_POINTS : STAGE_POINTS[next];
  const remaining = Math.max(goal - companion.points, 0);
  return { next, remaining, ratio: Math.min(Math.max((companion.points - start) / (goal - start), 0), 1) };
}

/* 記録の読み込み(backup.js)で使う。手で書き換えたファイルも読めるよう、使える値だけを取り出す。 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value, max = MAX_POINTS) {
  return Number.isInteger(value) && value >= 0 ? Math.min(value, max) : 0;
}

function day(value) {
  return typeof value === 'string' && DAY_PATTERN.test(value) ? value : null;
}

function readName(value) {
  return typeof value === 'string' ? value.trim().slice(0, NAME_MAX_LENGTH) : '';
}

function readEvent(event) {
  if (!isPlainObject(event) || !['evolve', 'grown'].includes(event.kind)) return null;
  if (!formById(event.from) || !formById(event.to) || !day(event.day)) return null;
  const entry = { kind: event.kind, from: event.from, to: event.to, day: event.day };
  if (event.rare === true) entry.rare = true;
  if (typeof event.reason === 'string' && event.reason.length <= 40) entry.reason = event.reason;
  return entry;
}

function readFriend(friend) {
  const form = isPlainObject(friend) ? formById(friend.form) : null;
  if (form?.stage !== 'adult' || !day(friend.born) || !day(friend.grown)) return null;
  // ひみつの姿は、どのこどもから育ったかを記録に持つ。
  const species = form.species ?? (friend.species in SPECIES ? friend.species : null);
  if (!species) return null;
  return {
    form: friend.form,
    species,
    rare: friend.rare === true,
    name: readName(friend.name),
    born: friend.born,
    grown: friend.grown,
    generation: Math.max(count(friend.generation, MAX_GENERATION), 1),
  };
}

function readSeen(source) {
  const seen = {};
  if (!isPlainObject(source)) return seen;
  for (const [id, seenOn] of Object.entries(source)) {
    if (formById(id.replace(RARE_SUFFIX, '')) && day(seenOn)) seen[id] = seenOn;
  }
  return seen;
}

/**
 * 書き出したファイルの相棒の記録を読む。
 * @returns {object|null} 使えなければ null(読み込んだ側で新しいたまごにする)。
 */
export function readCompanion(source) {
  if (!isPlainObject(source) || !STAGES.includes(source.stage)) return null;
  const { stage } = source;
  const needsSpecies = stage === 'child' || stage === 'adult';
  const species = needsSpecies && source.species in SPECIES ? source.species : null;
  const variant = stage === 'adult' && (source.variant in VARIANTS || source.variant in SECRETS) ? source.variant : null;
  if ((needsSpecies && !species) || (stage === 'adult' && !variant)) return null;
  const born = day(source.born);
  const since = day(source.since) ?? born;
  if (!born || !since) return null;

  const counts = isPlainObject(source.counts) ? source.counts : {};
  const levels = isPlainObject(counts.levels) ? counts.levels : {};
  const companion = {
    generation: Math.max(count(source.generation, MAX_GENERATION), 1),
    points: Math.max(count(source.points), STAGE_POINTS[stage]),
    stage,
    species,
    variant,
    rare: stage !== 'egg' && source.rare === true,
    name: readName(source.name),
    born,
    since,
    grownOn: stage === 'adult' ? day(source.grownOn) : null,
    counts: {
      levels: { 1: count(levels[1]), 2: count(levels[2]), 3: count(levels[3]) },
      review: count(counts.review),
      fast: count(counts.fast),
      typed: count(counts.typed),
      correct: count(counts.correct),
    },
    news: Array.isArray(source.news) ? source.news.map(readEvent).filter(Boolean).slice(-MAX_NEWS) : [],
    seen: readSeen(source.seen),
    friends: Array.isArray(source.friends) ? source.friends.map(readFriend).filter(Boolean).slice(-MAX_FRIENDS) : [],
    hidden: source.hidden === true,
  };
  if (companion.grownOn === null && stage === 'adult' && companion.points >= GROWN_POINTS) companion.grownOn = since;
  companion.seen[formId(companion)] ??= since;
  if (companion.rare) companion.seen[formId(companion) + RARE_SUFFIX] ??= since;
  return companion;
}
