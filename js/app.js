/**
 * 画面の表示と学習の流れを担当する。
 * 判定は judge.js、記録は progress.js、習熟度と復習は review.js、連続学習日数は streak.js、
 * 実績は achievements.js、答えるまでの速さは speed.js、連続正解は combo.js、
 * 育つ相棒は companion.js(絵は companion-art.js)、冒険の地図は adventure.js(絵は adventure-art.js)、
 * 音声は speech.js に任せる。
 */
import { ACHIEVEMENTS, achievementProgress, earnedCount, unlockAchievements } from './achievements.js';
import { boardLayout, boardScene, markerSvg, placeSvg, roadPath, standPoint, starSvg } from './adventure-art.js?v=1.13';
import {
  adventureRegions, emptyAdventure, flagCount, placeKey, plantFlags, removeFlag, takeMapMoves,
} from './adventure.js?v=1.13';
import { BackupError, backupFileName, createBackup, readBackup, summarizeProgress } from './backup.js?v=1.13';
import { comboAt, comboMessage, longestCombo } from './combo.js?v=1.11';
import { companionSvg } from './companion-art.js?v=1.13';
import {
  canReceiveEgg,
  displayName,
  FAST_MS,
  feedCompanion,
  formById,
  formId,
  formName,
  FORMS,
  NAME_MAX_LENGTH,
  newCompanion,
  nextStep,
  RARE_SUFFIX,
  receiveEgg,
  SECRETS,
  SPECIES,
  STAGE_LABELS,
  STAGE_POINTS,
  takeNews,
  VARIANTS,
} from './companion.js?v=1.13';
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
  daysBetween,
  dueQuestionIds,
  grammarMap,
  localDate,
  MASTERY_LABELS,
  masterySummary,
  nextReview,
  recordAsCorrectInstead,
  recordReview,
} from './review.js';
import {
  createRecognizer,
  isRecognitionSupported,
  needsPreparation,
  prepareRecognition,
  speak,
  stopSpeaking,
  unlockSpeech,
} from './speech.js?v=1.9.1';
import {
  answerTime, emptySpeed, formatSeconds, recordSpeed, speedChange, speedSummary, unrecordSpeed,
} from './speed.js?v=1.10';
import {
  isStandalone,
  isStoragePersisted,
  loadProgress,
  requestPersistentStorage,
  saveProgress,
} from './storage.js?v=1.6';
import { busiestDay, recentDays, studyStreak } from './streak.js';


const APP_VERSION = 'v1.13';
const LEVEL_OPTIONS = ['all', 1, 2, 3];
const LEVEL_NAMES = { 1: '小学校', 2: '中学校', 3: '高校' };
const COUNT_OPTIONS = [5, 10, 20, 'all'];
const TIME_LIMIT_OPTIONS = [0, 5, 10, 15, 20];
const AFTER_CORRECT_DELAY_MS = 500;
/** マイクの失敗がこの回数続いたら、最初から文字入力を出す。 */
const BLOCKING_FAILURE_LIMIT = 2;
const TOAST_MS = 2500;
/** 「元に戻す」などのボタンがある知らせを出しておく時間。 */
const TOAST_ACTION_MS = 6000;
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
// 古い版で保存した記録や、公開直後に古いファイルが混ざった場合でも、新しい記録欄を使えるようにする。
progress.review ??= {};
progress.days ??= {};
progress.achievements ??= {};
progress.speed ??= emptySpeed();
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
/** 冒険の地図で表示しているレベル。最初に開いたときに、旗のない場所が残るレベルを選ぶ。 */
let mapLevel = null;
/** 冒険の地図で選んでいる場所(レベルごと)。選んでいなければ、相棒のいる場所を出す。 */
const mapSelected = {};
/** 地図の相棒を歩かせるタイマー。 */
let walkTimers = [];
/** ホームで出題の設定を開いているか。null のあいだは、まだ答えていない人にだけ開いて見せる。 */
let settingsOpen = null;

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]);
}

const toastQueue = [];

function dismissToast() {
  clearTimeout(toastTimer);
  toastQueue.shift();
  if (toastQueue.length > 0) displayNextToast();
  else toast.hidden = true;
}

function displayNextToast() {
  const { text, action } = toastQueue[0];
  const message = document.createElement('span');
  message.textContent = text;
  toast.replaceChildren(message);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      dismissToast();
      action.run();
    });
    toast.append(button);
  }
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(dismissToast, action ? TOAST_ACTION_MS : TOAST_MS);
}

/**
 * 短い知らせを出す。前の知らせが出ている間は、順番を待つ。
 * @param {string} text
 * @param {object} [options]
 * @param {{ label: string, run: () => void }} [options.action] 知らせの横に出すボタン。押す時間があるよう、長めに出す。
 * @param {boolean} [options.first] 順番を待たずに出す。ボタンのある知らせと、操作の結果の知らせに使う。
 */
function showToast(text, { action = null, first = Boolean(action) } = {}) {
  const item = { text, action };
  if (first && toastQueue.length > 0) {
    // 出ていた知らせは、その後にもう一度出す。
    toastQueue.unshift(item);
    displayNextToast();
    return;
  }
  toastQueue.push(item);
  if (toastQueue.length === 1) displayNextToast();
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

/** 復習の予定日を「今日」「明日」「11月10日」のように表す。 */
function formatDay(day, today) {
  const diff = daysBetween(today, day);
  if (diff <= 0) return '今日';
  if (diff === 1) return '明日';
  const [, month, date] = day.split('-').map(Number);
  return `${month}月${date}日`;
}

function todaysReviewIds() {
  return dueQuestionIds(progress, localDate(), knownQuestionIds());
}

/**
 * 今日の復習。復習があるときは、「始める」と同じ青いボタンで出す。
 * まだ答えた問題がなければ出さない。
 */
function reviewCard(due) {
  if (due > 0) {
    return `
      <section class="review-card has-due">
        <div class="review-text">
          <h2>今日の復習</h2>
          <p>${due}問</p>
        </div>
        <button type="button" class="primary" data-action="start-review">復習する</button>
      </section>`;
  }
  const today = localDate();
  const next = nextReview(progress, today, knownQuestionIds());
  if (!next) return '';
  return `
    <section class="review-card">
      <div class="review-text">
        <h2>今日の復習</h2>
        <p>今日の分は終わりました。次は${formatDay(next.day, today)}に${next.count}問です。</p>
      </div>
    </section>`;
}

function streakCard() {
  const today = localDate();
  const { current, best, studiedToday } = studyStreak(progress.days, today);
  let message = '今日の学習を記録しました。';
  if (current === 0) message = '今日学習すると、1日目になります。';
  else if (!studiedToday) message = `今日学習すると${current + 1}日になります。`;
  const week = recentDays(progress.days, today)
    .map(({ weekday, studied, isToday }) => `
      <li class="${studied ? 'is-studied' : ''}${isToday ? ' is-today' : ''}">
        <span class="visually-hidden">${isToday ? '今日' : `${weekday}曜日`}は${studied ? '学習した' : '学習していない'}</span>
        <span aria-hidden="true">${weekday}</span>
      </li>`)
    .join('');
  return `
    <section class="streak-card" aria-label="連続学習">
      <div class="streak-text">
        <p class="streak-count"><strong>${current}</strong>日連続</p>
        <p class="streak-detail">最長 ${best}日。${message}</p>
      </div>
      <ol class="week">${week}</ol>
    </section>`;
}

const SPARK = { width: 140, height: 44, pad: 6 };

function formatMonthDay(day) {
  const [, month, date] = day.split('-').map(Number);
  return `${month}月${date}日`;
}

/** 日ごとの平均の推移。下がるほど速い。 */
function sparkline(trend) {
  const points = trend.map((item, index) => ({ ...item, index })).filter(({ ms }) => ms !== null);
  if (points.length < 2) return '';
  const values = points.map(({ ms }) => ms);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (index) => SPARK.pad + (index * (SPARK.width - 2 * SPARK.pad)) / (trend.length - 1);
  const y = (ms) => (max === min
    ? SPARK.height / 2
    : SPARK.pad + ((max - ms) / (max - min)) * (SPARK.height - 2 * SPARK.pad));
  const path = points.map(({ index, ms }, order) => `${order ? 'L' : 'M'}${x(index).toFixed(1)} ${y(ms).toFixed(1)}`).join(' ');
  const last = points.at(-1);
  const label = ({ day, ms }) => `${formatMonthDay(day)} ${formatSeconds(ms)}秒`;
  const hits = points
    .map((point) => `<circle class="spark-hit" cx="${x(point.index).toFixed(1)}" cy="${y(point.ms).toFixed(1)}" r="8"><title>${label(point)}</title></circle>`)
    .join('');
  return `
    <figure class="speed-trend">
      <svg viewBox="0 0 ${SPARK.width} ${SPARK.height}" width="${SPARK.width}" height="${SPARK.height}" aria-hidden="true">
        <path class="spark-line" d="${path}"/>
        <circle class="spark-end" cx="${x(last.index).toFixed(1)}" cy="${y(last.ms).toFixed(1)}" r="4"/>
        ${hits}
      </svg>
      <figcaption>14日の推移(下がるほど速い)</figcaption>
      <ul class="visually-hidden">${points.map((point) => `<li>${label(point)}</li>`).join('')}</ul>
    </figure>`;
}

function speedCard() {
  const { recent, previous, trend } = speedSummary(progress.speed, localDate());
  let body = '<p class="speed-detail">音声で答えて正解した問題で、問題が出てから話し始めるまでの時間を記録します。</p>';
  if (recent === null && Object.keys(progress.speed.days).length > 0) {
    body = '<p class="speed-detail">直近7日の記録はありません。</p>';
  }
  if (recent !== null) {
    const change = speedChange(recent, previous);
    // 推移の図は数字の横に置き、比べた結果の文は下の行に回す。
    body = `
      <div class="speed-main">
        <p class="speed-value"><strong>${formatSeconds(recent)}</strong>秒</p>
        ${sparkline(trend)}
      </div>
      <p class="speed-detail">直近7日の平均。${change ? `<span class="speed-change is-${change.direction}">${change.text}</span>` : ''}</p>`;
  }
  return `
    <section class="speed-card" aria-label="答えるまでの速さ">
      <h2>答えるまでの速さ</h2>
      ${body}
    </section>`;
}

/** 実績の判定に使う数字をまとめる。flags は1回の学習の結果で決まる実績の条件。 */
function achievementStats({ perfectSession = false, reviewFinished = false } = {}) {
  const known = knownQuestionIds();
  const { attempts, correct } = totals(progress, known);
  const map = grammarMap(questions, progress);
  const summary = masterySummary(questions, progress);
  const levels = Object.fromEntries(map.map(({ level, items }) => [
    level,
    [items.filter((item) => item.complete).length, items.length],
  ]));
  return {
    attempts,
    correct,
    mastered: summary.mastered,
    completeItems: summary.completeItems,
    totalItems: summary.totalItems,
    levels,
    bestStreak: studyStreak(progress.days, localDate()).best,
    busiestDay: busiestDay(progress.days),
    perfectSession,
    reviewFinished,
  };
}

/** 新しく条件を満たした実績を記録して知らせる。 */
function checkAchievements(flags) {
  const unlocked = unlockAchievements(progress, achievementStats(flags), localDate());
  if (unlocked.length === 0) return;
  saveProgress(progress);
  session?.newAchievements?.push(...unlocked);
  showToast(unlocked.length === 1 ? `実績を獲得: ${unlocked[0].name}` : `実績を${unlocked.length}個獲得しました`);
}

/** 相棒の記録。まだなければ、たまごを用意する。 */
function companion() {
  progress.companion ??= newCompanion(localDate());
  return progress.companion;
}

/** 相棒の絵。かえる直前のたまごには、ひびを入れる。extra は絵に重ねる飾り(星など)。 */
function companionFigure(c, size, extra = '') {
  const cracked = c.stage === 'egg' && c.points >= STAGE_POINTS.baby - 2;
  return `<span class="companion-figure${c.stage === 'egg' ? ' is-egg' : ''}">${companionSvg(formId(c), { size, cracked, rare: c.rare })}${extra}</span>`;
}

/** 名前の下に出す、今の段階。名前をつけていれば、姿の名前も添える。 */
function companionStage(c) {
  if (c.stage === 'egg') return c.name ? 'たまご' : 'なにが生まれるかな';
  const stage = c.grownOn ? '一人前' : STAGE_LABELS[c.stage];
  return [stage, c.name ? formName(c) : '', c.rare ? '色ちがい' : ''].filter(Boolean).join('・');
}

const NEXT_STEP_TEXTS = {
  baby: (remaining) => `あと${remaining}問でかえります`,
  child: (remaining) => `あと${remaining}問で、こどもに育ちます`,
  adult: (remaining) => `あと${remaining}問で、おとなに育ちます`,
  grown: (remaining) => `あと${remaining}問で一人前です`,
};

/** 次の段階までの進み具合。ボタンの中にも置くので、span だけで組む。 */
function companionProgressHtml(c) {
  const step = nextStep(c);
  if (!step) return '<span class="companion-next">一人前になりました。新しいたまごを受け取れます。</span>';
  return `
    <span class="meter" aria-hidden="true"><span style="width: ${Math.round(step.ratio * 100)}%"></span></span>
    <span class="companion-next">${NEXT_STEP_TEXTS[step.next](step.remaining)}</span>`;
}

/** ホームの相棒。押すと相棒の画面を開く。ホームに出さない設定なら出さない。 */
function companionCard(isNew) {
  const c = companion();
  if (c.hidden) return '';
  return `
    <section class="companion-card${isNew ? ' is-new' : ''}" aria-label="相棒">
      <button type="button" class="companion-open" data-action="show-companion">
        ${companionFigure(c, 76)}
        <span class="companion-info">
          <span class="companion-name">${escapeHtml(displayName(c))}</span>
          <span class="companion-stage">${companionStage(c)}</span>
          ${companionProgressHtml(c)}
        </span>
      </button>
    </section>`;
}

/**
 * 一人前になった相棒が、どうしてその姿になったか。
 * 姿の決まり方は育ててのお楽しみなので、一人前になるまでは出さない。
 */
function growthStory(species, variant) {
  const adult = SECRETS[variant] ?? VARIANTS[variant];
  const adultName = SECRETS[variant] ? adult.name : formById(`${species}-${variant}`).name;
  return [
    `${SPECIES[species].name}になったのは、${SPECIES[species].reason}から。`,
    `${adultName}になったのは、${adult.reason}から。`,
  ];
}

/** 相棒の出来事を、結果の画面に出す見出しと文(HTML)にする。姿が変わった理由は、一人前になったときだけ出す。 */
function companionNewsText(event, c) {
  const to = formById(event.to);
  if (event.kind === 'grown') {
    return {
      title: '一人前になりました！',
      texts: [
        `${escapeHtml(c.name || to.name)}は一人前です。`,
        ...growthStory(c.species, c.variant),
        '相棒の画面で、新しいたまごを受け取れます。',
      ],
    };
  }
  const extras = [];
  if (to.secret) extras.push('ひみつの姿です！');
  if (event.rare) extras.push('めずらしい色の、色ちがいです！');
  if (event.to === 'baby') return { title: 'たまごがかえりました！', texts: [`「${to.name}」が生まれました。`, ...extras] };
  return { title: `${STAGE_LABELS[to.stage]}になりました！`, texts: [`「${to.name}」に育ちました。`, ...extras] };
}

/** 結果の画面を出さずにホームへ戻ったときの、短い知らせ。 */
function companionNewsToast(news) {
  const last = news.at(-1);
  if (last.kind === 'grown') return '相棒が一人前になりました';
  const rare = last.rare ? '(色ちがい)' : '';
  if (last.to === 'baby') return `たまごがかえりました${rare}`;
  return `相棒が「${formById(last.to).name}」に育ちました${rare}`;
}

/** 今の出題の設定を、ホームの1行に収まる文にする。 */
function settingsSummary() {
  const level = filters.level === 'all' ? 'すべてのレベル' : LEVEL_NAMES[filters.level];
  const count = filters.count === 'all' ? '全問' : `${filters.count}問`;
  const seconds = progress.settings.timeLimitSec;
  return `${level}・${count}・${seconds === 0 ? '制限時間なし' : `制限時間${seconds}秒`}`;
}

function settingsFields() {
  const levels = LEVEL_OPTIONS.map((value) => ({ value, text: value === 'all' ? 'すべて' : LEVEL_NAMES[value] }));
  const counts = COUNT_OPTIONS.map((value) => ({ value, text: value === 'all' ? '全問' : `${value}問` }));
  const limits = TIME_LIMIT_OPTIONS.map((value) => ({ value, text: value === 0 ? 'なし' : `${value}秒` }));
  return `
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
    </section>`;
}

function renderHome() {
  // これまでの記録だけで条件を満たした実績も、ここで獲得する。
  checkAchievements();
  // 学習の途中でやめて結果の画面を出さなかったときは、育ったことをここで知らせる。
  const companionNews = takeNews(companion());
  if (companionNews.length > 0) {
    saveProgress(progress);
    if (!companion().hidden) showToast(companionNewsToast(companionNews));
  }
  const { attempts, rate } = totals(progress, knownQuestionIds());
  const isNewLearner = attempts === 0;
  const weakCount = knownWeakIds().length;
  const due = todaysReviewIds().length;
  const mastery = masterySummary(questions, progress);
  const settingsVisible = settingsOpen ?? isNewLearner;

  // 「始める」を最初の画面に収めるため、学習を始める操作を記録の表示より上に置く。
  // まだ答えていない人には、空の記録を並べない。
  root.innerHTML = `
    <main class="screen home">
      <header class="home-head">
        <h1>瞬間英作文</h1>
        <p>日本語を見て、すぐ英語で言う。</p>
      </header>

      ${isNewLearner ? '' : `
      <dl class="stats">
        <div><dt>回答数</dt><dd>${attempts}</dd></div>
        <div><dt>正解率</dt><dd>${rate}<small>%</small></dd></div>
        <div><dt>マスター</dt><dd>${mastery.mastered}<small>/${mastery.total}</small></dd></div>
      </dl>`}

      ${reviewCard(due)}

      <section class="start-panel" aria-label="学習を始める">
        <div class="settings-box">
          <div class="settings-summary">
            <p><span class="visually-hidden">今の設定:</span>${settingsSummary()}</p>
            <button type="button" class="text-button" data-action="toggle-settings"
              aria-expanded="${settingsVisible}" aria-controls="home-settings">${settingsVisible ? '閉じる' : '変更'}</button>
          </div>
          <div class="settings" id="home-settings" ${settingsVisible ? '' : 'hidden'}>${settingsFields()}</div>
        </div>
        <button type="button" class="primary" data-action="start">始める</button>
        ${weakCount > 0 ? `<button type="button" class="secondary" data-action="start-weak">苦手な問題を出題 (${weakCount}問)</button>` : ''}
      </section>

      ${companionCard(companionNews.length > 0)}

      ${Object.keys(progress.days).length > 0 ? streakCard() : ''}
      ${Object.keys(progress.speed.days).length > 0 ? speedCard() : ''}

      <div class="home-links">
        <button type="button" class="secondary" data-action="show-map">冒険の地図</button>
        <button type="button" class="secondary" data-action="show-achievements">実績 ${earnedCount(progress)}/${ACHIEVEMENTS.length}</button>
        ${companion().hidden ? '<button type="button" class="secondary" data-action="show-companion">相棒</button>' : ''}
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
      <p>回答${next.attempts}回、${next.questions}問、マスター${next.mastered}問、学習した日${next.days}日、実績${next.achievements}個、追加した正解例${next.customAnswers}文</p>
      ${incoming.companion ? `<p>相棒: ${escapeHtml(displayName(incoming.companion))}(${companionStage(incoming.companion)})</p>` : ''}
      ${incoming.adventure ? `<p>冒険の地図: 旗${flagCount(incoming.adventure)}か所</p>` : ''}
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

function requestStart(picked, mode = 'normal') {
  if (picked.length === 0) return;
  if (isRecognitionSupported() && !progress.speechNoticeSeen) {
    session = { pending: picked, pendingMode: mode };
    renderSpeechNotice();
    return;
  }
  startSession(picked, mode);
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

async function startSession(picked, mode = 'normal') {
  // 学習を終えてホームに戻ったら、設定は畳んで「始める」を見やすくする。
  settingsOpen = null;
  const voiceAvailable = isRecognitionSupported();
  mapRegions();
  session = {
    queue: picked,
    /** 始める前に旗のあった場所。結果の画面で、この回に立てた旗を知らせる。 */
    flagsBefore: new Set(Object.keys(adventure().flags)),
    /** normal、review(今日の復習)、weak(苦手な問題)、pattern(冒険の地図の場所)、missed(間違えた問題)。 */
    mode,
    newAchievements: [],
    /** 初回に話し始めるまでの時間。正解になったら記録する。 */
    firstSpeeds: new Map(),
    /** この回で記録した速さ。 */
    speeds: [],
    /** 直前に記録した速さ。正解の画面に出す。 */
    lastSpeed: null,
    /** 今の回答の時刻。 */
    timing: null,
    index: 0,
    firstResults: new Map(),
    /** 習熟度を記録する前の状態。「正解にする」で付け替えるときに使う。 */
    reviewBefore: new Map(),
    newlyMastered: new Set(),
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
  stopWalking();
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
  // 速さは初回の回答だけで測る。再挑戦に入ったら、初回の時間は使わない。
  session.firstSpeeds.delete(currentQuestion().id);
  renderQuiz();
  session.timing = { shownAt: performance.now(), pressedAt: null, speechAfterReadyMs: null, listens: 0 };
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
  showListenHint('聞いています。話し終えると自動で判定します');
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
  const { timing } = session;
  timing.listens += 1;
  timing.pressedAt ??= performance.now();
  renderQuiz();
  recognizer = createRecognizer({
    onReady: showMicReady,
    onSpeechStart(msAfterReady) {
      timing.speechAfterReadyMs ??= msAfterReady;
    },
    onProcessing: showProcessing,
    onInterim(text) {
      const interim = root.querySelector('[data-interim]');
      if (interim) interim.textContent = text;
    },
    onResult(candidates) {
      recognizer = null;
      session.blockingFailures = 0;
      session.preferTyping = false;
      submitAnswer(candidates, { spoken: true });
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

/**
 * 初回に話し始めるまでの時間を、正解した回答の速さとして記録する。
 * @returns {{ ms: number, previous: number|null, day: string }|null} 記録した内容。取り消すときに使う。
 */
function noteSpeed(id) {
  const ms = session.firstSpeeds.get(id);
  if (ms === undefined) return null;
  session.firstSpeeds.delete(id);
  const day = localDate();
  const previous = recordSpeed(progress, id, ms, day);
  session.speeds.push(ms);
  session.lastSpeed = { id, ms, previous };
  return { ms, previous, day };
}

/**
 * @param {string[]} candidates
 * @param {{ spoken?: boolean }} [options] spoken は音声で答えたとき true。速さは音声の回答だけ測る。
 */
function submitAnswer(candidates, { spoken = false } = {}) {
  stopTimer();
  const question = currentQuestion();
  const verdict = judge({ candidates, answers: answersFor(question, progress) });
  if (!session.firstResults.has(question.id)) {
    session.firstResults.set(question.id, verdict.result);
    recordResult(progress, question.id, verdict.result);
    const change = recordReview(progress, question.id, verdict.result, localDate());
    session.reviewBefore.set(question.id, change.before);
    // マイクを押し直した回答は、話し始めの時刻が混ざるので測らない。
    const ms = spoken && session.timing.listens === 1 ? answerTime(session.timing) : null;
    if (ms !== null) session.firstSpeeds.set(question.id, ms);
    if (verdict.result === 'correct') noteSpeed(question.id);
    feedCompanion(companion(), {
      level: question.level,
      mode: session.mode,
      fast: verdict.result === 'correct' && ms !== null && ms <= FAST_MS,
      spoken,
      correct: verdict.result === 'correct',
    }, { today: localDate(), days: progress.days });
    saveProgress(progress);
    if (change.mastered) announceMastered(question.id);
    checkAchievements();
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

function masteredMessage(id) {
  session.newlyMastered.add(id);
  const { mastered, total } = masterySummary(questions, progress);
  return `マスターしました(${mastered}/${total}問)`;
}

function announceMastered(id) {
  showToast(masteredMessage(id));
}

/** 「正解にする」で変わる、この問題の記録と、この回の状態を覚えておく。 */
function rememberBeforeAccept(id) {
  return {
    id,
    session,
    stat: structuredClone(progress.stats[id]),
    review: structuredClone(progress.review[id]),
    customAnswers: structuredClone(progress.customAnswers[id]),
    firstResult: session.firstResults.get(id),
    firstSpeed: session.firstSpeeds.get(id),
    speedIndex: session.speeds.length,
    lastSpeed: session.lastSpeed,
    mastered: session.newlyMastered.has(id),
  };
}

/**
 * 「正解にする」を取り消す。
 * 取り消すまでに次の問題へ答えていても、その記録は残るよう、この問題の分だけを戻す。
 * 獲得した実績は、ほかの場合と同じく取り消さない。
 */
function undoAccept(before, speed) {
  const { id } = before;
  const restore = (records, value) => {
    if (value === undefined) delete records[id];
    else records[id] = value;
  };
  restore(progress.stats, before.stat);
  restore(progress.review, before.review);
  restore(progress.customAnswers, before.customAnswers);
  if (speed) unrecordSpeed(progress, id, speed.ms, speed.day, speed.previous);
  saveProgress(progress);
  const sameSession = session === before.session;
  if (sameSession) {
    session.firstResults.set(id, before.firstResult);
    if (before.firstSpeed !== undefined) session.firstSpeeds.set(id, before.firstSpeed);
    if (speed) session.speeds.splice(before.speedIndex, 1);
    if (session.lastSpeed?.id === id) session.lastSpeed = before.lastSpeed;
    if (!before.mastered) session.newlyMastered.delete(id);
  }
  showToast('元に戻しました', { first: true });
  // 結果の画面かホームを開いていれば、戻した記録で描き直す。
  if (sameSession && root.querySelector('.summary')) renderSummary();
  else if (root.querySelector('.home')) renderHome();
}

/** 自分の回答を正解例に加え、この問題を正解として記録し直す。知らせの「元に戻す」で取り消せる。 */
function acceptAnswer() {
  const { id } = currentQuestion();
  const before = rememberBeforeAccept(id);
  addCustomAnswer(progress, id, session.verdict.answerText);
  const wasCorrect = session.firstResults.get(id) === 'correct';
  reclassifyAsCorrect(progress, id, session.firstResults.get(id));
  session.firstResults.set(id, 'correct');
  const change = wasCorrect
    ? null
    : recordAsCorrectInstead(progress, id, session.reviewBefore.get(id), localDate());
  const speed = wasCorrect ? null : noteSpeed(id);
  saveProgress(progress);
  const message = change?.mastered ? masteredMessage(id) : '正解例に追加しました';
  showToast(message, { action: { label: '元に戻す', run: () => undoAccept(before, speed) } });
  checkAchievements();
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

function speedNote() {
  const speed = session.lastSpeed;
  if (speed?.id !== currentQuestion().id) return '';
  const previous = speed.previous === null ? '' : `(前回 ${formatSeconds(speed.previous)}秒)`;
  return `<p class="speed-note">話し始めるまで ${formatSeconds(speed.ms)}秒${previous}</p>`;
}

/** 出題順に並べた、各問の初回の結果。 */
function sessionResults() {
  return session.queue.map((question) => session.firstResults.get(question.id));
}

/** 祝うときに飛ばす星の数と広がり。続くほど大きくする。 */
const SPARKLES = {
  small: { count: 8, radius: 46 },
  medium: { count: 10, radius: 58 },
  large: { count: 14, radius: 72 },
};

function sparklesHtml(size) {
  const { count, radius } = SPARKLES[size];
  const stars = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
    // 横長の知らせに合わせて、横に広く、縦に狭く飛ばす。内側と外側を交互にする。
    const distance = radius * (index % 2 ? 0.72 : 1);
    const dx = (Math.cos(angle) * distance * 1.3).toFixed(1);
    const dy = (Math.sin(angle) * distance * 0.7).toFixed(1);
    return `<span style="--dx: ${dx}px; --dy: ${dy}px; --delay: ${(index % 3) * 50}ms"></span>`;
  }).join('');
  return `<span class="sparkles" aria-hidden="true">${stars}</span>`;
}

const STAR_ICON = `<svg class="combo-star" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
  <path d="M12 2l2.6 6.6L21.5 9.3l-5.3 4.5 1.7 6.9L12 17l-5.9 3.7 1.7-6.9-5.3-4.5 6.9-.7z" fill="currentColor"/>
</svg>`;

/** 続けて正解した数を、正解の画面に出す。区切りの数では星を飛ばして祝う。 */
function comboHtml() {
  const combo = comboMessage(comboAt(sessionResults(), session.index));
  if (!combo) return '';
  const classes = ['combo', `combo-${combo.size}`, combo.milestone ? 'is-milestone' : ''].join(' ').trim();
  const text = combo.milestone
    ? `<strong>${combo.count}</strong>問連続正解！${combo.cheer ? `<span class="combo-cheer">${combo.cheer}</span>` : ''}`
    : `<strong>${combo.count}</strong>問連続正解`;
  return `
    <p class="${classes}">
      ${STAR_ICON}<span class="combo-text">${text}</span>
      ${combo.milestone ? sparklesHtml(combo.size) : ''}
    </p>`;
}

function correctPanel() {
  return `
    <div class="verdict-row">
      <p class="verdict verdict-correct">${VERDICT_LABELS.correct}</p>
      ${comboHtml()}
    </div>
    <p class="model-answer" lang="en">${escapeHtml(session.verdict.modelText)}</p>
    ${speedNote()}
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
  const allCorrect = session.queue.every((question) => session.firstResults.get(question.id) === 'correct');
  checkAchievements({
    perfectSession: session.queue.length >= 10 && allCorrect,
    reviewFinished: session.mode === 'review' && todaysReviewIds().length === 0,
  });
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
      ${companionResult()}
      ${summaryNotes()}
      ${missed.length > 0 ? `<section><h2>今回の苦手な問題</h2><ol class="missed">${missedItems}</ol></section>` : ''}
      <div class="home-actions">
        ${missed.length > 0 ? '<button type="button" class="primary" data-action="retry-missed">間違えた問題をもう一度</button>' : ''}
        <button type="button" class="${missed.length > 0 ? 'secondary' : 'primary'}" data-action="go-home">ホームへ</button>
        <button type="button" class="secondary" data-action="show-map">冒険の地図を見る</button>
      </div>
    </main>`;
  window.scrollTo(0, 0);
}

/**
 * この回に立てた旗と、相棒が進んだ先を知らせる文。
 * 「正解にする」の取り消しで条件が外れた旗は、ここで抜く。
 */
function mapNews() {
  const flags = adventure().flags;
  const map = grammarMap(questions, progress);
  const complete = new Set(map.flatMap(({ level, items }) => items.filter((item) => item.complete).map((item) => placeKey(level, item.pattern))));
  let changed = false;
  for (const key of Object.keys(flags)) {
    if (!session.flagsBefore.has(key) && !complete.has(key)) {
      removeFlag(adventure(), key);
      changed = true;
    }
  }
  if (changed) saveProgress(progress);
  const regions = mapRegions();
  const planted = regions.flatMap((region) => region.places.filter((place) => place.flaggedOn && !session.flagsBefore.has(place.key)));
  if (planted.length === 0) return [];
  const notes = [planted.length === 1
    ? `「${escapeHtml(planted[0].pattern)}」に旗を立てました！`
    : `「${escapeHtml(planted[0].pattern)}」など、${planted.length}か所に旗を立てました！`];
  for (const region of regions) {
    const before = region.places.findIndex((place) => !session.flagsBefore.has(place.key));
    const from = before === -1 ? region.places.length : before;
    if (region.frontier <= from) continue;
    if (region.frontier === region.places.length) notes.push(`${region.name}(${LEVEL_NAMES[region.level]})のゴールに着きました！`);
    else {
      const next = escapeHtml(region.places[region.frontier].pattern);
      notes.push(companion().hidden
        ? `次の目的地は、${region.name}の「${next}」です。`
        : `相棒が、${region.name}の「${next}」へ進みます。`);
    }
  }
  return notes;
}

/** 結果の画面で、マスターした問題と、残っている今日の復習を知らせる。 */
function summaryNotes() {
  const notes = [...mapNews()];
  const best = longestCombo(sessionResults());
  if (best >= 3) notes.push(`いちばん長い連続正解: ${best}問`);
  if (session.speeds.length > 0) {
    const average = session.speeds.reduce((sum, ms) => sum + ms, 0) / session.speeds.length;
    notes.push(`話し始めるまでの平均: ${formatSeconds(average)}秒(${session.speeds.length}問)`);
  }
  if (session.newlyMastered.size > 0) notes.push(`この回でマスターした問題: ${session.newlyMastered.size}問`);
  if (session.newAchievements.length > 0) notes.push(`獲得した実績: ${session.newAchievements.map(({ name }) => name).join('、')}`);
  const due = todaysReviewIds().length;
  if (due > 0) notes.push(`今日の復習が、あと${due}問あります。`);
  return notes.length ? `<div class="summary-notes">${notes.map((note) => `<p>${note}</p>`).join('')}</div>` : '';
}

/** 結果の画面の相棒。姿が変わったら、星を飛ばして知らせる。 */
function companionResult() {
  const c = companion();
  // 「正解にする」の取り消しで描き直しても同じ知らせを出せるよう、この回の分は session に残す。
  if (session.companionNews === undefined) {
    session.companionNews = takeNews(c);
    if (session.companionNews.length > 0) saveProgress(progress);
  }
  if (c.hidden) return '';
  const news = session.companionNews;
  const changed = news.length > 0;
  let title;
  let texts;
  if (changed) {
    const messages = news.map((event) => companionNewsText(event, c));
    title = messages.at(-1).title;
    texts = messages.flatMap((message) => message.texts);
  } else {
    title = c.stage === 'egg' ? 'たまごが少し動きました' : `${escapeHtml(displayName(c))}が育ちました`;
    texts = [`この回で${session.firstResults.size}問ぶん育ちました。`];
  }
  return `
    <section class="companion-result${changed ? ' is-changed' : ''}" aria-label="相棒">
      ${companionFigure(c, changed ? 112 : 80, changed ? sparklesHtml('large') : '')}
      <div class="companion-result-text">
        <h2>${title}</h2>
        ${texts.map((text) => `<p>${text}</p>`).join('')}
        ${companionProgressHtml(c)}
        <button type="button" class="text-button" data-action="show-companion">相棒を見る</button>
      </div>
    </section>`;
}

const LEVEL_KEYS = { 1: 'elementary', 2: 'junior', 3: 'high' };

/** 相棒が地図を歩き始めるまでの間。先に旗を立てて見せる。 */
const WALK_DELAY_MS = 650;
/** 1マス歩く時間。 */
const WALK_STEP_MS = 340;
/** 歩いて見せるのは、行き先の手前のこのマス数まで。遠くから進むときは、そこまで飛ばす。 */
const MAX_WALK_STEPS = 8;
const MAP_FLAG_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
  <path class="adv-flag-pole" d="M4.5 14.5V2"/><path class="adv-flag-cloth" d="M5.3 2.2L13 5 5.3 8Z"/></svg>`;

function adventure() {
  progress.adventure ??= emptyAdventure();
  return progress.adventure;
}

/** 3問ともマスターした場所に旗を立ててから、島ごとの場所を返す。 */
function mapRegions() {
  const map = grammarMap(questions, progress);
  if (plantFlags(adventure(), map, localDate()).length > 0) saveProgress(progress);
  return adventureRegions(map, adventure());
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function cellStyle(cell, layout) {
  const percent = (value, total) => `${((value / total) * 100).toFixed(3)}%`;
  return `left:${percent(cell.x, layout.width)};top:${percent(cell.y, layout.height)}`;
}

function monthDay(day) {
  const [, month, date] = day.split('-').map(Number);
  return `${month}月${date}日`;
}

function placeLabel(place, region) {
  const parts = [`${place.index + 1}番目、${place.pattern}`, `${place.questions.length}問中${place.mastered}問マスター`];
  if (place.flaggedOn) parts.push('旗が立っています');
  if (place.index === region.frontier) parts.push(companion().hidden ? '次の目的地' : '相棒がいる場所');
  return parts.join('、');
}

function placeButton(place, region, layout, selected, newFlags) {
  const cell = layout.cells[place.index + 1];
  const classes = ['adv-place', newFlags.includes(place.key) ? 'is-new-flag' : ''].filter(Boolean).join(' ');
  return `
    <li class="adv-cell" style="${cellStyle(cell, layout)}">
      <button type="button" class="${classes}" data-action="select-place" data-level="${region.level}" data-index="${place.index}"
        aria-pressed="${place.index === selected}" aria-label="${escapeHtml(placeLabel(place, region))}">${placeSvg(place)}</button>
    </li>`;
}

/** 地図の下に出す、選んでいる場所の名前と、練習するボタン。 */
function placePanel(region, index) {
  const place = region.places[index];
  const tag = index === region.frontier ? (companion().hidden ? '次の目的地' : '相棒がいる場所') : '';
  const stars = place.questions.map(({ state }) => starSvg(state, 16)).join('');
  const flag = place.flaggedOn ? `<span class="adv-flag-day">${MAP_FLAG_ICON}${monthDay(place.flaggedOn)}に旗</span>` : '';
  return `
    <div class="adv-panel-text">
      <p class="adv-panel-meta">${escapeHtml(place.area)}・${place.index + 1}番目${tag ? `<span class="adv-tag">${tag}</span>` : ''}</p>
      <p class="adv-panel-name">${escapeHtml(place.pattern)}</p>
      <p class="adv-panel-status"><span class="adv-stars" aria-hidden="true">${stars}</span>${place.questions.length}問中${place.mastered}問マスター${flag}</p>
    </div>
    <button type="button" class="primary adv-practice" data-action="practice-pattern"
      data-level="${region.level}" data-pattern="${escapeHtml(place.pattern)}">練習する</button>`;
}

function walkerHtml(layout, at) {
  const c = companion();
  const figure = c.hidden ? markerSvg(40) : companionFigure(c, 52);
  return `<div class="adv-walker${c.hidden ? ' is-marker' : ''}" style="${cellStyle(standPoint(layout, at), layout)}" aria-hidden="true">${figure}</div>`;
}

function stopWalking() {
  for (const timer of walkTimers) clearTimeout(timer);
  walkTimers = [];
}

/** 相棒を from の場所から to の場所まで、1マスずつ歩かせる。通った道も伸ばす。 */
function walkCompanion(layout, from, to) {
  const walker = root.querySelector('.adv-walker');
  const trail = root.querySelector('.adv-trail');
  if (!walker || !trail) return;
  const steps = to - from;
  const stepMs = WALK_STEP_MS;
  walker.style.setProperty('--step-ms', `${stepMs}ms`);
  for (let step = 1; step <= steps; step += 1) {
    walkTimers.push(setTimeout(() => {
      const cell = standPoint(layout, from + step);
      walker.style.left = `${((cell.x / layout.width) * 100).toFixed(3)}%`;
      walker.style.top = `${((cell.y / layout.height) * 100).toFixed(3)}%`;
      walker.classList.remove('is-hopping');
      void walker.offsetWidth;
      walker.classList.add('is-hopping');
      trail.setAttribute('d', roadPath(layout.cells, from + step + 1));
    }, WALK_DELAY_MS + (step - 1) * stepMs));
  }
}

/** 相棒の行き先が画面の外なら、見える位置まで動かす。 */
function revealWalker(index) {
  const target = root.querySelector(`.adv-place[data-index="${index}"]`) ?? root.querySelector('.adv-goal-note');
  if (!target) return;
  const rect = target.getBoundingClientRect();
  if (rect.top < 0 || rect.bottom > window.innerHeight - 140) target.scrollIntoView({ block: 'center' });
}

function renderMap() {
  stopWalking();
  const regions = mapRegions();
  const summary = masterySummary(questions, progress);
  const totalFlags = regions.reduce((sum, region) => sum + region.flags, 0);
  const totalPlaces = regions.reduce((sum, region) => sum + region.places.length, 0);
  mapLevel ??= (regions.find((region) => region.frontier < region.places.length) ?? regions[0]).level;
  const region = regions.find(({ level }) => level === mapLevel) ?? regions[0];
  const layout = boardLayout(region.places.length);
  const moves = takeMapMoves(adventure(), region);
  saveProgress(progress);
  const walk = moves.to > moves.from && !prefersReducedMotion();
  const at = walk ? Math.max(moves.from, moves.to - MAX_WALK_STEPS) : moves.to;
  const goal = region.frontier === region.places.length;
  const selected = mapSelected[region.level] ?? Math.min(region.frontier, region.places.length - 1);
  const levels = regions.map(({ level }) => ({ value: level, text: LEVEL_NAMES[level] }));
  const legend = Object.entries(MASTERY_LABELS)
    .map(([state, label]) => `<li>${starSvg(state, 16)}${label}</li>`)
    .join('');
  const goalNote = companion().hidden ? `${region.name}のゴールに着きました！` : `相棒と${region.name}のゴールに着きました！`;
  root.innerHTML = `
    <main class="screen map adventure">
      <header class="sub-head">
        <button type="button" class="text-button" data-action="go-home">戻る</button>
      </header>
      <div class="map-intro">
        <h1>冒険の地図</h1>
        <p>旗 ${totalFlags}/${totalPlaces}か所、マスター ${summary.mastered}/${summary.total}問</p>
      </div>
      ${segmented('set-map-level', levels, region.level, 'レベル')}
      <section class="map-level adv-region" id="${LEVEL_KEYS[region.level]}" aria-labelledby="adv-region-title">
        <div class="map-level-head">
          <h2 id="adv-region-title">${region.name}</h2>
          <p>${LEVEL_NAMES[region.level]}・旗 ${region.flags}/${region.places.length}</p>
        </div>
        ${goal ? `<p class="adv-goal-note">${goalNote}</p>` : ''}
        <ul class="legend adv-legend" aria-label="印の意味">
          <li class="adv-legend-flag">${MAP_FLAG_ICON}旗</li>
          ${legend}
        </ul>
        <p class="hint">場所の上の3つの星が、3問の習熟度です。予定日に3回続けて正解すると金の星(マスター)になり、3つとも金になると旗が立って、相棒が次の場所へ進みます。道はスタート(下)からゴール(上)へ続きます。</p>
        <div class="adv-board is-${region.theme}" style="aspect-ratio:${layout.width} / ${layout.height}">
          ${boardScene(region, layout, at + 1)}
          <ol class="adv-places" aria-label="${region.name}の場所">
            ${region.places.map((place) => placeButton(place, region, layout, selected, moves.newFlags)).join('')}
          </ol>
          ${walkerHtml(layout, at)}
        </div>
        <section class="adv-panel" aria-live="polite" aria-label="選んでいる場所">${placePanel(region, selected)}</section>
      </section>
    </main>`;
  if (walk) walkCompanion(layout, at, moves.to);
  return Math.min(moves.to, region.places.length - 1);
}

const BADGE_ICONS = {
  start: '<path d="M8 5l11 7-11 7z"/>',
  answers: '<path d="M4 5h16v10H9l-5 4z"/>',
  streak: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  mastery: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  complete: '<path d="M6 21V4M6 4h12l-2.5 4L18 12H6"/>',
  day: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  perfect: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  review: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
};

function formatDate(day) {
  const [year, month, date] = day.split('-').map(Number);
  return `${year}年${month}月${date}日`;
}

function badgeHtml(achievement, stats) {
  const earnedOn = progress.achievements[achievement.id];
  const { current, target } = achievementProgress(achievement, stats);
  let status;
  let meter = '';
  if (earnedOn) {
    status = `${formatDate(earnedOn)}に獲得`;
  } else if (achievement.once) {
    status = 'まだ獲得していません';
  } else {
    status = `<span class="visually-hidden">進み具合 </span>${current}/${target}`;
    meter = `<span class="meter" aria-hidden="true"><span style="width: ${Math.round((current / target) * 100)}%"></span></span>`;
  }
  return `
    <li class="badge kind-${achievement.kind}${earnedOn ? ' is-earned' : ''}">
      <span class="badge-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"
          stroke-linecap="round" stroke-linejoin="round">${BADGE_ICONS[achievement.kind]}</svg>
      </span>
      <div class="badge-text">
        <p class="badge-name">${achievement.name}</p>
        <p class="badge-desc">${achievement.description}</p>
        <p class="badge-status">${status}</p>
        ${meter}
      </div>
    </li>`;
}

function renderAchievements() {
  const stats = achievementStats();
  root.innerHTML = `
    <main class="screen achievements">
      <header class="sub-head">
        <button type="button" class="text-button" data-action="go-home">戻る</button>
      </header>
      <div class="map-intro">
        <h1>実績</h1>
        <p>獲得 ${earnedCount(progress)}/${ACHIEVEMENTS.length}</p>
      </div>
      <ul class="badges">${ACHIEVEMENTS.map((achievement) => badgeHtml(achievement, stats)).join('')}</ul>
    </main>`;
}

/** 「今のようす」の言葉。どの姿に育つかの手がかりにならない言葉だけを、日ごとに入れ替える。 */
const MOODS = {
  egg: ['ときどき、たまごが動いています。', 'たまごの中から、小さな音がします。', 'たまごが、ほんのりあたたかいです。'],
  baby: ['元気に育っています。', 'ころころ転がって遊んでいます。', 'きょろきょろ、まわりを見ています。'],
  child: ['すくすく育っています。', 'どんなおとなになるのかな。', '少し大きくなりました。'],
};

function companionMood(c) {
  if (c.stage === 'adult') return c.grownOn ? 'りっぱな一人前です。' : 'おとなになりました。一人前まで、もう少しです。';
  if (c.stage === 'egg' && c.points === 0) return 'たまごです。問題に答えると育ちます。';
  const moods = MOODS[c.stage];
  return moods[Number(localDate().replaceAll('-', '')) % moods.length];
}

function companionHint(c) {
  if (c.stage !== 'adult') return 'どんな姿に育つかは、育ててのお楽しみです。一人前になったら、育ち方をふりかえれます。';
  if (c.grownOn) return '新しいたまごを受け取っても、この相棒は「なかま」に残ります。';
  return '一人前になると、育ち方をふりかえれます。新しいたまごも受け取れて、育てた相棒は「なかま」に残ります。';
}

/**
 * 図鑑の1つの姿。まだ会っていない姿は影で出し、ひみつの姿は影も出さない。
 * 色ちがいに会ったことのある姿には、色ちがいの絵を小さく添える。
 */
function zukanItem(form, c) {
  const seen = Boolean(c.seen[form.id]);
  const rareSeen = Boolean(c.seen[form.id + RARE_SUFFIX]);
  const name = seen
    ? form.name
    : '<span aria-hidden="true">？？？</span><span class="visually-hidden">まだ会っていない姿</span>';
  const figure = !seen && form.secret
    ? '<span class="zukan-secret" aria-hidden="true">？</span>'
    : `<span class="companion-figure">${companionSvg(form.id, { size: 64 })}</span>`;
  const rare = rareSeen
    ? `<span class="zukan-rare">${companionSvg(form.id, { size: 28, rare: true })}色ちがい</span>`
    : '';
  return `
    <li class="zukan-item${seen ? '' : ' is-unknown'}">
      ${figure}
      <span class="zukan-name">${name}</span>
      ${rare}
    </li>`;
}

/** 図鑑。会ったことのある姿は色で、まだの姿は影で出す。どうすれば会えるかは書かない。 */
function zukanHtml(c) {
  const items = (filter) => FORMS.filter(filter).map((form) => zukanItem(form, c)).join('');
  const seenCount = FORMS.filter(({ id }) => c.seen[id]).length;
  const rareCount = Object.keys(c.seen).filter((id) => id.endsWith(RARE_SUFFIX)).length;
  return `
    <section class="companion-section zukan" aria-labelledby="zukan-title">
      <h2 id="zukan-title">図鑑 <small>${seenCount}/${FORMS.length}${rareCount > 0 ? `・色ちがい ${rareCount}` : ''}</small></h2>
      <h3>たまごとあかちゃん</h3>
      <ul class="zukan-grid">${items(({ stage }) => stage === 'egg' || stage === 'baby')}</ul>
      <h3>こども</h3>
      <ul class="zukan-grid">${items(({ stage }) => stage === 'child')}</ul>
      <h3>おとな</h3>
      <ul class="zukan-grid">${items(({ stage, secret }) => stage === 'adult' && !secret)}</ul>
      <h3>ひみつ</h3>
      <ul class="zukan-grid">${items(({ secret }) => secret)}</ul>
    </section>`;
}

/** 一人前になった相棒の、育ち方のふりかえり。 */
function storyHtml(c) {
  if (!c.grownOn) return '';
  return `
    <section class="companion-section" aria-labelledby="story-title">
      <h2 id="story-title">育ち方のふりかえり</h2>
      ${growthStory(c.species, c.variant).map((line) => `<p>${line}</p>`).join('')}
    </section>`;
}

/** 一人前まで育てた相棒。新しい順に並べる。 */
function friendsHtml(c) {
  if (c.friends.length === 0) return '';
  const items = [...c.friends].reverse().map((friend) => {
    const form = formById(friend.form);
    return `
      <li>
        <span class="companion-figure">${companionSvg(friend.form, { size: 56, rare: friend.rare })}</span>
        <span class="friend-text">
          <span class="friend-name">${escapeHtml(friend.name || form.name)}</span>
          <span class="friend-meta">${[friend.name ? form.name : '', friend.rare ? '色ちがい' : '', `${formatDate(friend.born)}〜${formatDate(friend.grown)}`].filter(Boolean).join('・')}</span>
          ${growthStory(friend.species ?? form.species, form.variant).map((line) => `<span class="friend-story">${line}</span>`).join('')}
        </span>
      </li>`;
  }).join('');
  return `
    <section class="companion-section" aria-labelledby="friends-title">
      <h2 id="friends-title">なかま <small>${c.friends.length}</small></h2>
      <ul class="friends">${items}</ul>
    </section>`;
}

function renderCompanion() {
  const c = companion();
  root.innerHTML = `
    <main class="screen companion-screen">
      <header class="sub-head">
        <button type="button" class="text-button" data-action="go-home">戻る</button>
      </header>
      <section class="companion-hero" aria-label="今の相棒">
        ${companionFigure(c, 168)}
        <h1>${escapeHtml(displayName(c))}</h1>
        <p class="companion-stage">${companionStage(c)}</p>
        ${c.generation > 1 ? `<p class="companion-stage">${c.generation}代目の相棒</p>` : ''}
        <div class="companion-progress">${companionProgressHtml(c)}</div>
        ${canReceiveEgg(c) ? '<button type="button" class="primary" data-action="receive-egg">新しいたまごを受け取る</button>' : ''}
      </section>
      ${storyHtml(c)}
      <section class="companion-section" aria-labelledby="mood-title">
        <h2 id="mood-title">今のようす</h2>
        <p>${companionMood(c)}</p>
        <p class="hint">${companionHint(c)}</p>
      </section>
      <form class="companion-section name-form" id="companion-name-form">
        <label for="companion-name">名前</label>
        <div class="name-row">
          <input id="companion-name" name="name" type="text" maxlength="${NAME_MAX_LENGTH}" autocomplete="off"
            enterkeyhint="done" value="${escapeHtml(c.name)}" placeholder="${escapeHtml(formName(c))}">
          <button type="submit" class="secondary">決める</button>
        </div>
        <p class="hint">${NAME_MAX_LENGTH}文字まで。空にすると、姿の名前で呼びます。</p>
      </form>
      ${zukanHtml(c)}
      ${friendsHtml(c)}
      <section class="companion-section" aria-labelledby="companion-home-title">
        <h2 id="companion-home-title">ホームの表示</h2>
        <p class="hint">ホームに出さないときも、相棒は育ちます。この画面は、ホームの「相棒」から開けます。</p>
        <button type="button" class="secondary" data-action="toggle-companion-home">${c.hidden ? 'ホームに相棒を出す' : 'ホームに相棒を出さない'}</button>
      </section>
    </main>`;
}

function openCompanion() {
  cancelPendingWork();
  session = null;
  renderCompanion();
  window.scrollTo(0, 0);
}

/** 名前を決める。空にすると、姿の名前で呼ぶ。 */
function renameCompanion(value) {
  const c = companion();
  const name = value.trim().slice(0, NAME_MAX_LENGTH);
  if (name === c.name) return;
  c.name = name;
  saveProgress(progress);
  renderCompanion();
  showToast(name ? `名前を「${name}」にしました` : '名前を消しました');
}

function openAchievements() {
  cancelPendingWork();
  session = null;
  renderAchievements();
  window.scrollTo(0, 0);
}

function openMap() {
  cancelPendingWork();
  session = null;
  // 先に旗を立てて、立てたばかりの旗がある島を開く。
  mapRegions();
  const unseenLevel = Number(adventure().unseen[0]?.split('|')[0]);
  if (unseenLevel) mapLevel = unseenLevel;
  const index = renderMap();
  window.scrollTo(0, 0);
  revealWalker(index);
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
  'toggle-settings': () => {
    settingsOpen = root.querySelector('#home-settings').hidden;
    renderHome();
    root.querySelector('[data-action="toggle-settings"]').focus();
  },
  start: () => requestStart(pickQuestions(questions, filters)),
  'start-weak': () => requestStart(pickQuestions(questions, { ids: knownWeakIds() }), 'weak'),
  'start-review': () => requestStart(pickQuestions(questions, { ids: todaysReviewIds(), count: filters.count }), 'review'),
  'show-map': openMap,
  'show-achievements': openAchievements,
  'show-companion': openCompanion,
  'receive-egg': () => {
    if (!receiveEgg(companion(), localDate())) return;
    saveProgress(progress);
    renderCompanion();
    window.scrollTo(0, 0);
    showToast('新しいたまごが届きました');
  },
  'toggle-companion-home': () => {
    const c = companion();
    c.hidden = !c.hidden;
    saveProgress(progress);
    renderCompanion();
    root.querySelector('[data-action="toggle-companion-home"]').focus();
  },
  'set-map-level': ({ value }) => {
    mapLevel = Number(value);
    revealWalker(renderMap());
  },
  'select-place': ({ level, index }) => {
    mapSelected[level] = Number(index);
    for (const button of root.querySelectorAll('.adv-place')) {
      button.setAttribute('aria-pressed', String(button.dataset.index === index));
    }
    const region = mapRegions().find((item) => item.level === Number(level));
    root.querySelector('.adv-panel').innerHTML = placePanel(region, Number(index));
  },
  'practice-pattern': ({ level, pattern }) => {
    const ids = questions
      .filter((question) => question.level === Number(level) && question.pattern === pattern)
      .map((question) => question.id);
    requestStart(pickQuestions(questions, { ids }), 'pattern');
  },
  'accept-notice': () => {
    progress.speechNoticeSeen = true;
    saveProgress(progress);
    startSession(session.pending, session.pendingMode);
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
    startSession(pickQuestions(questions, { ids }), 'missed');
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
  if (event.target.id === 'companion-name-form') {
    renameCompanion(event.target.elements.name.value);
    return;
  }
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
    if (!progress.companion) {
      companion();
      saveProgress(progress);
    }
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
