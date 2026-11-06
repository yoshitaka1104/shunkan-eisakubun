/**
 * iPhone で模範解答の読み上げが聞こえない問題を調べるページ。
 * 条件を変えて音を鳴らし、利用者の「聞こえた」「聞こえない」を記録する。
 * 対応が決まったら、このファイルと sound-check.html は削除する。
 */
const LANGUAGE = 'en-US';
const SPEECH_LIMIT_MS = 6000;
const TONE_SECONDS = 0.7;
const TONE_RATE = 44_100;
const RECORD_MS = 1500;
const WAIT_AFTER_RECORD_MS = 3000;

const stepTitle = document.querySelector('#step');
const hint = document.querySelector('#hint');
const intro = document.querySelector('#intro');
const playButton = document.querySelector('#play');
const answers = document.querySelector('#answers');
const table = document.querySelector('#results');
const report = document.querySelector('#report');
const copyButton = document.querySelector('#copy');
const toast = document.querySelector('#toast');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** 1つの audio 要素を使い回す。iOS は、タップで鳴らした要素なら後から操作なしで鳴らせる。 */
const audio = new Audio();

function makeToneUrl() {
  const count = Math.round(TONE_RATE * TONE_SECONDS);
  const bytes = new DataView(new ArrayBuffer(44 + count * 2));
  const text = (offset, value) => [...value].forEach((character, index) => {
    bytes.setUint8(offset + index, character.charCodeAt(0));
  });
  text(0, 'RIFF');
  bytes.setUint32(4, 36 + count * 2, true);
  text(8, 'WAVEfmt ');
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true);
  bytes.setUint16(22, 1, true);
  bytes.setUint32(24, TONE_RATE, true);
  bytes.setUint32(28, TONE_RATE * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  text(36, 'data');
  bytes.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index += 1) {
    const fade = Math.min(1, index / 2000, (count - index) / 2000);
    const sample = Math.sin((2 * Math.PI * 660 * index) / TONE_RATE) * 0.5 * fade;
    bytes.setInt16(44 + index * 2, sample * 32767, true);
  }
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

const toneUrl = makeToneUrl();

async function playTone() {
  const startedAt = performance.now();
  audio.src = toneUrl;
  try {
    await audio.play();
    await new Promise((resolve) => {
      audio.onended = resolve;
      setTimeout(resolve, 2000);
    });
    return `played@${Math.round(performance.now() - startedAt)}`;
  } catch (error) {
    return `play-error:${error.name}`;
  }
}

function englishVoice() {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((voice) => voice.lang === LANGUAGE) ?? voices.find((voice) => voice.lang.startsWith('en'));
}

function speakOnce(text, { useVoice = false, cancelFirst = false } = {}) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const events = [];
    const note = (label) => events.push(`${label}@${Math.round(performance.now() - startedAt)}`);
    let limit = null;
    const finish = () => {
      clearTimeout(limit);
      resolve(events.join(' ') || 'no-event');
    };
    limit = setTimeout(() => {
      note('timeout');
      finish();
    }, SPEECH_LIMIT_MS);

    if (cancelFirst) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE;
    if (useVoice) {
      const voice = englishVoice();
      if (voice) utterance.voice = voice;
      note(`voice:${voice?.name ?? 'none'}`);
    }
    utterance.onstart = () => note('start');
    utterance.onend = () => {
      note('end');
      finish();
    };
    utterance.onerror = (event) => {
      note(`error:${event.error}`);
      finish();
    };
    window.speechSynthesis.speak(utterance);
    note(`speaking=${window.speechSynthesis.speaking} pending=${window.speechSynthesis.pending}`);
  });
}

/** アプリと同じ手順で録音し、マイクを閉じる。 */
async function recordLikeApp() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  const context = new AudioContextClass();
  context.resume().catch(() => {});
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const processor = context.createScriptProcessor(2048, 1, 1);
  processor.onaudioprocess = () => {};
  context.createMediaStreamSource(stream).connect(processor);
  processor.connect(context.destination);
  await sleep(RECORD_MS);
  processor.disconnect();
  stream.getTracks().forEach((track) => track.stop());
  await context.close();
}

const STEPS = [
  { label: '電子音', hint: '「ピー」という音が鳴ります。', run: playTone },
  { label: '読み上げ', hint: '英語の声が流れます。', run: () => speakOnce('This is step two.') },
  {
    label: '声を指定して読み上げ',
    hint: '英語の声が流れます。',
    run: () => speakOnce('This is step three.', { useVoice: true }),
  },
  {
    label: '取り消してから読み上げ',
    hint: 'アプリと同じ手順で、英語の声が流れます。',
    run: () => speakOnce('This is step four.', { cancelFirst: true }),
  },
  {
    label: '録音の直後に読み上げ',
    hint: 'マイクの確認が出たら許可してください。約2秒録音した後、英語の声が流れます。',
    run: async () => {
      await recordLikeApp();
      return speakOnce('This is step five.');
    },
  },
  {
    label: '録音の3秒後に読み上げ',
    hint: '約2秒録音し、3秒待ってから、英語の声が流れます。',
    run: async () => {
      await recordLikeApp();
      await sleep(WAIT_AFTER_RECORD_MS);
      return speakOnce('This is step six.');
    },
  },
  {
    label: '録音の直後に電子音',
    hint: '約2秒録音した後、「ピー」という音が鳴ります。',
    run: async () => {
      await recordLikeApp();
      return playTone();
    },
  },
];

const results = [];
let stepIndex = -1;
let currentDetail = '';

function environmentLabel() {
  const version = /Version\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '?';
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((voice) => voice.lang.startsWith('en'));
  return `Safari/${version} voices=${voices.length} en=${english.length} default=${englishVoice()?.name ?? 'none'}`;
}

function showReport() {
  report.hidden = false;
  report.textContent = [
    environmentLabel(),
    ...results.map(({ number, heard, detail }) => `${number}${heard ? 'ok' : 'ng'} ${detail}`),
  ].join(' / ');
}

function addResultRow(number, label, heard) {
  const row = table.insertRow();
  const header = document.createElement('th');
  header.textContent = `${number} ${label}`;
  row.append(header);
  const cell = row.insertCell();
  cell.className = heard ? 'heard' : 'silent';
  cell.textContent = heard ? '○' : '×';
}

function showStep() {
  const step = STEPS[stepIndex];
  stepTitle.hidden = false;
  stepTitle.textContent = `${stepIndex + 1} / ${STEPS.length} ${step.label}`;
  hint.hidden = false;
  hint.textContent = step.hint;
  playButton.hidden = false;
  playButton.textContent = '再生';
  playButton.disabled = false;
  answers.hidden = true;
}

function finishAll() {
  stepTitle.textContent = '完了です。この画面を撮影して送ってください';
  hint.hidden = true;
  playButton.hidden = true;
  answers.hidden = true;
  copyButton.hidden = false;
  window.scrollTo(0, 0);
}

function nextStep() {
  stepIndex += 1;
  if (stepIndex < STEPS.length) showStep();
  else finishAll();
}

function recordAnswer(heard) {
  const number = stepIndex + 1;
  results.push({ number, heard, detail: currentDetail });
  addResultRow(number, STEPS[stepIndex].label, heard);
  showReport();
  nextStep();
}

async function playStep() {
  playButton.disabled = true;
  playButton.textContent = '再生中';
  try {
    currentDetail = await STEPS[stepIndex].run();
  } catch (error) {
    currentDetail = `error:${error.name}`;
  }
  playButton.hidden = true;
  answers.hidden = false;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 2500);
}

playButton.addEventListener('click', () => {
  if (stepIndex < 0) {
    intro.hidden = true;
    nextStep();
    return;
  }
  playStep();
});
document.querySelector('#heard').addEventListener('click', () => recordAnswer(true));
document.querySelector('#silent').addEventListener('click', () => recordAnswer(false));

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(report.textContent);
    showToast('コピーしました');
  } catch {
    showToast('コピーできませんでした');
  }
});
