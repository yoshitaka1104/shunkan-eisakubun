/**
 * 画面の表示と学習の流れを担当する。
 * 判定は judge.js、記録は progress.js、音声は speech.js に任せる。
 */
import { diagnostics, isIOS } from './diagnostics.js';
import { judge } from './judge.js';
import {
  addCustomAnswer,
  answersFor,
  pickQuestions,
  reclassifyAsCorrect,
  recordResult,
  totals,
  weakQuestionIds,
} from './progress.js';
import {
  createRecognizer,
  isRecognitionSupported,
  needsPreparation,
  prepareRecognition,
  speak,
  stopSpeaking,
  unlockSpeech,
} from './speech.js?v=1.3';
import { loadProgress, saveProgress } from './storage.js';

const APP_VERSION = 'v1.3';
const LEVEL_OPTIONS = ['all', 1, 2, 3];
const COUNT_OPTIONS = [5, 10, 20, 'all'];
const TIME_LIMIT_OPTIONS = [0, 5, 10, 15, 20];
const AFTER_CORRECT_DELAY_MS = 500;
/** マイクの失敗がこの回数続いたら、最初から文字入力を出す。 */
const BLOCKING_FAILURE_LIMIT = 2;
const TOAST_MS = 2500;
/** iPhone と iPad で初回にダウンロードするデータの大きさ。 */
const DEVICE_MODEL_MB = 70;

const VERDICT_LABELS = { correct: '正解', close: '惜しい', wrong: '不正解' };

const RECOGNITION_MESSAGES = {
  'no-speech': '聞き取れませんでした。',
  network: '音声認識サービスに接続できませんでした。',
  denied: 'マイクまたは音声認識を使えませんでした。ブラウザと端末の設定を確認してください。',
  'no-mic': 'マイクを使えませんでした。ほかのアプリがマイクを使っていないか確認してください。',
  unsupported: 'この環境は英語の音声認識に対応していません。文字で回答してください。',
};
const IOS_RETRY_HINT = '続けて失敗するときは、「文字で入力」からキーボードのマイクを使ってください。';
const IOS_DICTATION_HINT = 'キーボードのマイクを押すと、声で入力できます。英語のキーボードに切り替えてから話してください。';
const UNSUPPORTED_MESSAGE = 'このブラウザは音声入力に対応していません。文字で回答してください。';
const PREPARE_FAILED_MESSAGE = '音声認識を準備できませんでした。通信状況を確認してください。今回は文字で回答してください。';
const BLOCKING_ERRORS = new Set(['denied', 'no-mic', 'unsupported']);

const MIC_ICON = `<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>
</svg>`;

const root = document.querySelector('#app');
const toast = document.querySelector('#toast');

const progress = loadProgress();
const filters = { level: 'all', count: 10 };
let questions = [];
let session = null;
let recognizer = null;
let timerId = null;
let timerRatio = 1;
let advanceTimer = null;
let toastTimer = null;

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, TOAST_MS);
}

function knownWeakIds() {
  const known = new Set(questions.map((question) => question.id));
  return weakQuestionIds(progress).filter((id) => known.has(id));
}

function segmented(action, options, selected, label) {
  const buttons = options
    .map(({ value, text }) => `<button type="button" data-action="${action}" data-value="${value}"
      aria-pressed="${String(value) === String(selected)}">${escapeHtml(text)}</button>`)
    .join('');
  return `<div class="segmented" role="group" aria-label="${escapeHtml(label)}">${buttons}</div>`;
}

function renderHome() {
  const { attempts, rate } = totals(progress);
  const weakCount = knownWeakIds().length;
  const levels = LEVEL_OPTIONS.map((value) => ({ value, text: value === 'all' ? 'すべて' : `レベル${value}` }));
  const counts = COUNT_OPTIONS.map((value) => ({ value, text: value === 'all' ? '全問' : `${value}問` }));
  const limits = TIME_LIMIT_OPTIONS.map((value) => ({ value, text: value === 0 ? 'なし' : `${value}秒` }));

  root.innerHTML = `
    <main class="screen home">
      <header class="home-head">
        <h1>瞬間英作文</h1>
        <p>日本語を見て、すぐ英語で言う。</p>
      </header>

      <dl class="stats">
        <div><dt>回答数</dt><dd>${attempts}</dd></div>
        <div><dt>正解率</dt><dd>${rate}<small>%</small></dd></div>
        <div><dt>苦手な問題</dt><dd>${weakCount}</dd></div>
      </dl>

      <section class="field">
        <h2>レベル</h2>
        ${segmented('set-level', levels, filters.level, 'レベル')}
      </section>
      <section class="field">
        <h2>問題数</h2>
        ${segmented('set-count', counts, filters.count, '問題数')}
      </section>
      <section class="field">
        <h2>制限時間</h2>
        ${segmented('set-time-limit', limits, progress.settings.timeLimitSec, '制限時間')}
      </section>

      <div class="home-actions">
        <button type="button" class="primary" data-action="start">始める</button>
        <button type="button" class="secondary" data-action="start-weak" ${weakCount === 0 ? 'disabled' : ''}>
          苦手な問題を出題 (${weakCount}問)
        </button>
      </div>
      ${isRecognitionSupported() ? '' : `<p class="notice">${UNSUPPORTED_MESSAGE}</p>`}
      <p class="version">${APP_VERSION}</p>
    </main>`;
}

const BROWSER_SPEECH_NOTICE = `
  <p>声で答えると、ブラウザの音声認識機能が英語を文字に変換します。</p>
  <p>ブラウザによっては、変換のために音声が提供元のサーバーへ送られます。このアプリ自身は、音声を保存しません。</p>`;

const DEVICE_SPEECH_NOTICE = `
  <p>声で答えると、この端末の中で英語を文字に変換します。音声は端末の外へ送らず、保存もしません。</p>
  <p>初回だけ、音声認識モデル(約${DEVICE_MODEL_MB}MB)をダウンロードします。</p>`;

function renderSpeechNotice() {
  root.innerHTML = `
    <main class="screen notice-screen">
      <h1>音声入力について</h1>
      ${isIOS() ? DEVICE_SPEECH_NOTICE : BROWSER_SPEECH_NOTICE}
      <p>学習記録はこの端末の中だけに保存します。マイクは、マイクボタンを押したときだけ起動します。</p>
      <button type="button" class="primary" data-action="accept-notice">わかりました</button>
      <button type="button" class="text-button" data-action="go-home">戻る</button>
    </main>`;
}

function requestStart(picked) {
  if (picked.length === 0) return;
  if (isRecognitionSupported() && !progress.speechNoticeSeen) {
    session = { pending: picked };
    renderSpeechNotice();
    return;
  }
  startSession(picked);
}

function renderPreparing() {
  root.innerHTML = `
    <main class="screen notice-screen">
      <h1>音声認識の準備</h1>
      <p data-preparing>準備しています</p>
      <p>初回だけ、音声認識モデル(約${DEVICE_MODEL_MB}MB)をダウンロードします。Wi-Fi での利用をおすすめします。2回目からは数秒で終わります。</p>
      <button type="button" class="text-button" data-action="go-home">やめる</button>
    </main>`;
}

function showPreparingProgress(loadedBytes) {
  const label = root.querySelector('[data-preparing]');
  if (label) label.textContent = `ダウンロードしています(${Math.round(loadedBytes / 1_000_000)}MB)`;
}

/** 音声認識モデルを読み込む。失敗したら、この学習は文字入力で続ける。 */
async function prepareVoice() {
  const current = session;
  renderPreparing();
  try {
    await prepareRecognition(showPreparingProgress);
  } catch (error) {
    current.voiceAvailable = false;
    current.preferTyping = true;
    current.notice = PREPARE_FAILED_MESSAGE;
    current.preparationError = `${error.message} ${diagnostics()}`;
  }
}

async function startSession(picked) {
  const voiceAvailable = isRecognitionSupported();
  session = {
    queue: picked,
    index: 0,
    firstResults: new Map(),
    voiceAvailable,
    preferTyping: !voiceAvailable,
    blockingFailures: 0,
    notice: voiceAvailable ? '' : UNSUPPORTED_MESSAGE,
    failureDetail: '',
    preparationError: '',
    phase: 'asking',
    verdict: null,
    timedOut: false,
  };
  unlockSpeech();
  if (voiceAvailable && needsPreparation()) await prepareVoice();
  // 準備の途中で「やめる」を押した場合は、始めない。
  if (session?.queue === picked) beginAttempt();
}

function currentQuestion() {
  return session.queue[session.index];
}

function isLastQuestion() {
  return session.index === session.queue.length - 1;
}

function stopTimer() {
  clearInterval(timerId);
  timerId = null;
}

function updateTimerView(ratio, secondsLeft) {
  timerRatio = ratio;
  const bar = root.querySelector('[data-timebar]');
  const label = root.querySelector('[data-time-left]');
  if (bar) bar.style.transform = `scaleX(${ratio})`;
  if (label) label.textContent = `残り${secondsLeft}秒`;
}

function startTimer() {
  stopTimer();
  timerRatio = 1;
  const limitMs = progress.settings.timeLimitSec * 1000;
  if (limitMs === 0) return;
  const deadline = performance.now() + limitMs;
  updateTimerView(1, Math.ceil(limitMs / 1000));
  timerId = setInterval(() => {
    const left = Math.max(deadline - performance.now(), 0);
    updateTimerView(left / limitMs, Math.ceil(left / 1000));
    if (left === 0) {
      stopTimer();
      session.timedOut = true;
      submitAnswer([]);
    }
  }, 100);
}

function cancelPendingWork() {
  stopTimer();
  stopSpeaking();
  clearTimeout(advanceTimer);
  recognizer?.abort();
  recognizer = null;
}

function beginAttempt() {
  cancelPendingWork();
  session.verdict = null;
  session.timedOut = false;
  session.failureDetail = '';
  session.phase = session.preferTyping ? 'typing' : 'asking';
  renderQuiz();
  startTimer();
}

function nextQuestion() {
  cancelPendingWork();
  if (isLastQuestion()) {
    renderSummary();
    return;
  }
  session.index += 1;
  if (!session.preferTyping) session.notice = '';
  beginAttempt();
}

function showListenHint(text) {
  const hint = root.querySelector('[data-hint]');
  if (hint) hint.textContent = text;
}

function showMicReady() {
  root.querySelector('[data-mic]')?.classList.add('is-listening');
  showListenHint('聞いています。話し終えたらタップ');
}

function showProcessing() {
  const mic = root.querySelector('[data-mic]');
  if (mic) {
    mic.classList.remove('is-listening');
    mic.disabled = true;
  }
  showListenHint('文字に変換しています');
}

function startListening() {
  stopTimer();
  stopSpeaking();
  session.phase = 'listening';
  session.notice = '';
  renderQuiz();
  recognizer = createRecognizer({
    onReady: showMicReady,
    onProcessing: showProcessing,
    onInterim(text) {
      const interim = root.querySelector('[data-interim]');
      if (interim) interim.textContent = text;
    },
    onResult(candidates) {
      recognizer = null;
      session.blockingFailures = 0;
      session.preferTyping = false;
      submitAnswer(candidates);
    },
    onError(kind, code) {
      recognizer = null;
      handleRecognitionError(kind, code);
    },
  });
  recognizer.start();
}

/**
 * 認識の失敗を画面に出す。
 * 一時的なエラーで音声入力を閉ざさないよう、続けて失敗したときだけ文字入力を標準にする。
 */
function handleRecognitionError(kind, code) {
  session.notice = RECOGNITION_MESSAGES[kind];
  session.failureDetail = `${code} ${diagnostics()}`;
  session.blockingFailures = BLOCKING_ERRORS.has(kind) ? session.blockingFailures + 1 : 0;
  if (session.blockingFailures >= BLOCKING_FAILURE_LIMIT) session.preferTyping = true;
  session.phase = session.preferTyping ? 'typing' : 'failed';
  renderQuiz();
}

function submitAnswer(candidates) {
  stopTimer();
  const question = currentQuestion();
  const verdict = judge({ candidates, answers: answersFor(question, progress) });
  if (!session.firstResults.has(question.id)) {
    session.firstResults.set(question.id, verdict.result);
    recordResult(progress, question.id, verdict.result);
    saveProgress(progress);
  }
  session.verdict = verdict;
  if (verdict.result === 'correct') {
    session.phase = 'correct';
    renderQuiz();
    speak(verdict.modelText, () => {
      advanceTimer = setTimeout(nextQuestion, AFTER_CORRECT_DELAY_MS);
    });
    return;
  }
  session.phase = 'review';
  renderQuiz();
  speak(verdict.modelText);
}

/** 自分の回答を正解例に加え、この問題を正解として記録し直す。 */
function acceptAnswer() {
  const question = currentQuestion();
  addCustomAnswer(progress, question.id, session.verdict.answerText);
  reclassifyAsCorrect(progress, question.id, session.firstResults.get(question.id));
  session.firstResults.set(question.id, 'correct');
  saveProgress(progress);
  showToast('正解例に追加しました');
  nextQuestion();
}

function askingPanel() {
  return `
    <button type="button" class="mic" data-action="mic" aria-label="マイクを起動して英語で答える">${MIC_ICON}</button>
    <p class="hint">タップして英語で答える</p>
    <button type="button" class="text-button" data-action="show-typing">文字で答える</button>`;
}

function listeningPanel() {
  return `
    <button type="button" class="mic" data-mic data-action="stop-mic" aria-label="話し終える">${MIC_ICON}</button>
    <p class="hint" data-hint>マイクを準備しています</p>
    <p class="interim" data-interim lang="en"></p>`;
}

function failureDetailHtml() {
  const detail = session.failureDetail || session.preparationError;
  if (!detail) return '';
  return `
    <details class="failure-detail">
      <summary>詳細</summary>
      <p lang="en">${escapeHtml(detail)}</p>
      <button type="button" class="text-button" data-action="copy-detail">コピー</button>
    </details>`;
}

function failedPanel() {
  return `
    <p class="notice">${escapeHtml(session.notice)}${isIOS() ? ` ${IOS_RETRY_HINT}` : ''}</p>
    ${failureDetailHtml()}
    <div class="actions">
      <button type="button" class="primary" data-action="mic">もう一度話す</button>
      <button type="button" class="secondary" data-action="show-typing">文字で入力</button>
    </div>`;
}

function typingPanel() {
  return `
    ${session.notice ? `<p class="notice">${escapeHtml(session.notice)}</p>` : ''}
    ${failureDetailHtml()}
    <form class="typing" data-form="answer">
      <label for="answer-input">英語で入力</label>
      <input id="answer-input" name="answer" type="text" lang="en" autocomplete="off" autocapitalize="off"
        autocorrect="off" spellcheck="false" enterkeyhint="done">
      <button type="submit" class="primary">回答する</button>
    </form>
    ${isIOS() ? `<p class="hint">${IOS_DICTATION_HINT}</p>` : ''}
    ${session.voiceAvailable ? '<button type="button" class="text-button" data-action="show-voice">声で答える</button>' : ''}`;
}

function nextLabel() {
  return isLastQuestion() ? '結果を見る' : '次へ';
}

function correctPanel() {
  return `
    <p class="verdict verdict-correct">${VERDICT_LABELS.correct}</p>
    <p class="model-answer" lang="en">${escapeHtml(session.verdict.modelText)}</p>
    <button type="button" class="primary" data-action="next">${nextLabel()}</button>`;
}

function wordsHtml(words) {
  return words
    .map((word) => (word.ok ? escapeHtml(word.text) : `<mark>${escapeHtml(word.text)}</mark>`))
    .join(' ');
}

function reviewPanel() {
  const { verdict, timedOut } = session;
  const label = timedOut ? '時間切れ' : VERDICT_LABELS[verdict.result];
  const answer = verdict.answerText
    ? `<span lang="en">${wordsHtml(verdict.answerWords)}</span>`
    : '回答なし';
  return `
    <p class="verdict verdict-${verdict.result}">${label}</p>
    <dl class="compare">
      <div><dt>あなたの回答</dt><dd>${answer}</dd></div>
      <div>
        <dt>模範解答</dt>
        <dd><span lang="en">${wordsHtml(verdict.modelWords)}</span></dd>
      </div>
    </dl>
    <button type="button" class="text-button" data-action="play-model">模範解答を聞く</button>
    <div class="actions">
      <button type="button" class="primary" data-action="retry">再挑戦</button>
      <button type="button" class="secondary" data-action="next">${nextLabel()}</button>
    </div>
    ${verdict.answerText ? '<button type="button" class="text-button" data-action="accept-answer">この回答を正解にする</button>' : ''}`;
}

const PANELS = {
  asking: askingPanel,
  listening: listeningPanel,
  failed: failedPanel,
  typing: typingPanel,
  correct: correctPanel,
  review: reviewPanel,
};

function renderQuiz() {
  const question = currentQuestion();
  const limit = progress.settings.timeLimitSec;
  const showTimer = limit > 0 && ['asking', 'listening', 'failed', 'typing'].includes(session.phase);
  root.innerHTML = `
    <main class="screen quiz">
      <header class="quiz-head">
        <button type="button" class="text-button" data-action="quit">やめる</button>
        <span class="quiz-count">${session.index + 1} / ${session.queue.length}</span>
      </header>
      <div class="timebar" ${showTimer ? '' : 'hidden'}>
        <span data-timebar style="transform: scaleX(${timerRatio})"></span>
      </div>
      <section class="prompt">
        <p class="pattern">${escapeHtml(question.pattern)}</p>
        <p class="japanese">${escapeHtml(question.ja)}</p>
        <p class="time-left" data-time-left ${showTimer ? '' : 'hidden'}></p>
      </section>
      <section class="panel panel-${session.phase}" aria-live="polite">${PANELS[session.phase]()}</section>
    </main>`;
  root.querySelector('#answer-input')?.focus();
}

function renderSummary() {
  const results = session.queue.map((question) => ({
    question,
    result: session.firstResults.get(question.id) ?? 'wrong',
  }));
  const count = (kind) => results.filter(({ result }) => result === kind).length;
  const missed = results.filter(({ result }) => result !== 'correct');
  const rate = Math.round((count('correct') / results.length) * 100);
  const missedItems = missed
    .map(({ question, result }) => `
      <li>
        <p class="missed-japanese">${escapeHtml(question.ja)}</p>
        <p class="missed-english" lang="en">${escapeHtml(answersFor(question, progress)[0])}</p>
        <p class="missed-result verdict-${result}">${VERDICT_LABELS[result]}</p>
      </li>`)
    .join('');

  root.innerHTML = `
    <main class="screen summary">
      <h1>結果</h1>
      <p class="score"><strong>${rate}</strong><small>%</small></p>
      <dl class="stats">
        <div><dt>正解</dt><dd>${count('correct')}</dd></div>
        <div><dt>惜しい</dt><dd>${count('close')}</dd></div>
        <div><dt>不正解</dt><dd>${count('wrong')}</dd></div>
      </dl>
      ${missed.length > 0 ? `<section><h2>今回の苦手な問題</h2><ol class="missed">${missedItems}</ol></section>` : ''}
      <div class="home-actions">
        ${missed.length > 0 ? '<button type="button" class="primary" data-action="retry-missed">間違えた問題をもう一度</button>' : ''}
        <button type="button" class="${missed.length > 0 ? 'secondary' : 'primary'}" data-action="go-home">ホームへ</button>
      </div>
    </main>`;
  window.scrollTo(0, 0);
}

function goHome() {
  cancelPendingWork();
  session = null;
  renderHome();
}

const ACTIONS = {
  'set-level': ({ value }) => {
    filters.level = value === 'all' ? 'all' : Number(value);
    renderHome();
  },
  'set-count': ({ value }) => {
    filters.count = value === 'all' ? 'all' : Number(value);
    renderHome();
  },
  'set-time-limit': ({ value }) => {
    progress.settings.timeLimitSec = Number(value);
    saveProgress(progress);
    renderHome();
  },
  start: () => requestStart(pickQuestions(questions, filters)),
  'start-weak': () => requestStart(pickQuestions(questions, { ids: knownWeakIds() })),
  'accept-notice': () => {
    progress.speechNoticeSeen = true;
    saveProgress(progress);
    startSession(session.pending);
  },
  mic: startListening,
  'stop-mic': () => recognizer?.stop(),
  'show-typing': () => {
    session.phase = 'typing';
    renderQuiz();
  },
  'show-voice': () => {
    session.phase = 'asking';
    session.notice = '';
    renderQuiz();
  },
  'copy-detail': async () => {
    try {
      await navigator.clipboard.writeText(session.failureDetail || session.preparationError);
      showToast('コピーしました');
    } catch {
      showToast('コピーできませんでした');
    }
  },
  'play-model': () => speak(session.verdict.modelText),
  retry: beginAttempt,
  next: nextQuestion,
  'accept-answer': acceptAnswer,
  'retry-missed': () => {
    const ids = session.queue
      .map((question) => question.id)
      .filter((id) => session.firstResults.get(id) !== 'correct');
    startSession(pickQuestions(questions, { ids }));
  },
  'go-home': goHome,
  quit: goHome,
};

root.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (button) ACTIONS[button.dataset.action](button.dataset);
});

root.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = event.target.elements.answer;
  if (input.value.trim()) submitAnswer([input.value]);
  else input.focus();
});

// 文字入力では、入力を始めた時点を回答開始として時間を止める。
root.addEventListener('input', (event) => {
  if (event.target.id === 'answer-input' && event.target.value) stopTimer();
});

async function main() {
  try {
    const response = await fetch('data/questions.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    questions = await response.json();
    renderHome();
  } catch {
    root.innerHTML = `
      <main class="screen notice-screen">
        <h1>問題を読み込めませんでした</h1>
        <p>start.bat からアプリを起動してください。</p>
      </main>`;
  }
}

main();
