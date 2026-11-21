import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { boardLayout, boardScene, placeSvg, roadPath, standPoint, starSvg } from '../js/adventure-art.js';
import {
  adventureRegions,
  areaOf,
  emptyAdventure,
  flagCount,
  placeKey,
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

/** 場所の3問をマスターにする。 */
function master(progress, level, pattern) {
  for (const question of questions.filter((item) => item.level === level && item.pattern === pattern)) {
    progress.review[question.id] = { stage: 3, due: '2026-12-01' };
  }
}

function patternsOf(level) {
  return [...new Set(questions.filter((question) => question.level === level).map((question) => question.pattern))];
}

function regionsOf(progress, adventure) {
  return adventureRegions(grammarMap(questions, progress), adventure);
}

describe('冒険の地図の地域', () => {
  it('105の場所が、どれも名前のある地域に入る', () => {
    const regions = regionsOf(emptyProgress(), emptyAdventure());
    const places = regions.flatMap((region) => region.places);
    assert.equal(places.length, 105);
    assert.deepEqual(places.filter((place) => place.area === 'いろいろな表現'), []);
  });

  it('同じ地域の場所は、道の上で続けて並ぶ', () => {
    for (const region of regionsOf(emptyProgress(), emptyAdventure())) {
      const starts = region.places.filter((place) => place.areaStart).map((place) => place.area);
      assert.equal(new Set(starts).size, starts.length, `${region.name}: ${starts.join('、')}`);
      assert.equal(region.places[0].areaStart, true);
    }
  });

  it('文法項目の名前から地域を決める', () => {
    assert.equal(areaOf('疑問文(be動詞で始まる)'), '文の種類');
    assert.equal(areaOf('動名詞を含む文'), '不定詞と動名詞');
    assert.equal(areaOf('関係副詞'), '関係詞');
    assert.equal(areaOf('前置詞+動名詞や関係詞'), '前置詞');
    assert.equal(areaOf('助動詞を含む受け身'), '助動詞');
    assert.equal(areaOf('It+seemなど+that節'), '文の組み立て');
    assert.equal(areaOf('itが句や節を指す用法'), 'itの使い方');
    assert.equal(areaOf('過去完了進行形'), '時制');
  });

  it('島は3つで、小学校17、中学校64、高校24の場所がある', () => {
    const regions = regionsOf(emptyProgress(), emptyAdventure());
    assert.deepEqual(regions.map(({ level, places }) => [level, places.length]), [[1, 17], [2, 64], [3, 24]]);
    assert.deepEqual(regions.map(({ name }) => name), ['はじまりの島', 'ひろい大陸', 'そびえる山々']);
    assert.deepEqual(regions.map(({ frontier }) => frontier), [0, 0, 0]);
  });
});

describe('旗', () => {
  it('3問ともマスターした場所に、旗を1回だけ立てる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [first] = patternsOf(1);
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
    const [first] = patternsOf(1);
    const ids = questions.filter((question) => question.pattern === first).map((question) => question.id);
    for (const id of ids.slice(0, 2)) progress.review[id] = { stage: 3, due: '2026-12-01' };
    assert.deepEqual(plantFlags(adventure, grammarMap(questions, progress), TODAY), []);
  });

  it('あとでマスターが外れても、旗は残る', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const [first] = patternsOf(1);
    master(progress, 1, first);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const id = questions.find((question) => question.pattern === first).id;
    progress.review[id] = { stage: 0, due: '2026-11-19' };
    plantFlags(adventure, grammarMap(questions, progress), '2026-11-19');
    const [region] = regionsOf(progress, adventure);
    assert.equal(region.places[0].flaggedOn, TODAY);
    assert.equal(region.places[0].complete, false);
    assert.equal(region.frontier, 1);
  });

  it('相棒は、まだ旗のない最初の場所に立つ', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const patterns = patternsOf(1);
    master(progress, 1, patterns[0]);
    master(progress, 1, patterns[2]);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [region] = regionsOf(progress, adventure);
    assert.equal(region.frontier, 1);
    assert.equal(region.flags, 2);
  });

  it('すべての場所に旗が立てば、相棒はゴールにいる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    for (const pattern of patternsOf(1)) master(progress, 1, pattern);
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

describe('地図を開いたときの動き', () => {
  it('前に見せた位置から、今の位置まで相棒が進み、新しい旗を一度だけ見せる', () => {
    const progress = emptyProgress();
    const adventure = emptyAdventure();
    const patterns = patternsOf(1);
    master(progress, 1, patterns[0]);
    master(progress, 1, patterns[1]);
    master(progress, 2, patternsOf(2)[0]);
    plantFlags(adventure, grammarMap(questions, progress), TODAY);
    const [region] = regionsOf(progress, adventure);
    const moves = takeMapMoves(adventure, region);
    assert.deepEqual(moves, { from: 0, to: 2, newFlags: [placeKey(1, patterns[0]), placeKey(1, patterns[1])] });
    assert.deepEqual(adventure.unseen, [placeKey(2, patternsOf(2)[0])], 'ほかの島の旗は、その島を開くまで残す');
    assert.deepEqual(takeMapMoves(adventure, region), { from: 2, to: 2, newFlags: [] });
  });

  it('覚えた位置が地図の外なら、ゴールまでにおさめる', () => {
    const adventure = emptyAdventure();
    adventure.at[1] = 99;
    const [region] = regionsOf(emptyProgress(), adventure);
    assert.equal(takeMapMoves(adventure, region).from, 17);
  });
});

describe('冒険の地図の読み込み', () => {
  it('使える旗と位置だけを取り出す', () => {
    const adventure = readAdventure({
      flags: { '1|単文': TODAY, '2|重文': 'きのう', '9|x': TODAY, '': TODAY, '3|分詞構文': '2026-11-01' },
      unseen: ['1|単文', '1|単文', '2|重文', 5],
      at: { 1: 3, 2: -1, 3: 1.5, 4: 2 },
    });
    assert.deepEqual(adventure, {
      flags: { '1|単文': TODAY, '3|分詞構文': '2026-11-01' },
      unseen: ['1|単文'],
      at: { 1: 3 },
    });
  });

  it('形の違うものは null にする', () => {
    assert.equal(readAdventure(undefined), null);
    assert.equal(readAdventure([]), null);
    assert.equal(readAdventure('flags'), null);
    assert.deepEqual(readAdventure({ flags: [], unseen: {}, at: [] }), emptyAdventure());
  });

  it('書き出した記録に旗が残り、古い記録では null になる', () => {
    const progress = emptyProgress();
    progress.adventure = emptyAdventure();
    progress.adventure.flags['1|単文'] = TODAY;
    progress.adventure.at[1] = 1;
    const restored = readBackup(createBackup(progress)).progress;
    assert.deepEqual(restored.adventure, { flags: { '1|単文': TODAY }, unseen: [], at: { 1: 1 } });
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
