/**
 * 正誤判定モジュール。
 *
 * DOM に依存しない純粋関数だけを置き、Node の自動テストから直接読み込めるようにしている。
 * 将来 AI による意味判定へ差し替えるときは、judge() の入出力を保てばよい。
 */

/** 「惜しい」と判定する類似度の下限。 */
export const CLOSE_THRESHOLD = 0.7;

/** 0.7 ちょうどが浮動小数の誤差で不合格にならないための余裕。 */
const EPSILON = 1e-9;

const FULL_EXPANSIONS = new Map([
  ["can't", 'can not'],
  ['cannot', 'can not'],
  ["won't", 'will not'],
  ["shan't", 'shall not'],
  ["let's", 'let us'],
  ['gonna', 'going to'],
  ['wanna', 'want to'],
]);

const SUFFIX_EXPANSIONS = [
  [/n't$/, ' not'],
  [/'re$/, ' are'],
  [/'ve$/, ' have'],
  [/'ll$/, ' will'],
  [/'d$/, ' would'],
  [/'m$/, ' am'],
];

/** 's を is と読む語。これ以外の 's(Tom's など)は所有格として残す。 */
const IS_CONTRACTION_STEMS = new Set([
  'he', 'she', 'it', 'that', 'there', 'here', 'what', 'who', 'where', 'when', 'why', 'how',
]);

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

const IRREGULAR_ORDINALS = new Map([
  ['one', 'first'],
  ['two', 'second'],
  ['three', 'third'],
  ['five', 'fifth'],
  ['eight', 'eighth'],
  ['nine', 'ninth'],
  ['twelve', 'twelfth'],
]);

/** 音声認識が取り違えやすい同音語。各組は先頭の語にそろえる。 */
const HOMOPHONE_GROUPS = [
  ['there', 'their'],
  ['to', 'too', 'two'],
  ['for', 'four'],
  ['see', 'sea'],
  ['here', 'hear'],
  ['right', 'write'],
  ['buy', 'by', 'bye'],
  ['no', 'know'],
  ['new', 'knew'],
  ['one', 'won'],
  ['son', 'sun'],
  ['meet', 'meat'],
  ['week', 'weak'],
  ['where', 'wear'],
  ['eight', 'ate'],
  ['our', 'hour'],
  ['i', 'eye'],
  ['be', 'bee'],
  ['blue', 'blew'],
  ['red', 'read'],
  ['road', 'rode'],
  ['flower', 'flour'],
  ['would', 'wood'],
  ['peace', 'piece'],
  ['sale', 'sail'],
  ['mail', 'male'],
  ['pair', 'pear'],
  ['break', 'brake'],
  ['sent', 'cent', 'scent'],
  ['dear', 'deer'],
  ['fair', 'fare'],
  ['whole', 'hole'],
  ['steal', 'steel'],
  ['tale', 'tail'],
  ['wait', 'weight'],
  ['way', 'weigh'],
  ['night', 'knight'],
  ['plane', 'plain'],
  ['some', 'sum'],
];

const ALIASES = new Map([
  ['mt', 'mount'],
  ['okay', 'ok'],
  ...HOMOPHONE_GROUPS.flatMap(([head, ...rest]) => rest.map((word) => [word, head])),
]);

function numberToWords(value) {
  if (value < 20) return ONES[value];
  if (value < 100) {
    const rest = value % 10;
    return TENS[Math.floor(value / 10)] + (rest ? ` ${ONES[rest]}` : '');
  }
  if (value < 1000) {
    const rest = value % 100;
    return `${ONES[Math.floor(value / 100)]} hundred${rest ? ` ${numberToWords(rest)}` : ''}`;
  }
  if (value < 1_000_000) {
    const rest = value % 1000;
    return `${numberToWords(Math.floor(value / 1000))} thousand${rest ? ` ${numberToWords(rest)}` : ''}`;
  }
  return String(value);
}

function ordinalToWords(value) {
  const words = numberToWords(value).split(' ');
  const last = words.pop();
  const ordinal = IRREGULAR_ORDINALS.get(last)
    ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ordinal].join(' ');
}

function expandNumber(word) {
  const time = word.match(/^(\d{1,2}):(\d{2})$/);
  if (time) {
    const hour = numberToWords(Number(time[1]));
    const minute = Number(time[2]);
    if (minute === 0) return `${hour} oclock`;
    return `${hour} ${minute < 10 ? 'oh ' : ''}${numberToWords(minute)}`;
  }
  const ordinal = word.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (ordinal) return ordinalToWords(Number(ordinal[1]));
  if (/^\d+$/.test(word) || /^\d{1,3}(,\d{3})+$/.test(word)) {
    return numberToWords(Number(word.replaceAll(',', '')));
  }
  return word;
}

function expandContraction(word) {
  const full = FULL_EXPANSIONS.get(word);
  if (full) return full;
  for (const [pattern, replacement] of SUFFIX_EXPANSIONS) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  if (word.endsWith("'s") && IS_CONTRACTION_STEMS.has(word.slice(0, -2))) {
    return `${word.slice(0, -2)} is`;
  }
  return word;
}

function wordToTokens(rawWord) {
  const word = rawWord
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (!word) return [];
  return expandNumber(expandContraction(word))
    .split(/[\s-]+/)
    .map((part) => part.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean)
    .map((part) => ALIASES.get(part) ?? part);
}

/** 元の語と比較用トークンの対応を保ったまま英文を分解する。 */
function parse(text) {
  const words = text
    .trim()
    .split(/\s+/)
    .map((word) => ({ text: word, tokens: wordToTokens(word) }))
    .filter((word) => word.tokens.length > 0);
  return {
    words,
    tokens: words.flatMap((word) => word.tokens),
    owners: words.flatMap((word, index) => word.tokens.map(() => index)),
  };
}

/** 比較用にそろえたトークン列を返す。 */
export function normalize(text) {
  return parse(text).tokens;
}

/** 単語単位の編集距離と、どの語が一致したかを求める。 */
function align(spoken, model) {
  const table = Array.from({ length: spoken.length + 1 }, () => Array(model.length + 1).fill(0));
  for (let i = 0; i <= spoken.length; i += 1) table[i][0] = i;
  for (let j = 0; j <= model.length; j += 1) table[0][j] = j;
  for (let i = 1; i <= spoken.length; i += 1) {
    for (let j = 1; j <= model.length; j += 1) {
      const cost = spoken[i - 1] === model[j - 1] ? 0 : 1;
      table[i][j] = Math.min(
        table[i - 1][j - 1] + cost,
        table[i - 1][j] + 1,
        table[i][j - 1] + 1,
      );
    }
  }

  const spokenMatched = Array(spoken.length).fill(false);
  const modelMatched = Array(model.length).fill(false);
  let i = spoken.length;
  let j = model.length;
  while (i > 0 && j > 0) {
    if (spoken[i - 1] === model[j - 1] && table[i][j] === table[i - 1][j - 1]) {
      spokenMatched[i - 1] = true;
      modelMatched[j - 1] = true;
      i -= 1;
      j -= 1;
    } else if (table[i][j] === table[i - 1][j - 1] + 1) {
      i -= 1;
      j -= 1;
    } else if (table[i][j] === table[i - 1][j] + 1) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return { distance: table[spoken.length][model.length], spokenMatched, modelMatched };
}

/** トークン単位の一致を、画面に出す元の語単位へ戻す。 */
function markWords(parsed, matched) {
  const ok = parsed.words.map(() => true);
  matched.forEach((isMatched, index) => {
    if (!isMatched) ok[parsed.owners[index]] = false;
  });
  return parsed.words.map((word, index) => ({ text: word.text, ok: ok[index] }));
}

/**
 * 回答を判定する。
 *
 * @param {object} input
 * @param {string[]} input.candidates 認識候補。確度の高い順。
 * @param {string[]} input.answers 正解例。1件以上。
 * @param {number} [input.threshold] 「惜しい」とする類似度の下限。
 * @returns {{
 *   result: 'correct'|'close'|'wrong',
 *   similarity: number,
 *   answerText: string,
 *   modelText: string,
 *   answerWords: {text: string, ok: boolean}[],
 *   modelWords: {text: string, ok: boolean}[],
 * }}
 */
export function judge({ candidates, answers, threshold = CLOSE_THRESHOLD }) {
  const models = answers.map((text) => ({ text, parsed: parse(text) }));
  const spoken = candidates
    .map((text) => ({ text: text.trim(), parsed: parse(text) }))
    .filter((candidate) => candidate.parsed.tokens.length > 0);

  if (spoken.length === 0) {
    return {
      result: 'wrong',
      similarity: 0,
      answerText: '',
      modelText: models[0].text,
      answerWords: [],
      modelWords: models[0].parsed.words.map((word) => ({ text: word.text, ok: false })),
    };
  }

  let best = null;
  for (const candidate of spoken) {
    for (const model of models) {
      const alignment = align(candidate.parsed.tokens, model.parsed.tokens);
      const similarity = Math.max(0, 1 - alignment.distance / model.parsed.tokens.length);
      if (!best || similarity > best.similarity) best = { candidate, model, alignment, similarity };
    }
  }

  const { candidate, model, alignment, similarity } = best;
  let result = 'wrong';
  if (alignment.distance === 0) result = 'correct';
  else if (similarity + EPSILON >= threshold) result = 'close';

  return {
    result,
    similarity,
    answerText: candidate.text,
    modelText: model.text,
    answerWords: markWords(candidate.parsed, alignment.spokenMatched),
    modelWords: markWords(model.parsed, alignment.modelMatched),
  };
}
