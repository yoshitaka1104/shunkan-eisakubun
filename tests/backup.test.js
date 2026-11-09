import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BackupError,
  backupFileName,
  createBackup,
  readBackup,
  summarizeProgress,
} from '../js/backup.js';
import { emptyProgress, recordResult } from '../js/progress.js';

function sampleProgress() {
  const progress = emptyProgress();
  progress.settings.timeLimitSec = 15;
  progress.speechNoticeSeen = true;
  recordResult(progress, 'E-001', 'correct', 1000);
  recordResult(progress, 'J-010', 'wrong', 2000);
  progress.customAnswers['J-010'] = ['My own answer.'];
  progress.review = { 'E-001': { stage: 3, due: '2026-11-15' }, 'J-010': { stage: 0, due: '2026-11-09' } };
  progress.days = { '2026-11-07': 4, '2026-11-08': 2 };
  progress.achievements = { 'first-correct': '2026-11-07' };
  progress.speed = { days: { '2026-11-08': { totalMs: 4200, count: 2 } }, questions: { 'E-001': 1800 } };
  return progress;
}

function fileWith(progress) {
  return JSON.stringify({ app: 'shunkan-eisakubun', format: 1, exportedAt: '2026-11-07T09:00:00.000Z', progress });
}

describe('書き出し', () => {
  it('書き出した記録を読み込むと、元の記録に戻る', () => {
    const progress = sampleProgress();
    const { progress: restored, exportedAt } = readBackup(createBackup(progress, new Date('2026-11-07T09:00:00Z')));
    assert.deepEqual(restored, { ...progress, lastBackupAt: null });
    assert.equal(exportedAt.toISOString(), '2026-11-07T09:00:00.000Z');
  });

  it('ファイル名に端末の日付を付ける', () => {
    assert.equal(backupFileName(new Date(2026, 10, 7, 23, 59)), 'shunkan-eisakubun-2026-11-07.json');
  });

  it('前回の書き出し日時も引き継ぐ', () => {
    const progress = { ...sampleProgress(), lastBackupAt: '2026-11-01T00:00:00.000Z' };
    assert.equal(readBackup(createBackup(progress)).progress.lastBackupAt, '2026-11-01T00:00:00.000Z');
  });
});

describe('読み込めないファイル', () => {
  const cases = [
    ['JSON ではない', 'not json', /読み込めません/],
    ['別のアプリのファイル', JSON.stringify({ app: 'other', format: 1, progress: {} }), /記録のファイルではありません/],
    ['記録が入っていない', JSON.stringify({ app: 'shunkan-eisakubun', format: 1 }), /記録のファイルではありません/],
    ['配列', '[]', /記録のファイルではありません/],
    ['新しい版の形式', JSON.stringify({ app: 'shunkan-eisakubun', format: 2, progress: {} }), /新しい版/],
  ];
  for (const [name, text, message] of cases) {
    it(name, () => {
      assert.throws(() => readBackup(text), (error) => error instanceof BackupError && message.test(error.message));
    });
  }
});

describe('書き換えられたファイル', () => {
  it('壊れた記録は除き、使える記録だけを取り出す', () => {
    const { progress } = readBackup(fileWith({
      stats: {
        good: { attempts: 2, correct: 1, close: 0, wrong: 1, last: 'wrong', lastAt: 5 },
        empty: { attempts: 0, correct: 0, close: 0, wrong: 0 },
        broken: 'yes',
        odd: { attempts: -3, correct: 'many', close: 1.5, wrong: 0, last: 'perfect' },
      },
    }));
    assert.deepEqual(progress.stats, { good: { attempts: 2, correct: 1, close: 0, wrong: 1, last: 'wrong', lastAt: 5 } });
  });

  it('追加した正解例は、文字列だけを重複なく取り出す', () => {
    const { progress } = readBackup(fileWith({
      customAnswers: { a: [' Hello. ', 'Hello.', 3, '', 'x'.repeat(300)], b: 'not a list' },
    }));
    assert.deepEqual(progress.customAnswers, { a: ['Hello.'] });
  });

  it('おかしな制限時間は既定値にする', () => {
    assert.equal(readBackup(fileWith({ settings: { timeLimitSec: 999 } })).progress.settings.timeLimitSec, 10);
    assert.equal(readBackup(fileWith({ settings: { timeLimitSec: 0 } })).progress.settings.timeLimitSec, 0);
  });

  it('項目がなくても空の記録として読める', () => {
    assert.deepEqual(readBackup(fileWith({})).progress, emptyProgress());
  });

  it('書き出し日時が読めなければ null にする', () => {
    const text = JSON.stringify({ app: 'shunkan-eisakubun', format: 1, exportedAt: 'yesterday', progress: {} });
    assert.equal(readBackup(text).exportedAt, null);
  });
});

describe('習熟度と学習した日', () => {
  it('習熟度と学習した日も書き出して戻せる', () => {
    const { progress } = readBackup(createBackup(sampleProgress()));
    assert.deepEqual(progress.review, sampleProgress().review);
    assert.deepEqual(progress.days, sampleProgress().days);
  });

  it('壊れた習熟度は除く', () => {
    const { progress } = readBackup(fileWith({
      review: {
        good: { stage: 2, due: '2026-11-10' },
        tooHigh: { stage: 9, due: '2026-11-10' },
        noDue: { stage: 1 },
        badDue: { stage: 1, due: 'tomorrow' },
        broken: 3,
      },
    }));
    assert.deepEqual(progress.review, { good: { stage: 2, due: '2026-11-10' } });
  });

  it('実績も書き出して戻せる', () => {
    assert.deepEqual(readBackup(createBackup(sampleProgress())).progress.achievements, { 'first-correct': '2026-11-07' });
  });

  it('壊れた実績は除く', () => {
    const { progress } = readBackup(fileWith({ achievements: { 'first-correct': '2026-11-07', 'bad id!': '2026-11-07', 'answers-50': 'today' } }));
    assert.deepEqual(progress.achievements, { 'first-correct': '2026-11-07' });
  });

  it('速さも書き出して戻せる', () => {
    assert.deepEqual(readBackup(createBackup(sampleProgress())).progress.speed, sampleProgress().speed);
  });

  it('壊れた速さは除く', () => {
    const { progress } = readBackup(fileWith({
      speed: {
        days: {
          '2026-11-08': { totalMs: 4200, count: 2 },
          '2026-11-09': { totalMs: 50_000, count: 1 },
          '2026-11-10': { totalMs: 1000, count: 0 },
          '2026-11-11': { totalMs: 'fast', count: 1 },
          yesterday: { totalMs: 1000, count: 1 },
        },
        questions: { a: 1500, b: -3, c: 99_999, d: 'quick' },
      },
    }));
    assert.deepEqual(progress.speed, { days: { '2026-11-08': { totalMs: 4200, count: 2 } }, questions: { a: 1500 } });
  });

  it('壊れた学習日は除く', () => {
    const { progress } = readBackup(fileWith({ days: { '2026-11-08': 3, '2026-11-09': 0, yesterday: 2, '2026-11-10': 'many' } }));
    assert.deepEqual(progress.days, { '2026-11-08': 3 });
  });
});

describe('記録の要約', () => {
  it('回答数、記録のある問題数、マスター数、学習した日数、追加した正解例の数を数える', () => {
    assert.deepEqual(
      summarizeProgress(sampleProgress()),
      { attempts: 2, questions: 2, mastered: 1, days: 2, achievements: 1, customAnswers: 1 },
    );
  });

  it('収録中の問題だけを数えられる', () => {
    assert.deepEqual(
      summarizeProgress(sampleProgress(), new Set(['J-010'])),
      { attempts: 1, questions: 1, mastered: 0, days: 2, achievements: 1, customAnswers: 1 },
    );
  });
});
