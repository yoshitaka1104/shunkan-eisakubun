import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLOSE_THRESHOLD, judge, normalize } from '../js/judge.js';

const tokens = (text) => normalize(text).join(' ');

describe('表記をそろえる', () => {
  const sameCases = [
    ['大文字小文字', 'HELLO World', 'hello world'],
    ['句読点', 'Hello, world!', 'hello world'],
    ['前後の記号', '"Hello" (world)', 'hello world'],
    ['ハイフン', 'well-known', 'well known'],
    ['余分な空白', '  I   am   here ', 'i am here'],
    ['am 短縮形', "I'm", 'i am'],
    ['are 短縮形', "they're", 'they are'],
    ['have 短縮形', "I've", 'i have'],
    ['will 短縮形', "we'll", 'we will'],
    ['would 短縮形', "I'd", 'i would'],
    ['not 短縮形', "don't", 'do not'],
    ["can't", "can't", 'can not'],
    ['cannot', 'cannot', 'can not'],
    ["won't", "won't", 'will not'],
    ["let's", "let's", 'let us'],
    ["人称代名詞の 's", "he's", 'he is'],
    ["疑問詞の 's", "where's", 'where is'],
    ["所有格の 's は残す", "Tom's", 'toms'],
    ['丸みのあるアポストロフィ', 'I’m', 'i am'],
    ['gonna', 'gonna', 'going to'],
    ['wanna', 'wanna', 'want to'],
    ["o'clock", "o'clock", 'oclock'],
    ['Mt. の省略形', 'Mt. Fuji', 'mount fuji'],
  ];
  for (const [name, input, expected] of sameCases) {
    it(name, () => assert.equal(tokens(input), expected));
  }
});

describe('数字をそろえる', () => {
  const numberCases = [
    ['1桁', '3', 'three'],
    ['10台', '13', 'thirteen'],
    ['2桁', '21', 'twenty one'],
    ['3桁', '500', 'five hundred'],
    ['3桁の端数', '125', 'one hundred twenty five'],
    ['カンマ区切り', '1,000', 'one thousand'],
    ['数字と綴りの一致', 'twenty-one', 'twenty one'],
    ['時刻', '7:30', 'seven thirty'],
    ['時刻の分が1桁', '7:05', 'seven oh five'],
    ['ちょうどの時刻', '7:00', 'seven oclock'],
    ['序数 1st', '1st', 'first'],
    ['序数 3rd', '3rd', 'third'],
    ['序数 12th', '12th', 'twelfth'],
    ['序数 20th', '20th', 'twentieth'],
    ['序数 21st', '21st', 'twenty first'],
  ];
  for (const [name, input, expected] of numberCases) {
    it(name, () => assert.equal(tokens(input), expected));
  }

  it('2 は同音語の to にそろう', () => assert.equal(tokens('2'), 'to'));
});

describe('同音語', () => {
  const groups = [
    ['there', 'their'],
    ['to', 'too', 'two'],
    ['for', 'four'],
    ['here', 'hear'],
    ['right', 'write'],
    ['buy', 'by'],
    ['know', 'no'],
    ['meet', 'meat'],
  ];
  for (const group of groups) {
    it(group.join(' / '), () => {
      const expected = tokens(group[0]);
      for (const word of group) assert.equal(tokens(word), expected);
    });
  }
});

describe('判定', () => {
  const answers = ['I drink coffee every morning.', 'I have coffee every morning.'];

  it('完全に一致すれば正解', () => {
    const verdict = judge({ candidates: ['I drink coffee every morning.'], answers });
    assert.equal(verdict.result, 'correct');
    assert.equal(verdict.similarity, 1);
  });

  it('大文字小文字と記号の違いは正解', () => {
    const verdict = judge({ candidates: ['i drink coffee every morning'], answers });
    assert.equal(verdict.result, 'correct');
  });

  it('2件目の正解例と一致しても正解', () => {
    const verdict = judge({ candidates: ['I have coffee every morning'], answers });
    assert.equal(verdict.result, 'correct');
    assert.equal(verdict.modelText, 'I have coffee every morning.');
  });

  it('短縮形の違いは正解', () => {
    assert.equal(judge({ candidates: ["I'm a student"], answers: ['I am a student.'] }).result, 'correct');
    assert.equal(judge({ candidates: ['I do not like cats'], answers: ["I don't like cats."] }).result, 'correct');
    assert.equal(judge({ candidates: ['He cannot speak Japanese'], answers: ["He can't speak Japanese."] }).result, 'correct');
  });

  it('同音語の認識違いは正解', () => {
    assert.equal(judge({ candidates: ['their is a book on the desk'], answers: ['There is a book on the desk.'] }).result, 'correct');
    assert.equal(judge({ candidates: ['I am to tired too walk'], answers: ['I am too tired to walk.'] }).result, 'correct');
  });

  it('音声認識が返す古い綴りは正解', () => {
    assert.equal(judge({ candidates: ['Will it rain to-morrow'], answers: ['Will it rain tomorrow?'] }).result, 'correct');
    assert.equal(judge({ candidates: ['You may go home early to-day'], answers: ['You may go home early today.'] }).result, 'correct');
    assert.equal(judge({ candidates: ['I will call you to-night'], answers: ['I will call you tonight.'] }).result, 'correct');
  });

  it("whose を who's と認識しても正解", () => {
    assert.equal(judge({ candidates: ["Who's notebook is this?"], answers: ['Whose notebook is this?'] }).result, 'correct');
    assert.equal(judge({ candidates: ["who's is this pen"], answers: ['Whose is this pen?'] }).result, 'correct');
  });

  it("who's は who is としても判定する", () => {
    assert.equal(judge({ candidates: ["Who's that man?"], answers: ['Who is that man?'] }).result, 'correct');
  });

  it('数字と綴りの違いは正解', () => {
    assert.equal(judge({ candidates: ['this temple was built five hundred years ago'], answers: ['This temple was built 500 years ago.'] }).result, 'correct');
    assert.equal(judge({ candidates: ['I have lived in this town for 10 years'], answers: ['I have lived in this town for ten years.'] }).result, 'correct');
  });

  it('1語違いなら惜しい', () => {
    const verdict = judge({ candidates: ['I drink tea every morning'], answers });
    assert.equal(verdict.result, 'close');
    assert.equal(verdict.similarity, 0.8);
  });

  it('語が欠けても類似度が高ければ惜しい', () => {
    const verdict = judge({ candidates: ['I drink coffee morning'], answers });
    assert.equal(verdict.result, 'close');
  });

  it('類似度が 0.7 ちょうどなら惜しい', () => {
    const verdict = judge({
      candidates: ['x y z d e f g h i j'],
      answers: ['a b c d e f g h i j'],
    });
    assert.equal(CLOSE_THRESHOLD, 0.7);
    assert.ok(Math.abs(verdict.similarity - 0.7) < 1e-9);
    assert.equal(verdict.result, 'close');
  });

  it('類似度が 0.7 未満なら不正解', () => {
    const verdict = judge({
      candidates: ['w x y z e f g h i j'],
      answers: ['a b c d e f g h i j'],
    });
    assert.ok(Math.abs(verdict.similarity - 0.6) < 1e-9);
    assert.equal(verdict.result, 'wrong');
  });

  it('無関係な文は不正解', () => {
    assert.equal(judge({ candidates: ['The weather is nice today'], answers }).result, 'wrong');
  });

  it('回答より正解例が短くても類似度は 0 未満にならない', () => {
    const verdict = judge({ candidates: ['one two three four five six seven'], answers: ['Hello there.'] });
    assert.equal(verdict.similarity, 0);
    assert.equal(verdict.result, 'wrong');
  });

  it('認識候補がなければ不正解', () => {
    const verdict = judge({ candidates: [], answers });
    assert.equal(verdict.result, 'wrong');
    assert.equal(verdict.answerText, '');
    assert.equal(verdict.modelText, answers[0]);
  });

  it('空白や記号だけの回答は不正解', () => {
    assert.equal(judge({ candidates: ['   ', '...'], answers }).result, 'wrong');
  });

  it('上位候補が外れても、下位候補が一致すれば正解', () => {
    const verdict = judge({
      candidates: ['I drink copy every morning', 'I drink coffee every morning'],
      answers,
    });
    assert.equal(verdict.result, 'correct');
    assert.equal(verdict.answerText, 'I drink coffee every morning');
  });

  it('同じ類似度なら上位の候補を採用する', () => {
    const verdict = judge({
      candidates: ['I drink tea every morning', 'I drink milk every morning'],
      answers,
    });
    assert.equal(verdict.answerText, 'I drink tea every morning');
  });

  it('最も近い正解例を模範解答として返す', () => {
    const verdict = judge({
      candidates: ['We stayed in home because it was raining'],
      answers: ['It was raining, so we stayed home.', 'We stayed at home because it was raining.'],
    });
    assert.equal(verdict.result, 'close');
    assert.equal(verdict.modelText, 'We stayed at home because it was raining.');
  });

  it('しきい値を変更できる', () => {
    const verdict = judge({ candidates: ['I drink tea every morning'], answers, threshold: 0.9 });
    assert.equal(verdict.result, 'wrong');
  });
});

describe('違う語の特定', () => {
  it('置き換わった語に印を付ける', () => {
    const verdict = judge({
      candidates: ['I drink tea every morning'],
      answers: ['I drink coffee every morning.'],
    });
    assert.deepEqual(verdict.answerWords.filter((word) => !word.ok).map((word) => word.text), ['tea']);
    assert.deepEqual(verdict.modelWords.filter((word) => !word.ok).map((word) => word.text), ['coffee']);
  });

  it('抜けた語は模範解答の側に印を付ける', () => {
    const verdict = judge({
      candidates: ['I drink coffee morning'],
      answers: ['I drink coffee every morning.'],
    });
    assert.ok(verdict.answerWords.every((word) => word.ok));
    assert.deepEqual(verdict.modelWords.filter((word) => !word.ok).map((word) => word.text), ['every']);
  });

  it('余分な語は回答の側に印を付ける', () => {
    const verdict = judge({
      candidates: ['I drink hot coffee every morning'],
      answers: ['I drink coffee every morning.'],
    });
    assert.deepEqual(verdict.answerWords.filter((word) => !word.ok).map((word) => word.text), ['hot']);
    assert.ok(verdict.modelWords.every((word) => word.ok));
  });

  it('短縮形は元の語のまま表示する', () => {
    const verdict = judge({ candidates: ["I'm a teacher"], answers: ['I am a student.'] });
    assert.deepEqual(verdict.answerWords, [
      { text: "I'm", ok: true },
      { text: 'a', ok: true },
      { text: 'teacher', ok: false },
    ]);
  });

  it('模範解答の句読点は表示に残す', () => {
    const verdict = judge({ candidates: ['Are you tired'], answers: ['Are you tired?'] });
    assert.equal(verdict.modelWords.at(-1).text, 'tired?');
  });
});
