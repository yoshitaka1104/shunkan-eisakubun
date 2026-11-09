/**
 * 学習記録の書き出しと読み込み。
 * 記録は端末の中にしかないので、消えたときや、Safari とホーム画面のアプリの間で移すときに使う。
 * 読み込むファイルは手で書き換えられている可能性があるため、使える値だけを取り出す。
 */
import { emptyProgress } from './progress.js';
import { MAX_SPEED_MS } from './speed.js';

const APP_ID = 'shunkan-eisakubun';
const FORMAT_VERSION = 1;
const RESULTS = ['correct', 'close', 'wrong'];
const MAX_CUSTOM_ANSWERS = 20;
const MAX_ANSWER_LENGTH = 200;
const MAX_TIME_LIMIT_SEC = 60;
const MAX_STAGE = 5;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class BackupError extends Error {}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** 書き出すファイルの名前。日付は端末の時刻で付ける。 */
export function backupFileName(now = new Date()) {
  return `shunkan-eisakubun-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** 学習記録を、書き出すファイルの中身にする。 */
export function createBackup(progress, now = new Date()) {
  return `${JSON.stringify({ app: APP_ID, format: FORMAT_VERSION, exportedAt: now.toISOString(), progress }, null, 2)}\n`;
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function readStats(source) {
  if (!isPlainObject(source)) return {};
  const stats = {};
  for (const [id, stat] of Object.entries(source)) {
    if (!isPlainObject(stat)) continue;
    const entry = {
      attempts: count(stat.attempts),
      correct: count(stat.correct),
      close: count(stat.close),
      wrong: count(stat.wrong),
    };
    if (entry.attempts === 0) continue;
    if (RESULTS.includes(stat.last)) entry.last = stat.last;
    if (Number.isFinite(stat.lastAt)) entry.lastAt = stat.lastAt;
    stats[id] = entry;
  }
  return stats;
}

function readCustomAnswers(source) {
  if (!isPlainObject(source)) return {};
  const customAnswers = {};
  for (const [id, answers] of Object.entries(source)) {
    if (!Array.isArray(answers)) continue;
    const texts = answers
      .filter((text) => typeof text === 'string')
      .map((text) => text.trim())
      .filter((text) => text && text.length <= MAX_ANSWER_LENGTH);
    const unique = [...new Set(texts)].slice(0, MAX_CUSTOM_ANSWERS);
    if (unique.length > 0) customAnswers[id] = unique;
  }
  return customAnswers;
}

function readReview(source) {
  if (!isPlainObject(source)) return {};
  const review = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!isPlainObject(entry)) continue;
    if (!Number.isInteger(entry.stage) || entry.stage < 0 || entry.stage > MAX_STAGE) continue;
    if (typeof entry.due !== 'string' || !DAY_PATTERN.test(entry.due)) continue;
    review[id] = { stage: entry.stage, due: entry.due };
  }
  return review;
}

function readDays(source) {
  if (!isPlainObject(source)) return {};
  const days = {};
  for (const [day, answered] of Object.entries(source)) {
    if (DAY_PATTERN.test(day) && Number.isInteger(answered) && answered > 0) days[day] = answered;
  }
  return days;
}

function readAchievements(source) {
  if (!isPlainObject(source)) return {};
  const achievements = {};
  for (const [id, day] of Object.entries(source)) {
    if (/^[a-z0-9-]{1,40}$/.test(id) && typeof day === 'string' && DAY_PATTERN.test(day)) achievements[id] = day;
  }
  return achievements;
}

function readSpeed(source) {
  const speed = { days: {}, questions: {} };
  if (!isPlainObject(source)) return speed;
  if (isPlainObject(source.days)) {
    for (const [day, value] of Object.entries(source.days)) {
      if (!DAY_PATTERN.test(day) || !isPlainObject(value)) continue;
      const { totalMs, count } = value;
      if (!Number.isInteger(count) || count < 1 || !Number.isFinite(totalMs)) continue;
      if (totalMs < 0 || totalMs > count * MAX_SPEED_MS) continue;
      speed.days[day] = { totalMs, count };
    }
  }
  if (isPlainObject(source.questions)) {
    for (const [id, ms] of Object.entries(source.questions)) {
      if (Number.isFinite(ms) && ms >= 0 && ms <= MAX_SPEED_MS) speed.questions[id] = ms;
    }
  }
  return speed;
}

function readSettings(source, defaults) {
  const limit = source?.timeLimitSec;
  const valid = Number.isInteger(limit) && limit >= 0 && limit <= MAX_TIME_LIMIT_SEC;
  return { ...defaults, timeLimitSec: valid ? limit : defaults.timeLimitSec };
}

function readDate(value) {
  const date = typeof value === 'string' ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

/**
 * 書き出したファイルを読み、学習記録として使える形にする。
 * @returns {{progress: object, exportedAt: Date|null}}
 * @throws {BackupError} 読み込めないファイルのとき。message は画面にそのまま出せる。
 */
export function readBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('このファイルは読み込めません。アプリで書き出したファイルを選んでください。');
  }
  if (!isPlainObject(data) || data.app !== APP_ID || !isPlainObject(data.progress)) {
    throw new BackupError('瞬間英作文の記録のファイルではありません。アプリで書き出したファイルを選んでください。');
  }
  if (!Number.isInteger(data.format) || data.format > FORMAT_VERSION) {
    throw new BackupError('新しい版のアプリで書き出したファイルです。アプリを再読み込みしてから、もう一度読み込んでください。');
  }

  const defaults = emptyProgress();
  const source = data.progress;
  return {
    progress: {
      ...defaults,
      settings: readSettings(source.settings, defaults.settings),
      speechNoticeSeen: source.speechNoticeSeen === true,
      stats: readStats(source.stats),
      customAnswers: readCustomAnswers(source.customAnswers),
      lastBackupAt: readDate(source.lastBackupAt)?.toISOString() ?? null,
      review: readReview(source.review),
      days: readDays(source.days),
      achievements: readAchievements(source.achievements),
      speed: readSpeed(source.speed),
    },
    exportedAt: readDate(data.exportedAt),
  };
}

/** 読み込む前に見せる、記録の中身の要約。 */
export function summarizeProgress(progress, knownIds = null) {
  const entries = Object.entries(progress.stats).filter(([id]) => !knownIds || knownIds.has(id));
  const review = Object.entries(progress.review ?? {}).filter(([id]) => !knownIds || knownIds.has(id));
  return {
    attempts: entries.reduce((sum, [, stat]) => sum + stat.attempts, 0),
    questions: entries.length,
    mastered: review.filter(([, entry]) => entry.stage >= 3).length,
    days: Object.keys(progress.days ?? {}).length,
    achievements: Object.keys(progress.achievements ?? {}).length,
    customAnswers: Object.values(progress.customAnswers).reduce((sum, answers) => sum + answers.length, 0),
  };
}
