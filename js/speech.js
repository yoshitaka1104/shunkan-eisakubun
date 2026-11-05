/**
 * ブラウザの音声認識と音声合成をまとめる。
 * 認識の失敗は種類ごとに整理して返し、画面側が文字入力へ切り替えられるようにする。
 *
 * iPhone と iPad の Safari には次の報告があるため、OS を判別して動きを変えている。
 * - 音声を再生すると、次の音声認識が動かなくなることがある
 * - 話し終えても結果が確定しないことがある
 * - マイクの許可と同時に認識を始めると、すぐ終了することがある
 */

const LANGUAGE = 'en-US';
const MAX_ALTERNATIVES = 3;

/** 許可の確認画面に答える時間を含めて、認識が始まるのを待つ時間。 */
const START_TIMEOUT_MS = 20_000;
/** 認識が始まってから、最初の結果が届くまで待つ時間。 */
const FIRST_RESULT_TIMEOUT_MS = 12_000;
/** 途中結果が届いてから、次の結果が届くまで待つ時間。 */
const NEXT_RESULT_TIMEOUT_MS = 15_000;
/** iOS で途中結果が止まってから、話し終えたとみなすまでの時間。 */
const IOS_SILENCE_MS = 1800;
/** 話し終えたことを伝えてから、結果の確定を待つ時間。 */
const STOP_TIMEOUT_MS = 1000;

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
  return Boolean(recognitionClass());
}

/** iPhone と iPad を判別する。iPadOS の Safari は Mac として名乗るため、タッチ操作の有無も見る。 */
export function isIOS() {
  const { userAgent = '', platform = '', maxTouchPoints = 0 } = globalThis.navigator ?? {};
  return /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

/** 模範解答を自動で読み上げてよいか。iOS では次の音声認識を妨げるおそれがあるため控える。 */
export function canAutoSpeak() {
  return !isIOS();
}

/**
 * マイクの許可を先に確かめる。
 * iOS で許可の確認と音声認識の開始が重なるのを避けるために、学習を始める前に呼ぶ。
 */
export async function preflightMicrophone() {
  if (!navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

let activeRecognition = null;

function abortQuietly(recognition) {
  try {
    recognition.abort();
  } catch {
    // すでに終了している場合は何もしなくてよい。
  }
}

/**
 * 1回分の音声認識を作る。
 *
 * onResult か onError のどちらかが、必ず1回だけ呼ばれる(abort した場合を除く)。
 * trace には起きた出来事と経過ミリ秒が入る。実機でしか起きない問題の調査に使う。
 *
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onInterim 認識途中の英文。
 * @param {(candidates: string[]) => void} handlers.onResult 認識候補。確度の高い順。
 * @param {(kind: 'no-speech'|'network'|'denied'|'no-mic'|'unsupported',
 *   code: string, trace: string[]) => void} handlers.onError
 */
export function createRecognizer({ onInterim, onResult, onError }) {
  // 前回の認識が残っていると、次の開始に失敗することがある。
  if (activeRecognition) abortQuietly(activeRecognition);

  const Recognition = recognitionClass();
  const recognition = new Recognition();
  recognition.lang = LANGUAGE;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = MAX_ALTERNATIVES;
  activeRecognition = recognition;

  const startedAt = performance.now();
  const trace = [];
  let settled = false;
  let stopping = false;
  let interim = '';
  let watchdog = null;

  const note = (label) => trace.push(`${label}@${Math.round(performance.now() - startedAt)}`);

  const arm = (ms, onTimeout) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(onTimeout, ms);
  };

  /** 結果を受け取ったら認識を止め、マイクを手放す。 */
  const release = () => {
    clearTimeout(watchdog);
    if (activeRecognition === recognition) activeRecognition = null;
    abortQuietly(recognition);
  };

  const settle = (callback) => {
    if (settled) return;
    settled = true;
    release();
    callback();
  };

  const settleWithInterim = (code) => {
    settle(() => (interim.trim() ? onResult([interim]) : onError('no-speech', code, trace)));
  };

  const timeOut = () => {
    note('timeout');
    settleWithInterim('timeout');
  };

  const stop = () => {
    if (settled || stopping) return;
    stopping = true;
    note('stop');
    arm(STOP_TIMEOUT_MS, () => settleWithInterim('stop-timeout'));
    try {
      recognition.stop();
    } catch {
      settleWithInterim('stop-failed');
    }
  };

  recognition.onstart = () => {
    note('start');
    arm(FIRST_RESULT_TIMEOUT_MS, timeOut);
  };
  recognition.onaudiostart = () => note('audiostart');
  recognition.onspeechstart = () => note('speechstart');
  recognition.onspeechend = () => note('speechend');
  recognition.onaudioend = () => note('audioend');

  recognition.onresult = (event) => {
    const results = Array.from(event.results);
    const last = results.at(-1);
    const prefix = results.slice(0, -1).map((result) => result[0].transcript).join('');
    note(last.isFinal ? 'final' : 'interim');
    if (last.isFinal) {
      const candidates = Array.from(last, (alternative) => prefix + alternative.transcript);
      settle(() => onResult(candidates));
      return;
    }
    interim = prefix + last[0].transcript;
    onInterim(interim);
    if (stopping) return;
    if (isIOS()) arm(IOS_SILENCE_MS, stop);
    else arm(NEXT_RESULT_TIMEOUT_MS, timeOut);
  };

  recognition.onerror = (event) => {
    note(`error:${event.error}`);
    if (event.error === 'aborted') return;
    settle(() => onError(ERROR_KINDS[event.error] ?? 'no-speech', event.error, trace));
  };

  recognition.onend = () => {
    note('end');
    settleWithInterim('no-result');
  };

  return {
    start() {
      arm(START_TIMEOUT_MS, timeOut);
      try {
        recognition.start();
      } catch (error) {
        note(`start-failed:${error.name}`);
        settle(() => onError('no-speech', 'start-failed', trace));
      }
    },
    /** 話し終えたことを伝え、そこまでの音声で結果を出す。 */
    stop,
    /** 結果を受け取らずに打ち切る。 */
    abort() {
      settled = true;
      release();
    },
  };
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
