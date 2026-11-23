/**
 * 冒険の地図。
 *
 * 文法マップの105項目を、レベルごとの島に並んだ「場所」として扱う。場所は習う順に並べる(ROUTES)。
 * ホームの「始める」は、道の先頭の場所から新しい問題を出す(planSession)。
 * 相棒は、まだ答えていない問題がある最初の場所に立つ。3問ともマスターした場所には、あとから旗を立てる。
 * 旗は、あとで間違えてマスターが外れても抜かない(育ったものは減らさない)。
 * 地図に最後に出した相棒の位置と、まだ地図で見せていない旗を覚えておき、次に開いたときに動きで見せる。
 */

export const REGIONS = {
  1: { name: 'はじまりの島', theme: 'island' },
  2: { name: 'ひろい大陸', theme: 'land' },
  3: { name: 'そびえる山々', theme: 'mountain' },
};

/**
 * 島ごとの道の順番。地域(札に書く名前)ごとに、習う順に文法項目を並べる。
 * 学習指導要領は学年ごとの順番を決めていないので、教科書でよく見る順をもとにした。
 * ここにない文法項目は、道の最後に「いろいろな表現」として並べる。
 */
export const ROUTES = {
  1: [
    ['be動詞の文', ['主語+be動詞+形容詞', '主語+be動詞+名詞', '主語+be動詞+代名詞']],
    ['一般動詞の文', ['主語+動詞+名詞', '単文', '主語+動詞', '主語+動詞+代名詞', '代名詞を含む文']],
    ['肯定と否定', ['平叙文(肯定)', '平叙文(否定)']],
    ['疑問文', ['疑問文(be動詞で始まる)', '疑問文(助動詞で始まる)', '疑問文(疑問詞で始まる)']],
    ['命令文', ['命令文(肯定)', '命令文(否定)']],
    ['動名詞と過去形', ['動名詞を含む文', '過去形を含む文']],
  ],
  2: [
    ['現在の文', ['現在形', '前置詞(出身)', '代名詞(人称)', '代名詞(指示)', '代名詞(数量)']],
    ['疑問文と感嘆文', ['疑問文(which、whoseで始まる)', '代名詞(疑問)', '疑問文(orを含む)', '感嘆文']],
    ['canの文', ['助動詞(canの許可)', '助動詞(canの依頼)']],
    ['時制', ['現在進行形', '過去形', '過去進行形', '未来の表現', '疑問文(may、willで始まる)']],
    ['場所と時間', ['前置詞(場所)', '前置詞(時間、期間)', 'There+be動詞']],
    ['接続詞', ['接続詞(and、but、or)', '重文', '接続詞(if、when)', '接続詞(because)', '接続詞(that)', '複文']],
    ['不定詞と動名詞', [
      'to不定詞(名詞的用法)', '主語+動詞+to不定詞', 'to不定詞(副詞的用法)', 'to不定詞(形容詞的用法)',
      '動名詞', '主語+動詞+動名詞',
    ]],
    ['助動詞', ['助動詞(must)', '助動詞(must not)', '助動詞(may)', '助動詞(should)']],
    ['文の組み立て', [
      '主語+be動詞以外の動詞+形容詞', '主語+be動詞以外の動詞+名詞', '主語+動詞+間接目的語+名詞',
      '主語+動詞+間接目的語+代名詞', '主語+動詞+that節', '主語+be動詞+形容詞+that節', '主語+動詞+間接目的語+that節',
    ]],
    ['比較', ['比較(比較級)', '比較(最上級)', '比較(原級)', '接続詞(as、than)']],
    ['受け身と完了', ['受け身', '現在完了形', '現在完了進行形']],
    ['不定詞を使う文', [
      'It+be動詞+(for)+to不定詞', '主語+tell、wantなど+目的語+to不定詞', '主語+動詞+how(など)to不定詞',
      '主語+動詞+間接目的語+how(など)to不定詞',
    ]],
    ['名詞をくわしく', ['分詞の形容詞用法(名詞の前)', '分詞の形容詞用法(名詞の後)', '関係代名詞(主格)', '関係代名詞(目的格)']],
    ['間接疑問', ['主語+動詞+what(など)節', '主語+動詞+間接目的語+what(など)節']],
    ['目的語と補語', ['主語+動詞+目的語+名詞', '主語+動詞+目的語+形容詞', '主語+動詞+目的語+原形不定詞']],
    ['仮定法', ['仮定法(Ifの文)', '仮定法(I wishの文)']],
  ],
  3: [
    ['時制', ['過去完了形', '過去完了進行形']],
    ['助動詞', ['助動詞の過去形', '助動詞を含む受け身', '助動詞+完了形(過去の推測)']],
    ['文の組み立て', [
      '主語+be動詞以外の動詞+分詞', '主語+動詞+目的語+分詞', '知覚動詞+原形不定詞', '主語+seemなど+to不定詞',
      'It+seemなど+that節', 'itが句や節を指す用法',
    ]],
    ['接続詞', ['接続詞の発展的な用法', '主語+動詞+if節', '主語+動詞+間接目的語+if節']],
    ['関係詞', ['関係代名詞(what)', '関係代名詞(非制限的用法)', '関係副詞']],
    ['前置詞', [
      '前置詞(時間、場所の多様な表現)', '動詞+前置詞の連語', '前置詞を含む慣用表現', '名詞化した動詞+前置詞',
      '前置詞+動名詞や関係詞',
    ]],
    ['分詞構文と仮定法', ['分詞構文', '仮定法の発展的な用法']],
  ],
};
const OTHER_AREA = 'いろいろな表現';
const KEY_PATTERN = /^[123]\|.{1,80}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** レベルごとに、文法項目から道の上の位置と地域を引く表。 */
const ROUTE_INDEX = new Map(Object.entries(ROUTES).map(([level, areas]) => {
  const index = new Map();
  for (const [area, patterns] of areas) {
    for (const pattern of patterns) index.set(pattern, { position: index.size, area });
  }
  return [Number(level), index];
}));

/** 文法項目の地域。道の順番にない項目は「いろいろな表現」。 */
export function areaOf(level, pattern) {
  return ROUTE_INDEX.get(level)?.get(pattern)?.area ?? OTHER_AREA;
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
    /**
     * レベルごとに、地図に最後に出した相棒の位置(場所の番号。0から数え、場所の数ならゴール)。
     * v1.13 までは at に入れていた。場所の並びと相棒の立つ場所の決め方が変わったので、at は読まない。
     */
    spot: {},
  };
}

/**
 * 文法マップ(review.js の grammarMap)から、島ごとの場所を、道の順番(ROUTES)に並べて作る。
 * @returns {{level: number, name: string, theme: string, places: object[], flags: number, frontier: number}[]}
 *   frontier は、まだ答えていない問題がある最初の場所の番号(相棒が立つ場所)。
 *   すべての問題に答えていれば places.length(ゴール)。
 */
export function adventureRegions(map, adventure) {
  return map.map(({ level, items }) => {
    const route = ROUTE_INDEX.get(level) ?? new Map();
    const position = (item) => route.get(item.pattern)?.position ?? route.size;
    const ordered = items
      .map((item, order) => ({ item, order }))
      .sort((a, b) => position(a.item) - position(b.item) || a.order - b.order)
      .map(({ item }) => item);
    let previousArea = null;
    const places = ordered.map((item, index) => {
      const key = placeKey(level, item.pattern);
      const area = areaOf(level, item.pattern);
      const place = {
        index,
        key,
        level,
        pattern: item.pattern,
        area,
        areaStart: area !== previousArea,
        questions: item.questions,
        /** 一度でも答えた問題の数。 */
        tried: item.questions.filter(({ state }) => state !== 'new').length,
        mastered: item.questions.filter(({ state }) => state === 'mastered').length,
        complete: item.complete,
        flaggedOn: adventure.flags[key] ?? null,
      };
      previousArea = area;
      return place;
    });
    const frontier = places.findIndex((place) => place.tried < place.questions.length);
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
  const stored = adventure.spot[region.level];
  const from = Number.isInteger(stored) ? Math.min(Math.max(stored, 0), region.places.length) : 0;
  adventure.spot[region.level] = region.frontier;
  return { from, to: region.frontier, newFlags };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * ホームの「始める」で出す問題を、出す順に選ぶ。
 *
 * 1. 道の先頭の場所(まだ答えていない問題がある最初の場所)の問題を、続けて出す。同じ文法を続けて、型をつかむため。
 * 2. 続けて、今日の復習(予定日が来た問題)を混ぜて出す。
 * 3. まだ問題数に余裕があれば、次の場所へ進む。
 * 4. 新しい問題も今日の復習もなくなったら、答えたことのある問題を、復習の予定日が近い順に出す。
 * level が 'all' なら、はじまりの島から順に進む。地図で先の場所を練習していたら、その場所は残りの問題だけを出す。
 *
 * @param {object[]} regions adventureRegions の結果。
 * @param {object} review progress.review
 * @param {string} today 'YYYY-MM-DD'
 * @param {{level?: number|'all', count?: number|'all'}} filter
 * @param {() => number} [random]
 * @returns {string[]} 問題の ID。
 */
export function planSession(regions, review, today, { level = 'all', count = 'all' }, random = Math.random) {
  const places = regions.filter((region) => level === 'all' || region.level === level).flatMap((region) => region.places);
  const limit = count === 'all' ? Infinity : count;
  const blocks = places
    .map((place) => place.questions.filter(({ state }) => state === 'new').map(({ id }) => id))
    .filter((ids) => ids.length > 0);
  const answered = places.flatMap((place) => place.questions.filter(({ state }) => state !== 'new').map(({ id }) => id));
  const dueDay = (id) => review[id]?.due ?? '';
  const picked = [];
  const take = (ids) => {
    for (const id of ids) {
      if (picked.length < limit) picked.push(id);
    }
  };
  take(blocks[0] ?? []);
  take(shuffled(answered.filter((id) => dueDay(id) !== '' && dueDay(id) <= today), random));
  for (const block of blocks.slice(1)) take(block);
  const chosen = new Set(picked);
  take(shuffled(answered.filter((id) => !chosen.has(id)), random).sort((a, b) => dueDay(a).localeCompare(dueDay(b))));
  return picked;
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
  if (typeof source.spot === 'object' && source.spot !== null && !Array.isArray(source.spot)) {
    for (const level of ['1', '2', '3']) {
      const value = source.spot[level];
      if (Number.isInteger(value) && value >= 0 && value <= 200) adventure.spot[level] = value;
    }
  }
  return adventure;
}
