/**
 * iPhone の音声認識が2回目以降に止まる問題を調べる診断ページ。
 * 対策の候補を順に試し、どの方法なら音声が届くかを実機で確かめる。
 * 対応が決まったら、このファイルと mic-diagnosis.html は削除する。
 *
 * 利用者が数を数え続けている前提で、結果が届いたかどうかを自動で判定する。
 */
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

const LANGUAGE = 'en-US';
/** 許可の確認画面に答える時間を含めて、マイクが動き始めるのを待つ時間。 */
const AUDIO_START_LIMIT_MS = 20_000;
/** マイクが動き始めてから、結果が届くのを待つ時間。 */
const HEAR_LIMIT_MS = 5000;
/** 結果が届いた後も、アプリと同じように少し聞き続ける時間。 */
const LISTEN_AFTER_RESULT_MS = 1500;
/** 認識を止めてから、終了の通知を待つ時間。 */
const END_LIMIT_MS = 1500;
const REST_BETWEEN_PLANS_MS = 3000;
const SPEECH_LIMIT_MS = 5000;
const SPOKEN_TEXT = 'This is a test.';

const PLANS = [
  { id: 'A', label: '基本', runs: 4, gapMs: 1000 },
  { id: 'B', label: '先にマイクを開く', runs: 4, gapMs: 1000, heldMic: 'until-audiostart' },
  { id: 'C', label: 'マイクを開いたまま', runs: 4, gapMs: 1000, heldMic: 'until-end' },
  { id: 'D', label: '読み上げを挟む', runs: 3, gapMs: 1000, speakBetween: true },
  { id: 'E', label: '1回を続ける', continuous: true },
  { id: 'F', label: '6秒あける', runs: 3, gapMs: 6000 },
  { id: 'G', label: '無音を流し続ける', runs: 3, gapMs: 1000, silentAudio: true },
  { id: 'H', label: '15秒あける', runs: 2, gapMs: 15_000 },
];

/** 「1回を続ける」で、聞こえるか確かめる前に行うこと。 */
const CONTINUOUS_PHASES = [
  { label: '直後', silenceMs: 0 },
  { label: '15秒', silenceMs: 15_000 },
  { label: '30秒', silenceMs: 30_000 },
  { label: '読上', speak: true },
];

const startButton = document.querySelector('#start');
const intro = document.querySelector('#intro');
const cue = document.querySelector('#cue');
const table = document.querySelector('#results');
const report = document.querySelector('#report');
const copyButton = document.querySelector('#copy');
const toast = document.querySelector('#toast');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const reportLines = [];
let silentAudio = null;

function environmentLabel() {
  const version = /Version\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '?';
  return `Safari/${version} audioSession=${navigator.audioSession ? 'yes' : 'no'}`;
}

function showCue(kind, text) {
  cue.dataset.kind = kind;
  cue.textContent = text;
}

function addLine(line) {
  reportLines.push(line);
  report.textContent = reportLines.join(' / ');
}

function addRow(plan) {
  const row = table.insertRow();
  row.id = `plan-${plan.id}`;
  const header = document.createElement('th');
  header.textContent = `${plan.id} ${plan.label}`;
  row.append(header);
}

function addCell(plan, heard, text) {
  const cell = document.querySelector(`#plan-${plan.id}`).insertCell();
  cell.className = heard ? 'heard' : 'deaf';
  cell.textContent = `${heard ? '○' : '×'}${text}`;
}

function audioSessionState() {
  return navigator.audioSession?.state ?? '-';
}

/** 読み上げが終わるまで待つ。 */
function speakOnce(text) {
  return new Promise((resolve) => {
    const limit = setTimeout(resolve, SPEECH_LIMIT_MS);
    const finish = () => {
      clearTimeout(limit);
      resolve();
    };
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  });
}

async function openMicrophone() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    return null;
  }
}

function closeMicrophone(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function createRecognition(continuous) {
  const recognition = new Recognition();
  recognition.lang = LANGUAGE;
  recognition.continuous = continuous;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  return recognition;
}

/** 認識を1回行い、音声が届いたかどうかを記録する。 */
function listenOnce(plan, stream) {
  const track = stream?.getAudioTracks()[0];
  const record = { audioMs: null, heardMs: null, error: '', state: '-', muted: null };
  const recognition = createRecognition(false);
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);

  return new Promise((resolve) => {
    let timer = null;
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      record.muted = track ? track.muted : null;
      resolve(record);
    };
    const stopListening = () => {
      clearTimeout(timer);
      timer = setTimeout(finish, END_LIMIT_MS);
      recognition.abort();
    };

    recognition.onaudiostart = () => {
      record.audioMs = elapsed();
      record.state = audioSessionState();
      if (plan.heldMic === 'until-audiostart') closeMicrophone(stream);
      showCue('talk', '数えてください');
      clearTimeout(timer);
      timer = setTimeout(stopListening, HEAR_LIMIT_MS);
    };
    recognition.onresult = () => {
      if (record.heardMs !== null) return;
      record.heardMs = elapsed();
      clearTimeout(timer);
      timer = setTimeout(stopListening, LISTEN_AFTER_RESULT_MS);
    };
    recognition.onerror = (event) => {
      if (event.error !== 'aborted') record.error = event.error;
    };
    recognition.onend = finish;

    timer = setTimeout(stopListening, AUDIO_START_LIMIT_MS);
    try {
      recognition.start();
    } catch (error) {
      record.error = `start:${error.name}`;
      finish();
    }
  });
}

async function runRepeated(plan) {
  if (plan.silentAudio) await silentAudio?.resume();
  for (let run = 1; run <= plan.runs; run += 1) {
    showCue('wait', 'マイクの準備中');
    const stream = plan.heldMic ? await openMicrophone() : null;
    const record = await listenOnce(plan, stream);
    closeMicrophone(stream);

    const heard = record.heardMs !== null;
    addCell(plan, heard, record.audioMs ?? '-');
    addLine([
      `${plan.id}${run}`, heard ? 'ok' : 'ng', `a${record.audioMs ?? '-'}`, `h${record.heardMs ?? '-'}`,
      record.state, record.muted === null ? '' : `muted=${record.muted}`, record.error,
    ].filter(Boolean).join(' '));

    if (run < plan.runs) {
      if (plan.speakBetween) {
        showCue('wait', '読み上げ中');
        await speakOnce(SPOKEN_TEXT);
      }
      showCue('wait', 'そのまま数えてください');
      await sleep(plan.gapMs);
    }
  }
  if (plan.silentAudio) await silentAudio?.suspend();
}

async function waitForQuiet(ms) {
  for (let left = Math.round(ms / 1000); left > 0; left -= 1) {
    showCue('quiet', `黙ってください(あと${left}秒)`);
    await sleep(1000);
  }
}

/** 認識を止めずに、黙った後や読み上げの後も聞き取れるかを確かめる。 */
async function runContinuous(plan) {
  const recognition = createRecognition(true);
  const state = { audioStarted: false, ended: false, error: '', resultCount: 0, latest: '' };

  recognition.onaudiostart = () => { state.audioStarted = true; };
  recognition.onresult = (event) => {
    state.resultCount += 1;
    const results = Array.from(event.results);
    const finals = results.filter((result) => result.isFinal).length;
    state.latest = `n${results.length}f${finals}:${results.at(-1)[0].transcript.slice(-24)}`;
  };
  recognition.onerror = (event) => { state.error = event.error; };
  recognition.onend = () => { state.ended = true; };

  showCue('wait', 'マイクの準備中');
  try {
    recognition.start();
  } catch (error) {
    state.error = `start:${error.name}`;
    state.ended = true;
  }
  const startLimit = performance.now() + AUDIO_START_LIMIT_MS;
  while (!state.audioStarted && !state.ended && performance.now() < startLimit) await sleep(50);

  for (const phase of CONTINUOUS_PHASES) {
    if (phase.silenceMs) await waitForQuiet(phase.silenceMs);
    if (phase.speak) {
      showCue('wait', '読み上げ中');
      await speakOnce(SPOKEN_TEXT);
    }
    const before = state.resultCount;
    showCue('talk', '数えてください');
    const limit = performance.now() + HEAR_LIMIT_MS;
    while (state.resultCount === before && !state.ended && performance.now() < limit) await sleep(50);
    const heard = state.resultCount > before;
    if (heard) await sleep(LISTEN_AFTER_RESULT_MS);
    addCell(plan, heard, phase.label);
    addLine(`E:${phase.label} ${heard ? 'ok' : 'ng'} ${state.ended ? 'ended' : 'alive'} ${state.error} ${state.latest}`.trim());
  }
  recognition.abort();
  await sleep(END_LIMIT_MS);
}

function createSilentAudio() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  const gain = context.createGain();
  gain.gain.value = 0;
  const oscillator = context.createOscillator();
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  return context;
}

/** iOS は音声の再生に画面操作が必要なので、タップの処理の中で使えるようにしておく。 */
function unlockAudio() {
  silentAudio = createSilentAudio();
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

async function run() {
  startButton.hidden = true;
  intro.hidden = true;
  cue.hidden = false;
  table.hidden = false;
  report.hidden = false;
  addLine(environmentLabel());

  unlockAudio();
  await silentAudio?.resume();
  await silentAudio?.suspend();
  showCue('wait', 'マイクの確認中');
  const stream = await openMicrophone();
  if (!stream) {
    showCue('quiet', 'マイクを使えませんでした');
    return;
  }
  closeMicrophone(stream);
  await sleep(REST_BETWEEN_PLANS_MS);

  for (const plan of PLANS) {
    addRow(plan);
    if (plan.continuous) await runContinuous(plan);
    else await runRepeated(plan);
    showCue('wait', '次の準備中');
    await sleep(REST_BETWEEN_PLANS_MS);
  }

  showCue('wait', '完了です。この画面を撮影して送ってください');
  copyButton.hidden = false;
  window.scrollTo(0, 0);
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2500);
}

if (!Recognition) {
  startButton.disabled = true;
  intro.textContent = 'このブラウザは音声認識に対応していません。';
}

startButton.addEventListener('click', run);

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report.textContent);
    showToast('コピーしました');
  } catch {
    showToast('コピーできませんでした');
  }
});
