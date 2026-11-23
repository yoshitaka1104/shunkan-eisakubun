import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { boardLayout, boardScene, placeSvg, roadPath, standPoint, starSvg } from '../js/adventure-art.js';
import {
  ROUTES,
  adventureRegions,
  areaOf,
  emptyAdventure,
  flagCount,
  placeKey,
  planSession,
  plantFlags,
  readAdventure,
  removeFlag,
  takeMapMoves,
} from '../js/adventure.js';
import { createBackup, readBackup } from '../js/backup.js';
import { emptyProgress } from '../js/progress.js';
import { grammarMap } from '../js/review.js';

const questions = JSON.parse(await readFile(new URL('../data/questions.json', import.meta.url), 'utf8'));
const TODAY = '2026-11-18';

function idsOf(level, pattern) {
  return questions.filter((item) => item.level === level && item.pattern === pattern).map((item) => item.id);
}

/** 場所の3問をマスターにする。 */
function master(progress, level, pattern) {
  for (const id of idsOf(level, pattern)) progress.review[id] = { stage: 3, due: '2026-12-01' };
}

/** 場所の問題に答えたことにする。count を渡すと、最初の count 問だけ。 */
function answer(progress, level, pattern, due = '2026-11-25', count = 3) {
  for (const id of idsOf(level, pattern).slice(0, count)) progress.review[id] = { stage: 1, due };
}

function patternsOf(level) {
  return [...new Set(questions.filter((question) => question.level === level).map((question) => question.pattern))];
}

/** 道の順番に並べた文法項目。 */
function route(level) {
  return ROUTES[level].flatMap(([, patterns]) => patterns);
}

function regionsOf(progress, adventure = emptyAdventure()) {
  return adventureRegions(grammarMap(questions, progress), adventure);
}

function patternOf(id) {
  return questions.find((question) => question.id === id).pattern;
}

/** 決まった順に値を返す乱数。 */
function fixedRandom() {
  let seed = 1;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

describe('冒険の地図の地域と道の順番', () => {
  it('道の順番に、問題の文法項目がちょうど1回ずつ入る', () => {
    for (const level of [1, 2, 3]) {
      assert.deepEqual([...route(level)].sort(), [...patternsOf(level)].sort(), `レベル${level}`);
      assert.equal(new Set(route(level)).size, route(level).length, `レベル${level}に重なりがある`);
    }
  });

  it('105の場所が、どれも名前のある地域に入る', () => {
    const regions = regionsOf(emptyProgress());
    const places = regions.flatMap((region) => region.places);
    assert.equal(places.length, 105);
    assert.deepEqual(places.filter((place) => place.area === 'いろいろな表現'), []);
  });

  it('場所は習う順に並ぶ', () => {
    const [elementary, junior, senior] = regionsOf(emptyProgress());
    assert.deepEqual(elementary.places.map(({ pattern }) => pattern), route(1));
    const at = (pattern) => junior.places.findIndex((place) => place.pattern === pattern);
    assert.equal(junior.places[0].pattern, '現在形');
    assert.ok(at('現在形') < at('過去形'));
    assert.ok(at('過去形') < at('比較(比較級)'));
    assert.ok(at('比較(比較級)') < at('現在完了形'));
    assert.ok(at('現在完了形') < at('関係代名詞(主格)'));
    assert.equal(junior.places.at(-1).pattern, '仮定法(I wishの文)');
    assert.equal(senior.places[0].pattern, '過去完了形');
  });

  it('同じ地域の場所は、道の上で続けて並ぶ', () => {
    for (const region of regionsOf(emptyProgress())) {
      const starts = region.places.filter((place) => place.areaStart).map((place) => place.area);
      assert.equal(new Set(starts).size, starts.length, `${region.name}: ${starts.join('、')}`);
      assert.equal(region.places[0].areaStart, true);
    }
  });

  it('地域は、道の順番から引く', () => {
    assert.equal(areaOf(1, '疑問文(be動詞で始まる)'), '疑問文');
    assert.equal(areaOf(2, '関係代名詞(主格)'), '名詞をくわしく');
    assert.equal(areaOf(2, '接続詞(as、than)'), '比較');
    assert.equal(areaOf(3, '関係副詞'), '関係詞');
    assert.equal(areaOf(3, 'itが句や節を指す用法'), '文の組み立て');
    assert.equal(areaOf(2, '新しい項目'), 'いろいろな表現');
  });

  it('道の順番にない文法項目は、最後に並べる', () => {
    const item = (pattern) => ({ pattern, questions: [{ id: pattern, state: 'new' }], complete: false });
    const [region] = adventureRegions([{ level: 1, items: [item('新しい項目'), item('単文'), item('主語+be動詞+名詞')] }], emptyAdventure());
    assert.deepEqual(region.places.map(({ pattern, area }) => [pattern, area]), [
      ['主語+be動詞+名詞', 'be動詞の文'], ['単文', '一般動詞の文'], ['新しい項目', 'いろいろな表現'],
    ]);
  });

  it('島は3つで、小学校17、中学校64、高校24の場所がある', () => {
    const regions = regionsOf(emptyProgress());
    assert.deepEqual(regions.map(({ level, places }) => [level, places.length]), [[1, 17], [2, 64], [3, 24]]);
    assert.deepEqual(regions.map(({ name }) => name), ['はじまりの島', 'ひろい大陸', 'そびえる山々']);
    assert.deepEqual(regions.map(({ frontier }) => frontier), [0, 0, 0]);
  });
});

describe('相棒の位置', () => {
  it('相棒は、まだ答えていない問題がある最初の場所に立つ', () => {
    const progress = emptyProgress();
    const [first, second, third] = route(1);
    answer(progress, 1, first);
    answer(progress, 1, second, '2026-11-25', 2);
    answer(progress, 1, third);
    assert.equal(regionsOf(progress)[0].frontier, 1);
    answer(progress, 1, second);
    assert.equal(regionsOf(progress)[0].frontier, 3);
  });

  it('旗がなくても、3問に答えれば次の場所へ進む', () => {
    const progress = emptyProgress();
    answer(progress, 1, route(1)[0]);
    const [region] = regionsOf(progress);
    assert.equal(region.frontier, 1);
    assert.equal(region.flags, 0);
    assert.equal(region.places[0].tried, 3);
  });

  it('すべての問題に答えれば、旗がなくても相棒はゴールにいる', () => {
    const progress = emptyProgress();
    for (const pattern of route(1)) answer(progress, 1, pattern);
    const [region] = regionsOf(progress);
    assert.equal(region.frontier, 17);
    assert.equal(region.flags, 0);
  });
});

describe('旗', () => {
  it('3問ともマスターした場所に、旗を1回だけ立てる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [first] = route(1);
    master(progress, 1, first);
    const planted = plantFlags(adventure, grammarMap(questions, progress), TODAY);
    assert.deepEqual(planted, [{ level: 1, pattern: first, key: placeKey(1, first) }]);
    assert.equal(adventure.flags[placeKey(1, first)], TODAY);
    assert.deepEqual(adventure.unseen, [placeKey(1, first)]);
    assert.deepEqual(plantFlags(adventure, grammarMap(questions, progress), '2026-11-19'), []);
    assert.equal(adventure.flags[placeKey(1, first)], TODAY);
  });

  it('2問だけのマスターでは、旗を立てない', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    for (const id of idsOf(1, route(1)[0]).slice(0, 2)) progress.review[id] = { stage: 3, due: '2026-12-01' };
    assert.deepEqual(plantFlags(adventure, grammarMap(questions, progress), TODAY), []);
  });

  it('あとでマスターが外れても、旗は残る', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [first] = route(1);
    master(progress, 1, first);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    progress.review[idsOf(1, first)[0]] = { stage: 0, due: '2026-11-19' };
    plantFlags(adventure, grammarMap(questions, progress), '2026-11-19');
    const [region] = regionsOf(progress, adventure);
    assert.equal(region.places[0].flaggedOn, TODAY);
    assert.equal(region.places[0].complete, false);
    assert.equal(region.frontier, 1);
  });

  it('先の場所にも旗が立ち、相棒の位置は変えない', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    master(progress, 1, route(1)[2]);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [region] = regionsOf(progress, adventure);
    assert.equal(region.frontier, 0);
    assert.equal(region.flags, 1);
    assert.equal(region.places[2].flaggedOn, TODAY);
  });

  it('すべての場所に旗が立てば、相棒はゴールにいる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    for (const pattern of route(1)) master(progress, 1, pattern);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [region] = regionsOf(progress, adventure);
    assert.equal(region.frontier, 17);
    assert.equal(flagCount(adventure), 17);
  });

  it('旗を抜くと、まだ見せていない旗からも消す', () => {
    const adventure = emptyAdventure();
    adventure.flags['1|単文'] = TODAY;
    adventure.unseen.push('1|単文');
    removeFlag(adventure, '1|単文');
    assert.deepEqual(adventure.flags, {});
    assert.deepEqual(adventure.unseen, []);
  });

  it('数えるのは、今の問題にある場所の旗だけにできる', () => {
    const adventure = emptyAdventure();
    adventure.flags['1|単文'] = TODAY;
    adventure.flags['1|なくなった項目'] = TODAY;
    assert.equal(flagCount(adventure), 2);
    assert.equal(flagCount(adventure, new Set(['1|単文'])), 1);
  });
});

describe('「始める」の問題', () => {
  it('はじめは、道の先頭の場所から順に、場所ごとに続けて出す', () => {
    const ids = planSession(regionsOf(emptyProgress()), {}, TODAY, { level: 1, count: 10 });
    assert.deepEqual(ids, [
      ...idsOf(1, route(1)[0]), ...idsOf(1, route(1)[1]), ...idsOf(1, route(1)[2]), idsOf(1, route(1)[3])[0],
    ]);
  });

  it('先頭の場所の3問を出してから、今日の復習を混ぜる', () => {
    const progress = emptyProgress();
    answer(progress, 1, route(1)[0], TODAY);
    answer(progress, 1, route(1)[1], '2026-11-19');
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 1, count: 6 }, fixedRandom());
    assert.deepEqual(ids.slice(0, 3), idsOf(1, route(1)[2]));
    assert.deepEqual([...ids.slice(3)].sort(), [...idsOf(1, route(1)[0])].sort());
  });

  it('復習が多くても、新しい場所の問題は出す', () => {
    const progress = emptyProgress();
    for (const pattern of route(1).slice(0, 5)) answer(progress, 1, pattern, TODAY);
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 1, count: 5 }, fixedRandom());
    assert.deepEqual(ids.slice(0, 3), idsOf(1, route(1)[5]));
    assert.equal(ids.slice(3).filter((id) => progress.review[id]).length, 2);
  });

  it('地図で先に練習した場所は、残りの問題だけを出す', () => {
    const progress = emptyProgress();
    answer(progress, 1, route(1)[1], '2026-11-25', 2);
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 1, count: 7 });
    assert.deepEqual(ids, [...idsOf(1, route(1)[0]), idsOf(1, route(1)[1])[2], ...idsOf(1, route(1)[2])]);
  });

  it('レベルが「すべて」なら、はじまりの島から順に進む', () => {
    const progress = emptyProgress();
    assert.deepEqual(planSession(regionsOf(progress), {}, TODAY, { level: 'all', count: 3 }), idsOf(1, route(1)[0]));
    for (const pattern of route(1)) answer(progress, 1, pattern);
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 'all', count: 3 });
    assert.deepEqual(ids.map(patternOf), ['現在形', '現在形', '現在形']);
  });

  it('レベルを選ぶと、その島の問題だけを出す', () => {
    const progress = emptyProgress();
    answer(progress, 1, route(1)[0], TODAY);
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 2, count: 5 });
    assert.ok(ids.every((id) => questions.find((question) => question.id === id).level === 2));
    assert.deepEqual(ids.slice(0, 3).map(patternOf), ['現在形', '現在形', '現在形']);
  });

  it('新しい問題も今日の復習もなければ、予定日が近い順に出す', () => {
    const progress = emptyProgress();
    for (const pattern of route(1)) answer(progress, 1, pattern, '2026-12-10');
    for (const id of idsOf(1, route(1)[6])) progress.review[id] = { stage: 2, due: '2026-11-20' };
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 1, count: 3 }, fixedRandom());
    assert.deepEqual([...ids].sort(), [...idsOf(1, route(1)[6])].sort());
  });

  it('全問なら、その島の問題を1回ずつ出す', () => {
    const progress = emptyProgress();
    answer(progress, 1, route(1)[3], TODAY);
    answer(progress, 1, route(1)[8], '2026-11-30');
    const ids = planSession(regionsOf(progress), progress.review, TODAY, { level: 1, count: 'all' }, fixedRandom());
    assert.equal(ids.length, 51);
    assert.equal(new Set(ids).size, 51);
    assert.deepEqual(ids.slice(0, 3), idsOf(1, route(1)[0]));
  });
});

describe('地図を開いたときの動き', () => {
  it('前に見せた位置から、今の位置まで相棒が進み、新しい旗を一度だけ見せる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [first, second] = route(1);
    master(progress, 1, first);
    master(progress, 1, second);
    master(progress, 2, route(2)[0]);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [region] = regionsOf(progress, adventure);
    const moves = takeMapMoves(adventure, region);
    assert.deepEqual({ ...moves, newFlags: [...moves.newFlags].sort() }, {
      from: 0, to: 2, newFlags: [placeKey(1, first), placeKey(1, second)].sort(),
    });
    assert.deepEqual(adventure.unseen, [placeKey(2, route(2)[0])], 'ほかの島の旗は、その島を開くまで残す');
    assert.deepEqual(takeMapMoves(adventure, region), { from: 2, to: 2, newFlags: [] });
  });

  it('覚えた位置が地図の外なら、ゴールまでにおさめる', () => {
    const adventure = emptyAdventure();
    adventure.spot[1] = 99;
    const [region] = regionsOf(emptyProgress(), adventure);
    assert.equal(takeMapMoves(adventure, region).from, 17);
  });
});

describe('冒険の地図の読み込み', () => {
  it('使える旗と位置だけを取り出す', () => {
    const adventure = readAdventure({
      flags: { '1|単文': TODAY, '2|重文': 'きのう', '9|x': TODAY, '': TODAY, '3|分詞構文': '2026-11-01' },
      unseen: ['1|単文', '1|単文', '2|重文', 5],
      spot: { 1: 3, 2: -1, 3: 1.5, 4: 2 },
    });
    assert.deepEqual(adventure, {
      flags: { '1|単文': TODAY, '3|分詞構文': '2026-11-01' },
      unseen: ['1|単文'],
      spot: { 1: 3 },
    });
  });

  it('v1.13 までの相棒の位置(at)は、並びが違うので使わない', () => {
    assert.deepEqual(readAdventure({ flags: {}, unseen: [], at: { 1: 5 } }).spot, {});
  });

  it('形の違うものは null にする', () => {
    assert.equal(readAdventure(undefined), null);
    assert.equal(readAdventure([]), null);
    assert.equal(readAdventure('flags'), null);
    assert.deepEqual(readAdventure({ flags: [], unseen: {}, spot: [] }), emptyAdventure());
  });

  it('書き出した記録に旗が残り、古い記録では null になる', () => {
    const progress = emptyProgress();
    progress.adventure = emptyAdventure();
    progress.adventure.flags['1|単文'] = TODAY;
    progress.adventure.spot[1] = 1;
    const restored = readBackup(createBackup(progress)).progress;
    assert.deepEqual(restored.adventure, { flags: { '1|単文': TODAY }, unseen: [], spot: { 1: 1 } });
    const old = JSON.parse(createBackup(emptyProgress()));
    delete old.progress.adventure;
    assert.equal(readBackup(JSON.stringify(old)).progress.adventure, null);
  });
});

describe('地図の絵', () => {
  it('スタートとゴールを含めて、4マスずつ折り返して並べる', () => {
    const layout = boardLayout(17);
    assert.equal(layout.cells.length, 19);
    assert.deepEqual(layout.cells.slice(0, 9).map(({ row, column }) => [row, column]), [
      [0, 0], [0, 1], [0, 2], [0, 3], [1, 3], [1, 2], [1, 1], [1, 0], [2, 0],
    ]);
    assert.equal(layout.cells.at(-1).row, 4);
    assert.ok(layout.cells.every(({ x, y }) => x > 0 && x < layout.width && y > 0 && y < layout.height));
  });

  it('道はスタート(下)からゴール(上)へ、1マスごとに登る', () => {
    const { cells } = boardLayout(64);
    assert.ok(cells.slice(1).every((cell, index) => cell.y < cells[index].y));
    assert.equal(Math.max(...cells.map(({ y }) => y)), cells[0].y);
    assert.equal(Math.min(...cells.map(({ y }) => y)), cells.at(-1).y);
  });

  it('道は、行の端で外へふくらんで折り返す、なめらかな曲線', () => {
    const layout = boardLayout(64);
    const road = roadPath(layout.cells);
    assert.doesNotMatch(road, /[LA]/);
    assert.equal((road.match(/C/g) ?? []).length, layout.cells.length - 1 + layout.cells.at(-1).row);
    const [start, , third] = layout.cells;
    const part = roadPath(layout.cells, 2);
    assert.ok(part.startsWith(`M${start.x} ${start.y}C`), part);
    assert.ok(part.endsWith(` ${third.x} ${third.y}`), part);
    assert.equal((part.match(/C/g) ?? []).length, 2);
  });

  it('相棒は場所の上に立ち、ゴールでは宝箱の横に立つ', () => {
    const layout = boardLayout(17);
    assert.deepEqual(standPoint(layout, 4), layout.cells[5]);
    const goal = layout.cells.at(-1);
    const spot = standPoint(layout, 17);
    assert.equal(Math.abs(spot.x - goal.x), 30);
    assert.equal(spot.y, goal.y);
  });

  it('旗のある場所は石が金色になって旗を出し、3つの星で習熟度を表す', () => {
    const questionsOf = (states) => states.map((state, index) => ({ id: `q${index}`, state }));
    const plain = placeSvg({ index: 4, flaggedOn: null, questions: questionsOf(['new', 'learning', 'mastered']) });
    assert.match(plain, />5<\/text>/);
    assert.equal((plain.match(/class="adv-star/g) ?? []).length, 3);
    assert.match(plain, /adv-star is-learning/);
    assert.doesNotMatch(plain, /is-flagged/);
    const flagged = placeSvg({ index: 4, flaggedOn: TODAY, questions: questionsOf(['mastered', 'mastered', 'mastered']) });
    assert.match(flagged, /adv-flag-cloth/);
    assert.match(flagged, /adv-face is-flagged/);
    assert.doesNotMatch(flagged, /adv-number/);
    assert.match(starSvg('growing'), /adv-star is-growing/);
  });

  it('すべてに旗が立つと、ゴールの宝箱が開く', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [region] = regionsOf(progress, adventure);
    const layout = boardLayout(region.places.length);
    assert.doesNotMatch(boardScene(region, layout, 1), /adv-goal is-open/);
    assert.equal((boardScene(region, layout, 1).match(/adv-area/g) ?? []).length, region.places.filter((place) => place.areaStart).length);
    for (const pattern of route(1)) answer(progress, 1, pattern);
    const [arrived] = regionsOf(progress, adventure);
    assert.equal(arrived.frontier, 17);
    assert.doesNotMatch(boardScene(arrived, layout, 18), /adv-goal is-open/, 'ゴールに着いただけでは開かない');
    for (const pattern of patternsOf(1)) master(progress, 1, pattern);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [done] = regionsOf(progress, adventure);
    assert.match(boardScene(done, layout, 18), /adv-goal is-open/);
  });

  it('景色は島ごとに決まっていて、開くたびに変わらない', () => {
    const regions = regionsOf(emptyProgress(), emptyAdventure());
    const scenes = regions.map((region) => boardScene(region, boardLayout(region.places.length), 1));
    assert.deepEqual(regions.map((region) => boardScene(region, boardLayout(region.places.length), 1)), scenes);
    assert.match(scenes[0], /a-sea/);
    assert.match(scenes[1], /a-river/);
    assert.match(scenes[2], /a-snowland/);
    for (const scene of scenes) {
      assert.equal((scene.match(/adv-start-sign/g) ?? []).length, 1);
      assert.equal((scene.match(/adv-goal-sign/g) ?? []).length, 1);
    }
  });
});
