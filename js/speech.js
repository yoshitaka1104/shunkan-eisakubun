/**
 * ブラウザの音声認識と音声合成をまとめる。
 * 認識の失敗は種類ごとに整理して返し、画面側が文字入力へ切り替えられるようにする。
 */

const LANGUAGE = 'en-US';
const MAX_ALTERNATIVES = 3;
const LISTEN_TIMEOUT_MS = 15_000;

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

/**
 * 1回分の音声認識を作る。
 *
 * onResult か onError のどちらかが、必ず1回だけ呼ばれる(abort した場合を除く)。
 *
 * @param {object} handlers
 * @param {(text: string) => void} handlers.onInterim 認識途中の英文。
 * @param {(candidates: string[]) => void} handlers.onResult 認識候補。確度の高い順。
 * @param {(kind: 'no-speech'|'network'|'denied'|'no-mic'|'unsupported') => void} handlers.onError
 */
export function createRecognizer({ onInterim, onResult, onError }) {
  const Recognition = recognitionClass();
  const recognition = new Recognition();
  recognition.lang = LANGUAGE;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = MAX_ALTERNATIVES;

  let settled = false;
  let interim = '';
  let watchdog = null;

  const settle = (callback) => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    callback();
  };

  const settleWithInterim = () => {
    settle(() => (interim.trim() ? onResult([interim]) : onError('no-speech')));
  };

  recognition.onresult = (event) => {
    const results = Array.from(event.results);
    const last = results.at(-1);
    const prefix = results.slice(0, -1).map((result) => result[0].transcript).join('');
    if (last.isFinal) {
      const candidates = Array.from(last, (alternative) => prefix + alternative.transcript);
      settle(() => onResult(candidates));
      return;
    }
    interim = prefix + last[0].transcript;
    onInterim(interim);
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted') return;
    settle(() => onError(ERROR_KINDS[event.error] ?? 'no-speech'));
  };

  recognition.onend = settleWithInterim;

  return {
    start() {
      watchdog = setTimeout(() => {
        recognition.abort();
        settleWithInterim();
      }, LISTEN_TIMEOUT_MS);
      try {
        recognition.start();
      } catch {
        settle(() => onError('no-speech'));
      }
    },
    /** 話し終えたことを伝え、そこまでの音声で結果を出す。 */
    stop() {
      recognition.stop();
    },
    /** 結果を受け取らずに打ち切る。 */
    abort() {
      settled = true;
      clearTimeout(watchdog);
      recognition.abort();
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
