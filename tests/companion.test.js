import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bigDays,
  canReceiveEgg,
  chooseAdult,
  chooseSpecies,
  chooseVariant,
  displayName,
  feedCompanion,
  FORMS,
  formById,
  formId,
  GROWN_POINTS,
  longestRun,
  newCompanion,
  nextStep,
  readCompanion,
  receiveEgg,
  STAGE_POINTS,
  takeNews,
} from '../js/companion.js';
import { addDays } from '../js/review.js';

const TODAY = '2026-11-17';
const CHILD_ANSWERS = STAGE_POINTS.adult - STAGE_POINTS.child;
const never = () => 1;
const always = () => 0;

/** 同じ答え方で n 問ぶん育てる。日付は進めず、色ちがいにはしない。 */
function feed(companion, n, answer = {}, context = {}) {
  const events = [];
  for (let i = 0; i < n; i += 1) {
    events.push(...feedCompanion(
      companion,
      { level: 2, mode: 'normal', fast: false, spoken: true, correct: false, ...answer },
      { today: TODAY, days: {}, random: never, ...context },
    ));
  }
  return events;
}

/** こどもになったところまで育てる。 */
function childOf(level, answer = {}) {
  const companion = newCompanion(TODAY);
  feed(companion, STAGE_POINTS.child, { level, ...answer });
  takeNews(companion);
  return companion;
}

describe('相棒の育ち方', () => {
  it('たまごから始まり、5問でかえる', () => {
    const companion = newCompanion(TODAY);
    assert.equal(formId(companion), 'egg');
    assert.deepEqual(feed(companion, STAGE_POINTS.baby - 1), []);
    const events = feed(companion, 1);
    assert.deepEqual(events, [{ kind: 'evolve', from: 'egg', to: 'baby', day: TODAY }]);
    assert.equal(companion.seen.baby, TODAY);
  });

  it('いちばん多く解いたレベルで、こどもの姿が決まる', () => {
    assert.equal(formId(childOf(1)), 'moko');
    assert.equal(formId(childOf(2)), 'piko');
    assert.equal(formId(childOf(3)), 'gau');
  });

  it('文字で答えることが多いと、タッピになる', () => {
    assert.equal(formId(childOf(1, { spoken: false })), 'tappi');
    assert.equal(chooseSpecies({ levels: { 1: 0, 2: 10, 3: 0 }, typed: 6 }), 'tappi');
    assert.equal(chooseSpecies({ levels: { 1: 0, 2: 10, 3: 0 }, typed: 5 }), 'piko');
  });

  it('どのレベルも半分に届かないと、まんべんなく解いたとしてニャモになる', () => {
    assert.equal(chooseSpecies({ levels: { 1: 10, 2: 10, 3: 3 }, typed: 0 }), 'nyamo');
    assert.equal(chooseSpecies({ levels: { 1: 20, 2: 15, 3: 15 }, typed: 0 }), 'nyamo');
    assert.equal(chooseSpecies({ levels: { 1: 25, 2: 15, 3: 10 }, typed: 0 }), 'moko');
  });

  it('レベルの数が同じで半分に届くなら、低いレベルの姿を選ぶ', () => {
    assert.equal(chooseSpecies({ levels: { 1: 0, 2: 7, 3: 7 }, typed: 0 }), 'piko');
    assert.equal(chooseSpecies({ levels: { 1: 0, 2: 0, 3: 0 }, typed: 0 }), 'moko');
  });

  it('こどもになると数え直し、こどもになった理由を出来事に残す', () => {
    const companion = newCompanion(TODAY);
    const events = feed(companion, STAGE_POINTS.child, { level: 1, mode: 'review', fast: true, correct: true });
    assert.equal(events.at(-1).to, 'moko');
    assert.match(events.at(-1).reason, /小学校/);
    assert.deepEqual(companion.counts, { levels: { 1: 0, 2: 0, 3: 0 }, review: 0, fast: 0, typed: 0, correct: 0 });
  });

  it('こどもの間に5日続けて学習すると、おひさまになる', () => {
    const companion = childOf(1);
    const days = {};
    for (let i = 0; i < 5; i += 1) days[addDays(TODAY, i)] = 20;
    const events = feed(companion, CHILD_ANSWERS, {}, { today: addDays(TODAY, 4), days });
    assert.equal(formId(companion), 'moko-sun');
    assert.match(events.at(-1).reason, /毎日/);
  });

  it('こどもの間に復習を30問解くと、もりのになる', () => {
    const companion = childOf(2);
    feed(companion, 30, { mode: 'weak' });
    feed(companion, CHILD_ANSWERS - 30);
    assert.equal(formId(companion), 'piko-forest');
  });

  it('こどもの間にすばやい正解が30問あると、いなずまになる', () => {
    const companion = childOf(3);
    feed(companion, 30, { fast: true });
    feed(companion, CHILD_ANSWERS - 30);
    assert.equal(formId(companion), 'gau-bolt');
  });

  it('こどもの間に、たくさん答えた日が2日あると、ほのおになる', () => {
    const companion = childOf(1, { spoken: false });
    const days = { [TODAY]: 50, [addDays(TODAY, 1)]: 50 };
    feed(companion, CHILD_ANSWERS, {}, { today: addDays(TODAY, 1), days });
    assert.equal(formId(companion), 'tappi-flame');
  });

  it('こどもの間に90問正解すると、ほうせきになる', () => {
    const companion = childOf(1);
    feed(companion, 90, { correct: true });
    feed(companion, CHILD_ANSWERS - 90);
    assert.equal(formId(companion), 'moko-gem');
  });

  it('どれにも届かなければ、そよかぜになる', () => {
    const companion = childOf(2);
    feed(companion, CHILD_ANSWERS, {}, { days: { [TODAY]: 100 } });
    assert.equal(formId(companion), 'piko-breeze');
  });

  it('いくつも届いたら、届き方の大きいほうを選び、同じなら並び順で選ぶ', () => {
    assert.equal(chooseVariant({ sun: 5, forest: 60, bolt: 30, flame: 0, gem: 0 }), 'forest');
    assert.equal(chooseVariant({ sun: 10, forest: 60, bolt: 30, flame: 0, gem: 0 }), 'sun');
    assert.equal(chooseVariant({ sun: 5, forest: 30, bolt: 30, flame: 2, gem: 90 }), 'sun');
    assert.equal(chooseVariant({ sun: 4, forest: 29, bolt: 29, flame: 1, gem: 89 }), 'breeze');
  });

  it('条件の4つ以上に届くと、ひみつの姿のひかりどりになる', () => {
    const levels = { 1: 0, 2: 100, 3: 0 };
    assert.equal(chooseAdult({ sun: 5, forest: 30, bolt: 30, flame: 2, gem: 0 }, levels), 'hikari');
    assert.equal(chooseAdult({ sun: 5, forest: 30, bolt: 30, flame: 0, gem: 0 }, levels), 'sun');
  });

  it('こどもの間に3つのレベルをそれぞれ25問以上解くと、ひみつの姿のにじくもになる', () => {
    const companion = childOf(2);
    feed(companion, 25, { level: 1 });
    feed(companion, 25, { level: 3 });
    feed(companion, CHILD_ANSWERS - 50, { level: 2 });
    assert.equal(formId(companion), 'niji');
    assert.equal(formById('niji').secret, true);
    assert.equal(companion.species, 'piko');
  });

  it('続けて学習した日数は、間が空くと数え直す', () => {
    const days = { '2026-11-01': 3, '2026-11-02': 1, '2026-11-04': 2, '2026-11-05': 2, '2026-11-06': 1 };
    assert.equal(longestRun(days, '2026-11-01', '2026-11-07'), 3);
    assert.equal(longestRun(days, '2026-11-05', '2026-11-07'), 2);
    assert.equal(longestRun({}, TODAY, TODAY), 0);
  });

  it('30問以上答えた日を、たくさん答えた日として数える', () => {
    assert.equal(bigDays({ '2026-11-01': 30, '2026-11-02': 29, '2026-11-03': 45 }, '2026-11-01', '2026-11-05'), 2);
  });

  it('300問で一人前になり、そのときだけ知らせる', () => {
    const companion = childOf(1);
    feed(companion, CHILD_ANSWERS);
    takeNews(companion);
    assert.equal(canReceiveEgg(companion), false);
    const events = feed(companion, GROWN_POINTS - STAGE_POINTS.adult + 10);
    assert.deepEqual(events.map(({ kind }) => kind), ['grown']);
    assert.equal(companion.grownOn, TODAY);
    assert.equal(canReceiveEgg(companion), true);
    assert.equal(nextStep(companion), null);
  });

  it('一度に多く答えても、段階を1つずつ進め、それぞれの間の数で姿を決める', () => {
    const companion = newCompanion(TODAY);
    feed(companion, STAGE_POINTS.child, { level: 3 });
    feed(companion, 30, { level: 1, fast: true });
    feed(companion, CHILD_ANSWERS - 30, { level: 1 });
    assert.equal(formId(companion), 'gau-bolt');
    assert.deepEqual(takeNews(companion).map(({ to }) => to), ['baby', 'gau', 'gau-bolt']);
    assert.deepEqual(companion.news, []);
  });
});

describe('色ちがい', () => {
  it('姿が変わるとき、まれに色ちがいになり、図鑑に別に残す', () => {
    const companion = newCompanion(TODAY);
    const events = feed(companion, STAGE_POINTS.baby, {}, { random: always });
    assert.equal(companion.rare, true);
    assert.equal(events[0].rare, true);
    assert.equal(companion.seen['baby:rare'], TODAY);
  });

  it('次に姿が変わるときに、色はもう一度決め直す', () => {
    const companion = newCompanion(TODAY);
    feed(companion, STAGE_POINTS.baby, {}, { random: always });
    feed(companion, STAGE_POINTS.child - STAGE_POINTS.baby);
    assert.equal(companion.rare, false);
    assert.equal(companion.seen['baby:rare'], TODAY);
    assert.equal(companion.seen['piko:rare'], undefined);
  });

  it('確率は20回に1回', () => {
    const at = (value) => {
      const companion = newCompanion(TODAY);
      feed(companion, STAGE_POINTS.baby, {}, { random: () => value });
      return companion.rare;
    };
    assert.equal(at(0.049), true);
    assert.equal(at(0.05), false);
  });
});

describe('新しいたまご', () => {
  it('一人前になる前は受け取れない', () => {
    const companion = childOf(1);
    assert.equal(receiveEgg(companion, TODAY), false);
    assert.equal(formId(companion), 'moko');
  });

  it('育てた相棒をなかまに残し、図鑑と設定はそのまま新しいたまごにする', () => {
    const companion = childOf(1);
    companion.name = 'ポチ';
    companion.hidden = true;
    feed(companion, GROWN_POINTS - STAGE_POINTS.child);
    companion.rare = true;
    assert.equal(receiveEgg(companion, '2026-12-01'), true);
    assert.deepEqual(companion.friends, [
      { form: 'moko-breeze', species: 'moko', rare: true, name: 'ポチ', born: TODAY, grown: TODAY, generation: 1 },
    ]);
    assert.equal(companion.generation, 2);
    assert.equal(formId(companion), 'egg');
    assert.equal(companion.points, 0);
    assert.equal(companion.rare, false);
    assert.equal(companion.name, '');
    assert.equal(companion.born, '2026-12-01');
    assert.equal(companion.hidden, true);
    assert.ok(companion.seen['moko-breeze']);
  });
});

describe('相棒の表示', () => {
  it('名前をつけていなければ、姿の名前を出す', () => {
    const companion = childOf(2);
    assert.equal(displayName(companion), 'ピコ');
    companion.name = 'ぴー';
    assert.equal(displayName(companion), 'ぴー');
  });

  it('次の段階までの残りと割合を返す', () => {
    const companion = newCompanion(TODAY);
    feed(companion, 2);
    assert.deepEqual(nextStep(companion), { next: 'baby', remaining: 3, ratio: 0.4 });
    feed(companion, 3);
    assert.deepEqual(nextStep(companion), { next: 'child', remaining: 45, ratio: 0 });
  });

  it('図鑑には、たまご、あかちゃん、こども5つ、おとな30、ひみつ2の姿がある', () => {
    assert.equal(FORMS.length, 39);
    assert.equal(new Set(FORMS.map(({ id }) => id)).size, 39);
    assert.equal(FORMS.filter(({ stage }) => stage === 'child').length, 5);
    assert.equal(FORMS.filter(({ stage, secret }) => stage === 'adult' && !secret).length, 30);
    assert.equal(FORMS.filter(({ secret }) => secret).length, 2);
    assert.ok(FORMS.some(({ id, name }) => id === 'nyamo-flame' && name === 'ほのおニャモ'));
  });
});

describe('相棒の記録の読み込み', () => {
  it('書き出した記録をそのまま読める', () => {
    const companion = childOf(3);
    companion.name = 'ガウガウ';
    feed(companion, 10, { mode: 'review', fast: true, spoken: false, correct: true });
    const copy = JSON.parse(JSON.stringify(companion));
    assert.deepEqual(readCompanion(copy), companion);
  });

  it('ひみつの姿と色ちがい、なかまも読める', () => {
    const companion = childOf(2);
    feed(companion, 25, { level: 1 });
    feed(companion, 25, { level: 3 });
    feed(companion, GROWN_POINTS - STAGE_POINTS.child - 50, {}, { random: always });
    receiveEgg(companion, TODAY);
    feed(companion, STAGE_POINTS.baby, {}, { random: always });
    const copy = JSON.parse(JSON.stringify(companion));
    const result = readCompanion(copy);
    assert.deepEqual(result, companion);
    assert.equal(result.friends[0].form, 'niji');
    assert.equal(result.friends[0].species, 'piko');
    assert.equal(result.seen['niji:rare'], TODAY);
  });

  it('姿の組み合わせがおかしい記録は使わない', () => {
    const companion = childOf(1);
    assert.equal(readCompanion({ ...companion, species: 'unknown' }), null);
    assert.equal(readCompanion({ ...companion, stage: 'adult', variant: null }), null);
    assert.equal(readCompanion({ ...companion, stage: 'dragon' }), null);
    assert.equal(readCompanion({ ...companion, born: 'yesterday' }), null);
    assert.equal(readCompanion(null), null);
  });

  it('使えない値は除き、長すぎる名前は切る', () => {
    const companion = childOf(1);
    const result = readCompanion({
      ...companion,
      points: -5,
      rare: 'yes',
      name: '  とてもとてもながいなまえのあいぼう  ',
      counts: { levels: { 1: 'many' }, review: 2.5, fast: 3 },
      news: [{ kind: 'evolve', from: 'egg', to: 'baby', day: TODAY }, { kind: 'evolve', from: 'x', to: 'baby', day: TODAY }],
      seen: { egg: TODAY, nothing: TODAY, 'moko:rare': TODAY, 'nothing:rare': TODAY },
      friends: [
        { form: 'moko', name: 'a', born: TODAY, grown: TODAY },
        { form: 'gau-sun', name: 'b', born: TODAY, grown: TODAY },
        { form: 'hikari', name: 'c', born: TODAY, grown: TODAY },
      ],
      hidden: 'yes',
    });
    assert.equal(result.points, STAGE_POINTS.child);
    assert.equal(result.rare, false);
    assert.equal(result.name, 'とてもとてもながいな');
    assert.deepEqual(result.counts, { levels: { 1: 0, 2: 0, 3: 0 }, review: 0, fast: 3, typed: 0, correct: 0 });
    assert.equal(result.news.length, 1);
    assert.deepEqual(Object.keys(result.seen).sort(), ['egg', 'moko', 'moko:rare']);
    assert.deepEqual(result.friends.map(({ form }) => form), ['gau-sun']);
    assert.equal(result.hidden, false);
  });
});
