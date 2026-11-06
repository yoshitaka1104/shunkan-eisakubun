/**
 * 音声認識と音声合成の入り口。
 * 認識の失敗は種類ごとに整理して返し、画面側が文字入力へ切り替えられるようにする。
 *
 * PC と Android はブラウザの音声認識を使う。
 * iPhone と iPad は標準の音声認識が続けて動かないため、device-speech.js で端末の中で変換する。
 */
import { createDeviceRecognizer, isDeviceSpeechSupported, prepareDeviceSpeech } from './device-speech.js?v=1.3.1';
import { isIOS, logEvent } from './diagnostics.js';

const LANGUAGE = 'en-US';
const MAX_ALTERNATIVES = 3;

/** 許可の確認画面に答える時間を含めて、認識が始まるのを待つ時間。 */
const START_TIMEOUT_MS = 20_000;
/** マイクが動き始めてから、最初の結果が届くまで待つ時間。 */
const FIRST_RESULT_TIMEOUT_MS = 12_000;
/** 途中結果が届いてから、次の結果が届くまで待つ時間。 */
const NEXT_RESULT_TIMEOUT_MS = 15_000;
/** 話し終えたことを伝えてから、結果の確定を待つ時間。 */
const STOP_TIMEOUT_MS = 1000;
/** 認識を止めてから、終了の通知を待つ時間。 */
const RELEASE_TIMEOUT_MS = 800;

const ERROR_KINDS = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-mic',
  network: 'network',
  'language-not-supported': 'unsupported',
};

function recognitionClass() {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function isRecognitionSupported() {
  return isIOS() ? isDeviceSpeechSupported() : Boolean(recognitionClass());
}

/** 学習を始める前に、音声認識の準備が必要か。 */
export function needsPreparation() {
  return isIOS();
}

/** 音声認識モデルを読み込む。needsPreparation が true のときに呼ぶ。 */
export function prepareRecognition(onProgress) {
  return prepareDeviceSpeech(onProgress);
}

let activeRecognition = null;
let recognitionCount = 0;

function abortQuietly(recognition) {
  try {
    recognition.abort();
  } catch {
    // すでに終了している場合は何もしなくてよい。
  }
}

/** ブラウザの音声認識で、1回分の認識を作る。 */
function createBrowserRecognizer({ onReady = () => {}, onInterim, onResult, onError }) {
  // 前回の認識が残っていると、次の開始に失敗することがある。
  if (activeRecognition) abortQuietly(activeRecognition);

  const Recognition = recognitionClass();
  const recognition = new Recognition();
  recognition.lang = LANGUAGE;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = MAX_ALTERNATIVES;
  activeRecognition = recognition;

  recognitionCount += 1;
  logEvent(`#${recognitionCount}`);

  const startedAt = performance.now();
  let settled = false;
  let stopping = false;
  let ended = false;
  let readyAnnounced = false;
  let interim = '';
  let watchdog = null;
  let afterRelease = null;

  const note = (label) => logEvent(`${label}@${Math.round(performance.now() - startedAt)}`);

  const arm = (ms, onTimeout) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(onTimeout, ms);
  };

  const forget = () => {
    clearTimeout(watchdog);
    if (activeRecognition === recognition) activeRecognition = null;
  };

  const finishRelease = () => {
    clearTimeout(watchdog);
    const callback = afterRelease;
    afterRelease = null;
    callback?.();
  };

  /** 認識を止めてマイクを手放し、終了を待ってから callback を呼ぶ。 */
  const settle = (callback) => {
    if (settled) return;
    settled = true;
    forget();
    if (ended) {
      callback();
      return;
    }
    afterRelease = callback;
    arm(RELEASE_TIMEOUT_MS, () => {
      note('release-timeout');
      finishRelease();
    });
    abortQuietly(recognition);
  };

  const settleWithInterim = (code) => {
    settle(() => (interim.trim() ? onResult([interim]) : onError('no-speech', code)));
  };

  const timeOut = () => {
    note('timeout');
    settleWithInterim('timeout');
  };

  const announceReady = () => {
    if (settled || readyAnnounced) return;
    readyAnnounced = true;
    onReady();
  };

  const finishSpeaking = () => {
    if (settled || stopping) return;
    note('stop');
    stopping = true;
    arm(STOP_TIMEOUT_MS, () => settleWithInterim('stop-timeout'));
    try {
      recognition.stop();
    } catch {
      settleWithInterim('stop-failed');
    }
  };

  recognition.onstart = () => {
    note('start');
    if (!settled) arm(FIRST_RESULT_TIMEOUT_MS, timeOut);
  };
  recognition.onaudiostart = () => {
    note('audiostart');
    if (!settled) arm(FIRST_RESULT_TIMEOUT_MS, timeOut);
    announceReady();
  };
  recognition.onspeechstart = () => note('speechstart');
  recognition.onspeechend = () => note('speechend');
  recognition.onaudioend = () => note('audioend');

  recognition.onresult = (event) => {
    const results = Array.from(event.results);
    const last = results.at(-1);
    const prefix = results.slice(0, -1).map((result) => result[0].transcript).join('');
    if (last.isFinal) note('final');
    else if (!interim) note('interim');
    if (settled) return;
    announceReady();
    if (last.isFinal) {
      const candidates = Array.from(last, (alternative) => prefix + alternative.transcript);
      settle(() => onResult(candidates));
      return;
    }
    interim = prefix + last[0].transcript;
    onInterim(interim);
    if (!stopping) arm(NEXT_RESULT_TIMEOUT_MS, timeOut);
  };

  recognition.onerror = (event) => {
    note(`error:${event.error}`);
    if (event.error === 'aborted') return;
    settle(() => onError(ERROR_KINDS[event.error] ?? 'no-speech', event.error));
  };

  recognition.onend = () => {
    note('end');
    ended = true;
    if (afterRelease) finishRelease();
    else settleWithInterim('no-result');
  };

  return {
    start() {
      arm(START_TIMEOUT_MS, timeOut);
      try {
        recognition.start();
      } catch (error) {
        note(`start-failed:${error.name}`);
        settle(() => onError('no-speech', 'start-failed'));
      }
    },
    stop: finishSpeaking,
    abort() {
      settled = true;
      afterRelease = null;
      forget();
      abortQuietly(recognition);
    },
  };
}

/**
 * 1回分の音声認識を作る。
 *
 * onResult か onError のどちらかが、必ず1回だけ呼ばれる(abort した場合を除く)。
 * どちらも認識の終了後に呼ぶので、続けて読み上げても認識と重ならない。
 * 返すオブジェクトの start はタップの処理の中で呼ぶ。stop は話し終えたことを伝え、abort は結果を受け取らずに打ち切る。
 *
 * @param {object} handlers
 * @param {() => void} [handlers.onReady] マイクが音を拾い始めたとき。
 * @param {(text: string) => void} [handlers.onInterim] 認識途中の英文。後から変わることがある。
 * @param {() => void} [handlers.onProcessing] 録音を終え、文字への変換を始めたとき。届かない端末もある。
 * @param {(candidates: string[]) => void} handlers.onResult 認識候補。確度の高い順。
 * @param {(kind: 'no-speech'|'network'|'denied'|'no-mic'|'unsupported', code: string) => void} handlers.onError
 */
export function createRecognizer(handlers) {
  return isIOS() ? createDeviceRecognizer(handlers) : createBrowserRecognizer(handlers);
}

let speakToken = 0;
let speakTimer = null;

export function stopSpeaking() {
  speakToken += 1;
  clearTimeout(speakTimer);
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

/**
 * 英文を読み上げる。
 * 読み上げ終了の通知が届かない環境でも学習が止まらないよう、一定時間で onDone を呼ぶ。
 */
export function speak(text, onDone = () => {}) {
  stopSpeaking();
  speakToken += 1;
  const token = speakToken;
  const finish = () => {
    if (token !== speakToken) return;
    speakToken += 1;
    clearTimeout(speakTimer);
    onDone();
  };

  if (!('speechSynthesis' in window)) {
    speakTimer = setTimeout(finish, 1200);
    return;
  }
  speakTimer = setTimeout(finish, Math.min(8000, 1500 + text.length * 90));
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = LANGUAGE;
  utterance.rate = 0.95;
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
}

/** iOS は最初の読み上げに画面操作が必要なので、タップの処理の中で呼んで読み上げを使えるようにする。 */
export function unlockSpeech() {
  if (!isIOS() || !('speechSynthesis' in window)) return;
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}
