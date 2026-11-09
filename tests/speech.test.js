import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { diagnostics, isIOS } from '../js/diagnostics.js';
import {
  createRecognizer,
  isRecognitionSupported,
  needsPreparation,
  speak,
  stopSpeaking,
  unlockSpeech,
} from '../js/speech.js';

const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone', maxTouchPoints: 5 };
const IPAD = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 };
const MAC = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 };
const WINDOWS = { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', platform: 'Win32', maxTouchPoints: 0 };

function useDevice(device) {
  Object.defineProperty(globalThis, 'navigator', { value: device, configurable: true });
}

class FakeRecognition {
  static instances = [];

  static throwOnStart = false;

  /** true のとき、abort しても終了の通知を出さない。 */
  static silentAbort = false;

  constructor() {
    this.started = 0;
    this.stopped = 0;
    this.aborted = 0;
    FakeRecognition.instances.push(this);
  }

  start() {
    if (FakeRecognition.throwOnStart) throw new DOMException('busy', 'InvalidStateError');
    this.started += 1;
  }

  stop() {
    this.stopped += 1;
  }

  abort() {
    this.aborted += 1;
    if (!FakeRecognition.silentAbort) this.onend?.();
  }

  emitResult(alternatives, isFinal) {
    const result = Object.assign(alternatives.map((transcript) => ({ transcript })), { isFinal });
    this.onresult({ results: [result] });
  }
}

/** アプリは再生の要素を1つだけ作るので、テストの間で同じものを使い続ける。 */
class FakeAudio {
  static last = null;

  static failPlay = false;

  played = [];

  paused = 0;

  constructor() {
    FakeAudio.last = this;
  }

  play() {
    this.played.push(this.src);
    return FakeAudio.failPlay ? Promise.reject(new Error('blocked')) : Promise.resolve();
  }

  pause() {
    this.paused += 1;
  }
}

class FakeSynthesis {
  queue = [];

  speak(utterance) {
    this.queue.push(utterance);
  }

  cancel() {
    this.queue = [];
  }

  /** 読み上げが最後まで終わったことにする。 */
  finish() {
    this.queue.shift()?.onend?.();
  }
}

const openRecognizers = [];

function listen() {
  const calls = { ready: 0, speechStart: [], interim: [], results: [], errors: [] };
  const recognizer = createRecognizer({
    onReady: () => { calls.ready += 1; },
    onSpeechStart: (ms) => calls.speechStart.push(ms),
    onInterim: (text) => calls.interim.push(text),
    onResult: (candidates) => calls.results.push(candidates),
    onError: (kind, code) => calls.errors.push({ kind, code }),
  });
  openRecognizers.push(recognizer);
  recognizer.start();
  return { recognizer, calls, recognition: FakeRecognition.instances.at(-1) };
}

beforeEach(() => {
  FakeRecognition.instances = [];
  FakeRecognition.throwOnStart = false;
  FakeRecognition.silentAbort = false;
  globalThis.window = { webkitSpeechRecognition: FakeRecognition, speechSynthesis: new FakeSynthesis() };
  FakeAudio.failPlay = false;
  globalThis.Audio = FakeAudio;
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  useDevice(WINDOWS);
  mock.timers.enable({ apis: ['setTimeout'] });
});

afterEach(() => {
  // 前のテストのタイマーが次のテストへ残らないよう、タイマーを戻す前に片付ける。
  openRecognizers.splice(0).forEach((recognizer) => recognizer.abort());
  stopSpeaking();
  mock.timers.reset();
});

describe('端末の判別', () => {
  it('iPhone を判別する', () => {
    useDevice(IPHONE);
    assert.equal(isIOS(), true);
  });

  it('Mac を名乗る iPad を判別する', () => {
    useDevice(IPAD);
    assert.equal(isIOS(), true);
  });

  it('Mac は iOS と判別しない', () => {
    useDevice(MAC);
    assert.equal(isIOS(), false);
  });

  it('Windows は iOS と判別しない', () => {
    assert.equal(isIOS(), false);
  });
});

describe('音声認識の使い分け', () => {
  it('PC はブラウザの音声認識を使う', () => {
    assert.equal(isRecognitionSupported(), true);
    assert.equal(needsPreparation(), false);
    listen();
    assert.equal(FakeRecognition.instances.length, 1);
  });

  it('PC でブラウザが音声認識を持たなければ、対応なしとする', () => {
    globalThis.window = {};
    assert.equal(isRecognitionSupported(), false);
  });

  it('iOS はブラウザの音声認識を使わず、準備が必要', () => {
    useDevice(IPHONE);
    assert.equal(needsPreparation(), true);
    createRecognizer({ onResult() {}, onError() {} });
    assert.equal(FakeRecognition.instances.length, 0);
  });

  it('iOS でマイクを使えない環境は、対応なしとする', () => {
    useDevice(IPHONE);
    assert.equal(isRecognitionSupported(), false);
  });
});

describe('音声認識の基本', () => {
  it('英語で認識し、候補を上位3件まで求める', () => {
    const { recognition } = listen();
    assert.equal(recognition.lang, 'en-US');
    assert.equal(recognition.maxAlternatives, 3);
    assert.equal(recognition.interimResults, true);
  });

  it('確定した候補を確度の高い順に返す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['first', 'second', 'third'], true);
    assert.deepEqual(calls.results, [['first', 'second', 'third']]);
  });

  it('途中結果を画面へ渡す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['I am'], false);
    assert.deepEqual(calls.interim, ['I am']);
    assert.deepEqual(calls.results, []);
  });

  it('結果は1回だけ返す', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['first'], true);
    recognition.onend();
    assert.equal(calls.results.length, 1);
    assert.equal(calls.errors.length, 0);
  });

  it('途中結果だけで終わった場合は、途中結果を回答にする', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['I am a student'], false);
    recognition.onend();
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('打ち切った後は結果を返さない', () => {
    const { recognizer, calls, recognition } = listen();
    recognizer.abort();
    recognition.onend();
    assert.equal(recognition.aborted, 1);
    assert.deepEqual(calls, { ready: 0, speechStart: [], interim: [], results: [], errors: [] });
  });
});

describe('マイクの準備', () => {
  it('マイクが動き始めたら知らせる', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    assert.equal(calls.ready, 0);
    recognition.onaudiostart();
    assert.equal(calls.ready, 1);
  });

  it('開始の通知がなくても、結果が届いたら知らせる', () => {
    const { calls, recognition } = listen();
    recognition.emitResult(['I am'], false);
    assert.equal(calls.ready, 1);
  });

  it('知らせるのは1回だけ', () => {
    const { calls, recognition } = listen();
    recognition.onaudiostart();
    recognition.emitResult(['I am'], false);
    assert.equal(calls.ready, 1);
  });

  it('打ち切った後は知らせない', () => {
    const { recognizer, calls, recognition } = listen();
    recognizer.abort();
    recognition.onaudiostart();
    assert.equal(calls.ready, 0);
  });

  it('話し始めたら、マイクが動き始めてからの時間を1回だけ知らせる', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.onaudiostart();
    recognition.onspeechstart();
    recognition.onspeechstart();
    assert.equal(calls.speechStart.length, 1);
    assert.ok(calls.speechStart[0] >= 0 && calls.speechStart[0] < 1000, String(calls.speechStart[0]));
  });

  it('マイクの開始より先に話し始めの通知が届いたら、ほぼ 0 として知らせる', () => {
    const { calls, recognition } = listen();
    recognition.onspeechstart();
    assert.equal(calls.ready, 1);
    assert.ok(calls.speechStart[0] >= 0 && calls.speechStart[0] < 50, String(calls.speechStart[0]));
  });

  it('打ち切った後は話し始めを知らせない', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.onaudiostart();
    recognizer.abort();
    recognition.onspeechstart();
    assert.deepEqual(calls.speechStart, []);
  });

  it('マイクの準備に時間がかかっても、話す時間を削らない', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    mock.timers.tick(3000);
    recognition.onaudiostart();
    mock.timers.tick(11_999);
    assert.equal(calls.errors.length, 0);
    mock.timers.tick(1);
    assert.equal(calls.errors[0].code, 'timeout');
  });
});

describe('マイクの解放', () => {
  it('結果を受け取ったらマイクを手放す', () => {
    const { recognition } = listen();
    recognition.emitResult(['first'], true);
    assert.equal(recognition.aborted, 1);
  });

  it('認識の終了を待ってから結果を返す', () => {
    FakeRecognition.silentAbort = true;
    const { calls, recognition } = listen();
    recognition.emitResult(['first'], true);
    assert.deepEqual(calls.results, []);
    recognition.onend();
    assert.deepEqual(calls.results, [['first']]);
  });

  it('終了の通知が届かなくても、結果を返す', () => {
    FakeRecognition.silentAbort = true;
    const { calls, recognition } = listen();
    recognition.emitResult(['first'], true);
    mock.timers.tick(799);
    assert.deepEqual(calls.results, []);
    mock.timers.tick(1);
    assert.deepEqual(calls.results, [['first']]);
  });

  it('終了を待っている間に打ち切ったら、結果を返さない', () => {
    FakeRecognition.silentAbort = true;
    const { recognizer, calls, recognition } = listen();
    recognition.emitResult(['first'], true);
    recognizer.abort();
    recognition.onend();
    mock.timers.tick(800);
    assert.deepEqual(calls.results, []);
  });

  it('エラーの後もマイクを手放す', () => {
    const { recognition } = listen();
    recognition.onerror({ error: 'no-speech' });
    assert.equal(recognition.aborted, 1);
  });

  it('前回の認識が残っていれば、次を始める前に止める', () => {
    const first = listen();
    const second = listen();
    assert.equal(first.recognition.aborted, 1);
    assert.equal(second.recognition.started, 1);
  });

  it('終わった認識は、次を始めるときに止め直さない', () => {
    const first = listen();
    first.recognition.emitResult(['first'], true);
    listen();
    assert.equal(first.recognition.aborted, 1);
  });

  it('毎回新しい認識を作る', () => {
    listen();
    listen();
    assert.equal(FakeRecognition.instances.length, 2);
  });
});

describe('エラー', () => {
  const cases = [
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['audio-capture', 'no-mic'],
    ['network', 'network'],
    ['language-not-supported', 'unsupported'],
    ['no-speech', 'no-speech'],
    ['something-new', 'no-speech'],
  ];
  for (const [code, kind] of cases) {
    it(`${code} を ${kind} として扱う`, () => {
      const { calls, recognition } = listen();
      recognition.onerror({ error: code });
      assert.equal(calls.errors[0].kind, kind);
      assert.equal(calls.errors[0].code, code);
    });
  }

  it('調査用に、起きた出来事の順番を記録する', () => {
    const { recognition } = listen();
    recognition.onstart();
    recognition.onaudiostart();
    recognition.onerror({ error: 'audio-capture' });
    const events = diagnostics().split(' ').map((entry) => entry.split('@')[0]);
    assert.deepEqual(events.slice(-4), ['start', 'audiostart', 'error:audio-capture', 'end']);
  });

  it('調査用の記録は、ブラウザの版と認識の回数を含む', () => {
    useDevice({ ...MAC, userAgent: `${MAC.userAgent} Version/27.2 Safari/605.1.15` });
    listen();
    assert.match(diagnostics(), /^PC Safari\/27\.2 /);
    assert.match(diagnostics(), /#\d+$/);
  });

  it('開始に失敗してもエラーとして返す', () => {
    FakeRecognition.throwOnStart = true;
    const { calls } = listen();
    assert.equal(calls.errors[0].code, 'start-failed');
  });
});

describe('認識が途中で止まったとき', () => {
  it('開始直後に何も起きず終了しても、エラーとして返す', () => {
    const { calls, recognition } = listen();
    recognition.onend();
    assert.equal(calls.errors[0].kind, 'no-speech');
    assert.equal(calls.errors[0].code, 'no-result');
  });

  it('aborted だけでは失敗にせず、終了を待つ', () => {
    const { calls, recognition } = listen();
    recognition.onerror({ error: 'aborted' });
    assert.equal(calls.errors.length, 0);
    recognition.onend();
    assert.equal(calls.errors[0].kind, 'no-speech');
  });

  it('イベントが何も届かなくても、学習が止まらない', () => {
    const { calls } = listen();
    mock.timers.tick(20_000);
    assert.equal(calls.errors[0].kind, 'no-speech');
    assert.equal(calls.errors[0].code, 'timeout');
  });

  it('開始の後に結果が届かなくても、学習が止まらない', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.onaudiostart();
    mock.timers.tick(12_000);
    assert.equal(calls.errors[0].code, 'timeout');
  });
});

describe('読み上げの準備', () => {
  it('タップの中で無音のファイルを鳴らし、後から再生できるようにする', () => {
    unlockSpeech();
    assert.equal(FakeAudio.last.played.at(-1), 'audio/silence.mp3');
  });

  it('iOS では音声合成も無音で使えるようにする', () => {
    useDevice(IPHONE);
    unlockSpeech();
    assert.equal(window.speechSynthesis.queue[0].volume, 0);
  });

  it('PC では音声合成の準備はいらない', () => {
    unlockSpeech();
    assert.equal(window.speechSynthesis.queue.length, 0);
  });
});

describe('模範解答の読み上げ', () => {
  it('音声ファイルを再生する', () => {
    speak("I'm a student.");
    assert.equal(FakeAudio.last.played.at(-1), 'audio/im-a-student.mp3');
    assert.equal(window.speechSynthesis.queue.length, 0);
  });

  it('再生が終わったら知らせる', () => {
    let done = 0;
    speak('I am a student.', () => { done += 1; });
    FakeAudio.last.onended();
    assert.equal(done, 1);
  });

  it('ファイルがなければ、ブラウザの音声合成で読み上げる', () => {
    let done = 0;
    speak('My own answer.', () => { done += 1; });
    FakeAudio.last.onerror();
    assert.equal(window.speechSynthesis.queue[0].text, 'My own answer.');
    window.speechSynthesis.finish();
    assert.equal(done, 1);
  });

  it('再生を拒否されたら、ブラウザの音声合成で読み上げる', async () => {
    FakeAudio.failPlay = true;
    speak('I am a student.');
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(window.speechSynthesis.queue[0].text, 'I am a student.');
  });

  it('終了の通知が届かなくても、学習が止まらない', () => {
    let done = 0;
    speak('Short.', () => { done += 1; });
    mock.timers.tick(2040);
    assert.equal(done, 1);
  });

  it('止めたら再生を止め、完了を知らせない', () => {
    let done = 0;
    speak('I am a student.', () => { done += 1; });
    const paused = FakeAudio.last.paused;
    stopSpeaking();
    assert.equal(FakeAudio.last.paused, paused + 1);
    assert.equal(FakeAudio.last.onended, null);
    mock.timers.tick(10_000);
    assert.equal(done, 0);
  });

  it('止めた後に再生の失敗が届いても、音声合成に切り替えない', async () => {
    FakeAudio.failPlay = true;
    speak('I am a student.');
    stopSpeaking();
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(window.speechSynthesis.queue.length, 0);
  });

  it('次の読み上げを始めたら、前の完了は知らせない', () => {
    const done = [];
    speak('First.', () => done.push('first'));
    const firstEnded = FakeAudio.last.onended;
    speak('Second.', () => done.push('second'));
    firstEnded();
    FakeAudio.last.onended();
    assert.deepEqual(done, ['second']);
  });
});

describe('PC の動き', () => {
  it('途中結果が止まっても、ブラウザの確定を待つ', () => {
    const { recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am'], false);
    mock.timers.tick(5000);
    assert.equal(recognition.stopped, 0);
    assert.equal(recognition.aborted, 0);
  });

  it('話し終えるボタンの後に確定した結果を使う', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.emitResult(['I am a stud'], false);
    recognizer.stop();
    assert.equal(recognition.stopped, 1);
    recognition.emitResult(['I am a student'], true);
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('話し終えるボタンの後に反応がなければ、途中結果で判定する', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.emitResult(['I am a stud'], false);
    recognizer.stop();
    mock.timers.tick(1000);
    assert.deepEqual(calls.results, [['I am a stud']]);
  });
});
