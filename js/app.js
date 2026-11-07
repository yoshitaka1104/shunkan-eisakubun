/**
 * 画面の表示と学習の流れを担当する。
 * 判定は judge.js、記録は progress.js、音声は speech.js に任せる。
 */
import { BackupError, backupFileName, createBackup, readBackup, summarizeProgress } from './backup.js';
import { diagnostics, isIOS, logEvent } from './diagnostics.js';
import { judge } from './judge.js?v=1.5';
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
} from './speech.js?v=1.4';
import {
  isStandalone,
  isStoragePersisted,
  loadProgress,
  requestPersistentStorage,
  saveProgress,
} from './storage.js?v=1.6';

const APP_VERSION = 'v1.6';
const LEVEL_OPTIONS = ['all', 1, 2, 3];
const LEVEL_NAMES = { 1: '小学校', 2: '中学校', 3: '高校' };
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
/** 「記録の保存」画面で、読み込む前に確認している記録と、読み込めなかった理由。 */
let backupState = { pending: null, error: '' };

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

function knownQuestionIds() {
  return new Set(questions.map((question) => question.id));
}

function knownWeakIds() {
  const known = knownQuestionIds();
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
  const { attempts, rate } = totals(progress, knownQuestionIds());
  const weakCount = knownWeakIds().length;
  const levels = LEVEL_OPTIONS.map((value) => ({ value, text: value === 'all' ? 'すべて' : LEVEL_NAMES[value] }));
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
      ${shouldShowHomeScreenTip() ? HOME_SCREEN_TIP : ''}
      <p class="version">${APP_VERSION} · <button type="button" class="link-button" data-action="show-backup">記録の保存</button></p>
    </main>`;
}

const HOME_SCREEN_TIP = `
  <div class="tip">
    <p>ホーム画面に追加して開くと、記録が消えにくくなります。</p>
    <div class="tip-actions">
      <button type="button" class="text-button" data-action="show-backup">方法を見る</button>
      <button type="button" class="text-button" data-action="hide-home-tip">表示しない</button>
    </div>
  </div>`;

/** iPhone の Safari では、使わない期間が続くと記録が消えることがあるので、ホーム画面への追加を勧める。 */
function shouldShowHomeScreenTip() {
  return isIOS() && !isStandalone() && !progress.homeScreenTipHidden;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDateTime(value) {
  const date = new Date(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

const HOME_SCREEN_GUIDE = `
  <section class="backup-section">
    <h2>ホーム画面に追加する</h2>
    <p>iPhone の Safari は、しばらく使わないと保存した記録を消すことがあります。ホーム画面に追加したアプリは、その対象外とされています。</p>
    <ol class="steps">
      <li>下の「記録を書き出す」で今の記録を書き出し、「ファイル」に保存します。</li>
      <li>Safari の共有ボタンから「ホーム画面に追加」を選びます。共有ボタンが見当たらないときは、アドレス欄の横のメニューから開きます。</li>
      <li>「Webアプリとして開く」が表示されたらオンにして、「追加」を押します。</li>
      <li>ホーム画面のアイコンから開き、この画面で書き出したファイルを読み込みます。</li>
    </ol>
    <p class="hint">ホーム画面のアプリは、Safari とは別の場所に記録を保存するため、記録は自動では引き継がれません。初めて声で答えるときは、音声認識の準備とマイクの許可がもう一度必要です。</p>
  </section>`;

function confirmPanel() {
  const { progress: incoming, exportedAt } = backupState.pending;
  const known = knownQuestionIds();
  const next = summarizeProgress(incoming, known);
  const current = summarizeProgress(progress, known);
  const when = exportedAt ? `${formatDateTime(exportedAt)}に書き出した記録です。` : '書き出した日時が分からない記録です。';
  const warning = current.attempts > next.attempts
    ? '<p class="notice">今の記録のほうが回答数が多いです。置き換えると、今の記録は戻せません。</p>'
    : '';
  return `
    <div class="confirm" role="group" aria-label="読み込む記録の確認">
      <p>${when}</p>
      <p>回答${next.attempts}回、${next.questions}問、追加した正解例${next.customAnswers}文</p>
      <p>今の記録(回答${current.attempts}回)を、この内容で置き換えます。</p>
      ${warning}
      <div class="actions">
        <button type="button" class="primary" data-action="apply-backup">置き換える</button>
        <button type="button" class="secondary" data-action="cancel-backup">やめる</button>
      </div>
    </div>`;
}

function renderBackup() {
  const standalone = isStandalone();
  const summary = summarizeProgress(progress, knownQuestionIds());
  root.innerHTML = `
    <main class="screen backup">
      <header class="sub-head">
        <button type="button" class="text-button" data-action="go-home">戻る</button>
      </header>
      <div class="backup-intro">
        <h1>記録の保存</h1>
        <p>学習記録はこの端末の中だけに保存されます。消えたときに戻せるよう、ときどき書き出して保存してください。</p>
      </div>
      <dl class="status">
        <div><dt>開き方</dt><dd>${standalone ? 'ホーム画面のアプリ' : 'ブラウザ'}</dd></div>
        <div><dt>保存の保護</dt><dd data-persisted>確認しています</dd></div>
        <div><dt>前回の書き出し</dt><dd>${progress.lastBackupAt ? formatDateTime(progress.lastBackupAt) : 'まだありません'}</dd></div>
        <div><dt>今の記録</dt><dd>回答${summary.attempts}回、${summary.questions}問</dd></div>
      </dl>
      ${isIOS() && !standalone ? HOME_SCREEN_GUIDE : ''}
      <section class="backup-section">
        <h2>書き出す</h2>
        <p>記録を1つのファイルにします。iPhone では、表示された画面で「"ファイル"に保存」を選ぶと、「ファイル」アプリに残せます。</p>
        <button type="button" class="primary" data-action="export-backup">記録を書き出す</button>
        <button type="button" class="text-button" data-action="copy-backup">テキストでコピー</button>
      </section>
      <section class="backup-section" data-import>
        <h2>読み込む</h2>
        <p>書き出したファイルを選ぶと、今の記録をその内容で置き換えます。置き換える前に、内容を確認できます。</p>
        ${backupState.error ? `<p class="notice">${escapeHtml(backupState.error)}</p>` : ''}
        ${backupState.pending ? confirmPanel() : ''}
        <label class="secondary file-button" for="backup-file">ファイルを選ぶ</label>
        <input class="visually-hidden" id="backup-file" type="file" accept=".json,application/json">
        <details class="paste">
          <summary>テキストを貼り付けて読み込む</summary>
          <label for="backup-text">コピーした記録のテキスト</label>
          <textarea id="backup-text" rows="5" autocomplete="off" spellcheck="false"></textarea>
          <button type="button" class="secondary" data-action="read-pasted-backup">貼り付けた記録を読み込む</button>
        </details>
      </section>
    </main>`;
  showPersistence();
}

async function showPersistence() {
  const persisted = await isStoragePersisted();
  const label = root.querySelector('[data-persisted]');
  if (!label) return;
  if (persisted === null) label.textContent = 'このブラウザは対応していません';
  else label.textContent = persisted ? '有効' : '無効(ホーム画面のアプリで有効になりやすくなります)';
}

function openBackup() {
  backupState = { pending: null, error: '' };
  renderBackup();
  window.scrollTo(0, 0);
}

function markBackedUp(now) {
  progress.lastBackupAt = now.toISOString();
  saveProgress(progress);
}

/** iPhone では共有の画面から「ファイル」に保存し、それ以外ではファイルとしてダウンロードする。 */
async function exportBackup() {
  const now = new Date();
  const file = new File([createBackup(progress, now)], backupFileName(now), { type: 'application/json' });
  try {
    if (isIOS() && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '瞬間英作文の記録' });
    } else {
      const url = URL.createObjectURL(file);
      const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    markBackedUp(now);
    renderBackup();
    showToast('記録を書き出しました');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    showToast('書き出せませんでした。「テキストでコピー」を試してください');
  }
}

async function copyBackup() {
  const now = new Date();
  try {
    await navigator.clipboard.writeText(createBackup(progress, now));
    markBackedUp(now);
    renderBackup();
    showToast('コピーしました。メモなどに貼り付けて保存してください');
  } catch {
    showToast('コピーできませんでした。「記録を書き出す」を試してください');
  }
}

/** 読み込む記録を確かめ、置き換える前の確認を表示する。 */
function prepareImport(text) {
  try {
    backupState = { pending: readBackup(text), error: '' };
  } catch (error) {
    backupState = {
      pending: null,
      error: error instanceof BackupError ? error.message : 'このファイルは読み込めません。アプリで書き出したファイルを選んでください。',
    };
  }
  renderBackup();
  root.querySelector('[data-import]')?.scrollIntoView({ block: 'start' });
}

function applyBackup() {
  const { progress: incoming } = backupState.pending;
  for (const key of Object.keys(progress)) delete progress[key];
  Object.assign(progress, incoming);
  saveProgress(progress);
  backupState = { pending: null, error: '' };
  renderBackup();
  showToast('記録を読み込みました');
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
  'show-backup': openBackup,
  'hide-home-tip': () => {
    progress.homeScreenTipHidden = true;
    saveProgress(progress);
    renderHome();
  },
  'export-backup': exportBackup,
  'copy-backup': copyBackup,
  'read-pasted-backup': () => prepareImport(root.querySelector('#backup-text')?.value ?? ''),
  'apply-backup': applyBackup,
  'cancel-backup': () => {
    backupState = { pending: null, error: '' };
    renderBackup();
  },
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

root.addEventListener('change', async (event) => {
  if (event.target.id !== 'backup-file') return;
  const [file] = event.target.files;
  if (file) prepareImport(await file.text());
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
    if (isStandalone()) requestPersistentStorage().then((granted) => logEvent(`persist=${granted}`));
  } catch {
    root.innerHTML = `
      <main class="screen notice-screen">
        <h1>問題を読み込めませんでした</h1>
        <p>start.bat からアプリを起動してください。</p>
      </main>`;
  }
}

main();
