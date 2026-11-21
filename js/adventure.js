/**
 * 冒険の地図。
 *
 * 文法マップの105項目を、レベルごとの島に並んだ「場所」として扱う。
 * 3問ともマスターした場所に旗を立て、相棒は、まだ旗のない最初の場所に立つ。
 * 旗は、あとで間違えてマスターが外れても抜かない(育ったものは減らさない)。
 * 地図に最後に出した相棒の位置と、まだ地図で見せていない旗を覚えておき、次に開いたときに動きで見せる。
 */

export const REGIONS = {
  1: { name: 'はじまりの島', theme: 'island' },
  2: { name: 'ひろい大陸', theme: 'land' },
  3: { name: 'そびえる山々', theme: 'mountain' },
};

/** 場所をまとめる地域。上から順に見て、最初に当てはまったものにする。 */
const AREA_RULES = [
  [/^(単文|平叙文|命令文|疑問文|重文|複文|感嘆文)/, '文の種類'],
  [/^関係/, '関係詞'],
  [/^代名詞/, '代名詞'],
  [/^接続詞/, '接続詞'],
  [/^助動詞/, '助動詞'],
  [/前置詞/, '前置詞'],
  [/^(現在|過去|未来)/, '時制'],
  [/^比較/, '比較'],
  [/^(to不定詞|動名詞)/, '不定詞と動名詞'],
  [/^分詞/, '分詞'],
  [/^受け身/, '受け身'],
  [/^仮定法/, '仮定法'],
  [/^it/, 'itの使い方'],
  [/^(主語|There|It|知覚動詞)/, '文の組み立て'],
];
const OTHER_AREA = 'いろいろな表現';
const KEY_PATTERN = /^[123]\|.{1,80}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function areaOf(pattern) {
  return AREA_RULES.find(([rule]) => rule.test(pattern))?.[1] ?? OTHER_AREA;
}

export function placeKey(level, pattern) {
  return `${level}|${pattern}`;
}

export function emptyAdventure() {
  return {
    /** 旗を立てた場所と、立てた日。キーは「レベル|文法項目」。 */
    flags: {},
    /** 旗を立てたが、まだ地図で見せていない場所。 */
    unseen: [],
    /** レベルごとに、地図に最後に出した相棒の位置(場所の番号。0から数え、場所の数ならゴール)。 */
    at: {},
  };
}

/**
 * 文法マップ(review.js の grammarMap)から、島ごとの場所を作る。
 * @returns {{level: number, name: string, theme: string, places: object[], flags: number, frontier: number}[]}
 *   frontier は、まだ旗のない最初の場所の番号。すべてに旗があれば places.length(ゴール)。
 */
export function adventureRegions(map, adventure) {
  return map.map(({ level, items }) => {
    let previousArea = null;
    const places = items.map((item, index) => {
      const key = placeKey(level, item.pattern);
      const area = areaOf(item.pattern);
      const place = {
        index,
        key,
        level,
        pattern: item.pattern,
        area,
        areaStart: area !== previousArea,
        questions: item.questions,
        mastered: item.questions.filter(({ state }) => state === 'mastered').length,
        complete: item.complete,
        flaggedOn: adventure.flags[key] ?? null,
      };
      previousArea = area;
      return place;
    });
    const frontier = places.findIndex((place) => !place.flaggedOn);
    return {
      level,
      ...(REGIONS[level] ?? { name: `レベル${level}`, theme: 'land' }),
      places,
      flags: places.filter((place) => place.flaggedOn).length,
      frontier: frontier === -1 ? places.length : frontier,
    };
  });
}

/**
 * 3問ともマスターした場所のうち、まだ旗のない場所に旗を立てる。
 * @returns {{level: number, pattern: string, key: string}[]} 今回立てた旗。
 */
export function plantFlags(adventure, map, today) {
  const planted = [];
  for (const { level, items } of map) {
    for (const item of items) {
      const key = placeKey(level, item.pattern);
      if (!item.complete || adventure.flags[key]) continue;
      adventure.flags[key] = today;
      if (!adventure.unseen.includes(key)) adventure.unseen.push(key);
      planted.push({ level, pattern: item.pattern, key });
    }
  }
  return planted;
}

/** 旗を抜く。「正解にする」を取り消して、その回に立てた旗の条件が外れたときだけ使う。 */
export function removeFlag(adventure, key) {
  delete adventure.flags[key];
  adventure.unseen = adventure.unseen.filter((item) => item !== key);
}

/** 旗のある場所の数。 */
export function flagCount(adventure, knownKeys = null) {
  return Object.keys(adventure.flags).filter((key) => !knownKeys || knownKeys.has(key)).length;
}

/**
 * 地図を開いたときに見せる動き。見せたものは覚えて、次からは出さない。
 * @returns {{from: number, to: number, newFlags: string[]}} from から to へ相棒が進み、newFlags の旗が立つ。
 */
export function takeMapMoves(adventure, region) {
  const known = new Set(region.places.map((place) => place.key));
  const newFlags = adventure.unseen.filter((key) => known.has(key));
  adventure.unseen = adventure.unseen.filter((key) => !known.has(key));
  const stored = adventure.at[region.level];
  const from = Number.isInteger(stored) ? Math.min(Math.max(stored, 0), region.places.length) : 0;
  adventure.at[region.level] = region.frontier;
  return { from, to: region.frontier, newFlags };
}

/** 読み込んだ記録の冒険の地図から、使える値だけを取り出す。使えなければ null(地図を開いたときに作り直す)。 */
export function readAdventure(source) {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return null;
  const adventure = emptyAdventure();
  if (typeof source.flags === 'object' && source.flags !== null && !Array.isArray(source.flags)) {
    for (const [key, day] of Object.entries(source.flags)) {
      if (KEY_PATTERN.test(key) && typeof day === 'string' && DAY_PATTERN.test(day)) adventure.flags[key] = day;
    }
  }
  if (Array.isArray(source.unseen)) {
    adventure.unseen = [...new Set(source.unseen.filter((key) => typeof key === 'string' && adventure.flags[key]))];
  }
  if (typeof source.at === 'object' && source.at !== null && !Array.isArray(source.at)) {
    for (const level of ['1', '2', '3']) {
      const value = source.at[level];
      if (Number.isInteger(value) && value >= 0 && value <= 200) adventure.at[level] = value;
    }
  }
  return adventure;
}
