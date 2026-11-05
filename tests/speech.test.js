import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  createRecognizer,
  diagnostics,
  isIOS,
  primeForListening,
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
  const calls = { ready: 0, interim: [], results: [], errors: [] };
  const recognizer = createRecognizer({
    onReady: () => { calls.ready += 1; },
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
    assert.deepEqual(calls, { ready: 0, interim: [], results: [], errors: [] });
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
    useDevice({ ...IPHONE, userAgent: `${IPHONE.userAgent} Version/27.2 Mobile/15E148 Safari/604.1` });
    listen();
    assert.match(diagnostics(), /^iOS Safari\/27\.2 /);
    assert.match(diagnostics(), /#\d+$/);
  });

  it('開始に失敗してもエラーとして返す', () => {
    FakeRecognition.throwOnStart = true;
    const { calls } = listen();
    assert.equal(calls.errors[0].code, 'start-failed');
  });
});

describe('iOS で報告されている動き', () => {
  beforeEach(() => useDevice(IPHONE));

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

  it('話し終えたら、stop を使わず abort で止めて途中結果で判定する', () => {
    const { calls, recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am a student'], false);
    mock.timers.tick(1499);
    assert.equal(recognition.aborted, 0);
    mock.timers.tick(1);
    assert.equal(recognition.aborted, 1);
    assert.equal(recognition.stopped, 0);
    assert.deepEqual(calls.results, [['I am a student']]);
  });

  it('話し続けている間は止めない', () => {
    const { recognition } = listen();
    recognition.onstart();
    recognition.emitResult(['I am'], false);
    mock.timers.tick(1400);
    recognition.emitResult(['I am a student'], false);
    mock.timers.tick(1400);
    assert.equal(recognition.aborted, 0);
  });

  it('話し終えるボタンでも、abort で止めて途中結果で判定する', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.emitResult(['I am a student'], false);
    recognizer.stop();
    assert.equal(recognition.stopped, 0);
    assert.deepEqual(calls.results, [['I am a student']]);
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

  it('何も話さずに話し終えるボタンを押したら、聞き取れなかったことにする', () => {
    const { recognizer, calls, recognition } = listen();
    recognition.onstart();
    recognizer.stop();
    assert.equal(calls.errors[0].kind, 'no-speech');
    assert.equal(calls.errors[0].code, 'stop');
  });
});

describe('次の認識の準備', () => {
  function finishSpeech() {
    speak('done');
    window.speechSynthesis.finish();
  }

  beforeEach(() => {
    useDevice(IPHONE);
    finishSpeech();
  });

  it('iOS で認識の後に読み上げがなければ、短い音声を流してから始める', () => {
    listen();
    let started = false;
    primeForListening(() => { started = true; });
    assert.equal(started, false);
    assert.equal(window.speechSynthesis.queue.length, 1);
    window.speechSynthesis.finish();
    assert.equal(started, true);
  });

  it('認識の後に読み上げが済んでいれば、音声を流さず始める', () => {
    listen();
    finishSpeech();
    let started = false;
    primeForListening(() => { started = true; });
    assert.equal(started, true);
    assert.equal(window.speechSynthesis.queue.length, 0);
  });

  it('最初の認識では、音声を流さず始める', () => {
    let started = false;
    primeForListening(() => { started = true; });
    assert.equal(started, true);
  });

  it('読み上げの終了が届かなくても、認識を始める', () => {
    listen();
    let started = false;
    primeForListening(() => { started = true; });
    mock.timers.tick(1680);
    assert.equal(started, true);
  });

  it('読み上げを止めたら、認識を始めない', () => {
    listen();
    let started = false;
    primeForListening(() => { started = true; });
    speak('other');
    mock.timers.tick(10_000);
    assert.equal(started, false);
  });

  it('PC では音声を流さず始める', () => {
    listen();
    useDevice(WINDOWS);
    let started = false;
    primeForListening(() => { started = true; });
    assert.equal(started, true);
  });
});

describe('読み上げの準備', () => {
  it('iOS では無音の読み上げで使えるようにする', () => {
    useDevice(IPHONE);
    unlockSpeech();
    assert.equal(window.speechSynthesis.queue[0].volume, 0);
  });

  it('PC では何もしない', () => {
    unlockSpeech();
    assert.equal(window.speechSynthesis.queue.length, 0);
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
