import { wavHeader } from './wav.mjs';
import { listRecordings, readRecording, saveRecording } from './recording-store.mjs';
const $ = id => document.getElementById(id);
const ui = Object.fromEntries(['authorize','record','stop','recordText','state','stateText','clock','wave','emptyWave','duration','level','error','notice','result','download','fileInfo','player','technical','actualInput','connection','disconnect','libraryList','libraryStatus','libraryEmpty','libraryError','libraryRefresh','retrySave','resultTitle'].map(id => [id, $(id)]));
let stream, context, source, worklet, sink, wakeLock;
let recording = false, stopping = false, busy = false, savedURL, chunks = [], peaks = [], frames = 0, sampleRate = 48000;
let startedAt = 0, lastChunk = 0, missingFrames = 0, stopAck, watch, unsaved = false, fatal = false;
let deviceLabel = '', capturedSettings = {}, recordingDate;
let authorizedStream = null;
let currentTakeId = null, pendingTake = null, libraryEntries = [];
function stamp(time, tenth = false) {
  const v = Math.max(0, Number.isFinite(time) ? time : 0);
  const base = `${String(Math.floor(v / 60)).padStart(2,'0')}:${String(Math.floor(v % 60)).padStart(2,'0')}`;
  return tenth ? `${base}<span>.${Math.floor((v % 1) * 10)}</span>` : base;
}
function error(message) { ui.error.textContent = message; ui.error.hidden = !message; }
function humanError(e) {
  return ({NotAllowedError:'麦克风权限未开启。请点击地址栏左侧的网站设置，允许使用麦克风，再重试。',NotFoundError:'没有找到麦克风，请连接录音设备后重试。',NotReadableError:'无法读取麦克风。请检查设备连接，以及其他软件是否独占了设备。',OverconstrainedError:'默认输入当前不可用，请检查系统或浏览器的麦克风设置后重新连接。',SecurityError:'浏览器阻止了录音权限，请用本机地址或 HTTPS 页面打开。'})[e.name] || e.message || '录音失败，请检查设备后重试。';
}
function controls() {
  ui.record.disabled = recording || busy || stopping;
  ui.stop.disabled = !recording || stopping;
  ui.authorize.disabled = recording || busy || stopping;
  ui.connection.hidden = !authorizedStream?.active;
  ui.authorize.textContent = authorizedStream?.active ? '重新连接' : '允许麦克风';
  ui.disconnect.disabled = recording || busy || stopping;
  ui.libraryRefresh.disabled = recording || busy || stopping;
  ui.retrySave.disabled = recording || busy || stopping;
  ui.libraryList.querySelectorAll('button').forEach(button => { button.disabled = recording || busy || stopping; });
  ui.recordText.textContent = busy ? '正在连接…' : '开始录音';
  ui.state.classList.toggle('recording', recording);
}
// Do not pin or restore a deviceId: the browser supplies its current default
// input. Reconnecting must release the previous stream before requesting again.
const constraints = () => ({audio:{channelCount:{exact:1},echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
function disconnectInput() {
  authorizedStream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
  authorizedStream = null;
  ui.actualInput.textContent = '尚未连接'; ui.actualInput.classList.add('pending');
}
function showConnectedInput() {
  const track = authorizedStream?.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') { ui.actualInput.textContent = '尚未连接'; ui.actualInput.classList.add('pending'); return; }
  ui.actualInput.textContent = track.label || '默认麦克风（浏览器未提供名称）'; ui.actualInput.classList.remove('pending');
  ui.notice.textContent = `当前输入：${track.label || '默认麦克风'}，可直接开始录音。`;
}
function watchConnectedInput() {
  const idleStream = authorizedStream;
  const track = idleStream?.getAudioTracks()[0];
  if (track) track.onended = () => {
    if (authorizedStream !== idleStream) return;
    disconnectInput();
    ui.notice.textContent = '麦克风连接已结束，请重新允许麦克风或开始录音。';
    controls();
  };
}
async function connectInput(reconnect = false) {
  if (reconnect) disconnectInput();
  if (!authorizedStream?.active) authorizedStream = await navigator.mediaDevices.getUserMedia(constraints());
  const track = authorizedStream.getAudioTracks()[0];
  if (!track || track.readyState !== 'live') { disconnectInput(); throw new Error('未收到有效的默认麦克风输入，请检查系统设置后重试。'); }
  watchConnectedInput();
  showConnectedInput();
}
ui.authorize.onclick = async () => {
  if (busy || recording || stopping) return;
  busy = true; error(''); controls();
  ui.notice.textContent = '正在请求默认麦克风，请允许浏览器使用麦克风。';
  try {
    await connectInput(true);
  } catch(e) { showConnectedInput(); ui.notice.textContent = '默认麦克风未连接，请检查设置后重试。'; error(humanError(e)); }
  finally { busy = false; controls(); }
};
ui.disconnect.onclick = async () => {
  if (recording || busy || stopping) return;
  disconnectInput();
  ui.notice.textContent = '麦克风已断开；需要录音时直接点击开始录音即可。';
  controls();
};
ui.record.onclick = start;
async function start() {
  if (recording || busy || stopping) return;
  if (unsaved && !confirm('上一段录音尚未成功保存到录音库，也没有下载。开始新录音会丢失这段未保存的录音，是否继续？')) return;
  busy = true; error(''); controls(); ui.player.pause();
  try {
    ui.actualInput.textContent = '正在连接麦克风…'; ui.actualInput.classList.add('pending');
    await connectInput();
    const retainedTrack = authorizedStream?.getAudioTracks()[0];
    if (retainedTrack?.readyState !== 'live') throw new Error('麦克风连接已断开，请重新连接。');
    stream = authorizedStream; authorizedStream = null;
    const track = stream.getAudioTracks()[0]; capturedSettings = track.getSettings(); deviceLabel = track.label;
    if (track !== retainedTrack) throw new Error('已授权输入发生变化，请重新连接。');
    context = new AudioContext({sampleRate:capturedSettings.sampleRate || 48000});
    try { await context.audioWorklet.addModule(window.VIBE_WORKLET_URL || './pcm-worklet.js', {credentials:'omit'}); }
    catch(e) { throw new Error(`录音模块无法加载，请确认使用最新的单文件版，或改用本机网页入口。${e.message}`); }
    source = context.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(context, 'vibe-pcm', {numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:'explicit'});
    sink = context.createGain(); sink.gain.value = 0;
    await context.resume();
    if (context.state !== 'running') throw new Error('浏览器音频未能启动，请重新点击开始录音。');
    // Retain the previous completed take until the new input is ready.
    if (savedURL) URL.revokeObjectURL(savedURL); savedURL = null;
    ui.player.removeAttribute('src'); ui.player.load(); ui.result.hidden = true;
    chunks = []; peaks = []; frames = 0; missingFrames = 0; fatal = false; unsaved = false; currentTakeId = null; pendingTake = null; ui.retrySave.hidden = true;
    renderLibrary();
    sampleRate = context.sampleRate; recordingDate = new Date(); startedAt = performance.now(); lastChunk = startedAt;
    worklet.port.onmessage = ({data}) => {
      if (data.type === 'stopped') { stopAck?.(); return; }
      if (data.type !== 'pcm') return;
      chunks.push(data.buffer); peaks.push({start:frames,frames:data.frames,peak:data.peak}); frames += data.frames; missingFrames += data.missing; lastChunk = performance.now();
      ui.level.textContent = `输入电平 ${Math.round(data.peak * 100)}%`;
      ui.clock.innerHTML = stamp(frames / sampleRate, true); ui.duration.textContent = stamp(frames / sampleRate); draw();
      if (frames >= sampleRate * 1800 && recording && !stopping) { error('已达到 30 分钟上限，本段录音已停止。请下载后继续录下一段。'); stop(); }
    };
    worklet.onprocessorerror = () => fail('音频处理发生异常，已停止并保留收到的部分。请下载后重新录制。');
    track.onended = () => fail('录音设备已断开，已停止并保留收到的部分。');
    context.onstatechange = () => { if (recording && !stopping && context.state !== 'running') fail('浏览器音频已中断，已停止并保留收到的部分。请保持电脑唤醒后重新录制。'); };
    source.connect(worklet); worklet.connect(sink); sink.connect(context.destination);
    recording = true; busy = false; ui.emptyWave.hidden = true; ui.stateText.textContent = '正在录音';
    ui.actualInput.textContent = `${deviceLabel || '默认麦克风（浏览器未提供名称）'}（正在使用）`; ui.actualInput.classList.remove('pending');
    ui.notice.textContent = `正在录制 ${deviceLabel || '默认麦克风'}，停顿也会保留。`;
    const dsp = ['echoCancellation','noiseSuppression','autoGainControl'];
    ui.technical.textContent = `${sampleRate / 1000} kHz · 单声道`;
    if (dsp.some(k => capturedSettings[k] === true)) error('浏览器仍启用了声音处理，本次录音可能受到影响。请检查浏览器和系统麦克风设置。');
    watch = setInterval(() => {
      if (recording && !stopping && performance.now() - lastChunk > 4000) fail('超过 4 秒没有收到音频数据，已停止并保留收到的部分。');
    }, 1000);
    controls();
    navigator.wakeLock?.request('screen').then(lock => { if (recording) wakeLock = lock; else lock.release(); }).catch(() => {});
  } catch(e) { await cleanup(true); busy = false; showConnectedInput(); ui.stateText.textContent = savedURL ? '已停止' : '准备录音'; error(humanError(e)); controls(); }
}
function fail(message) { if (!recording || stopping) return; fatal = true; error(message); stop(); }
ui.stop.onclick = stop;
async function stop() {
  if (!recording || stopping) return;
  stopping = true; ui.stateText.textContent = '正在生成 WAV…'; controls(); clearInterval(watch);
  let acknowledged = false;
  try {
    await new Promise(resolve => {
      let timer;
      stopAck = () => { acknowledged = true; clearTimeout(timer); resolve(); };
      timer = setTimeout(resolve, 1500); worklet.port.postMessage('stop');
    });
    if (!acknowledged) { fatal = true; error('音频线程未及时结束，已保留收到的音频，末尾可能不完整。'); }
  } finally {
    recording = false; await cleanup(!fatal);
  }
  try {
    if (!frames) throw new Error('没有收到音频数据，未生成空录音。请检查设备后重试。');
    const blob = new Blob([wavHeader(frames, sampleRate), ...chunks], {type:'audio/wav'}); chunks = [];
    savedURL = URL.createObjectURL(blob); ui.player.src = savedURL;
    ui.download.href = savedURL; ui.download.download = `Vibe_${localDate(recordingDate)}.wav`;
    ui.fileInfo.textContent = `${deviceLabel} · ${stamp(frames / sampleRate)} · ${sampleRate / 1000} kHz · 单声道 · ${(blob.size / 1048576).toFixed(2)} MB`;
    ui.result.hidden = false; unsaved = true;
    ui.resultTitle.textContent = '本次录音';
    ui.clock.innerHTML = stamp(frames / sampleRate, true);
    ui.stateText.textContent = fatal ? '录音中断，部分可下载' : '录音已生成';
    ui.notice.textContent = '正在自动保存到录音库…';
    const metadata = {id:crypto.randomUUID(),createdAt:recordingDate.getTime(),title:displayDate(recordingDate),
      device:deviceLabel,sampleRate,frames,bytes:blob.size,filename:ui.download.download,interrupted:fatal};
    pendingTake = {metadata,blob,peaks:[...peaks]};
    await savePendingTake();
    ui.level.textContent = '点击波形可定位';
    if (missingFrames > 0 && !fatal) error(`本段有 ${(missingFrames / sampleRate).toFixed(3)} 秒未收到输入声道，文件中已保留对应静音，请核对。`);
  } catch(e) { error(humanError(e)); ui.stateText.textContent = '未生成录音'; }
  stopping = false; stopAck = null; controls(); draw();
}
async function cleanup(keepInput = false) {
  clearInterval(watch); source?.disconnect(); worklet?.disconnect(); sink?.disconnect();
  stream?.getTracks().forEach(t => { t.onended = null; if (!keepInput) t.stop(); });
  if (keepInput && stream?.active) { authorizedStream = stream; watchConnectedInput(); }
  stream = null;
  if (context) { context.onstatechange = null; try { await context.close(); } catch {} context = null; }
  try { await wakeLock?.release(); } catch {} wakeLock = null;
}
function localDate(date) { const p = n => String(n).padStart(2,'0'); return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`; }
ui.download.onclick = () => { unsaved = false; ui.notice.textContent = '已发起 WAV 下载，请在浏览器下载列表中确认文件保存完成。'; };
function displayDate(date) {
  return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date);
}
function libraryMessage(message) { ui.libraryError.textContent = message; ui.libraryError.hidden = !message; }
async function refreshLibrary() {
  try {
    libraryEntries = await listRecordings(); renderLibrary(); libraryMessage('');
  } catch(e) { libraryMessage(`录音库暂时不可用：${humanError(e)} 新录音仍可手动下载 WAV。`); }
}
function renderLibrary() {
  ui.libraryList.replaceChildren();
  ui.libraryEmpty.hidden = libraryEntries.length > 0;
  const total = libraryEntries.reduce((n,entry)=>n+entry.bytes,0);
  ui.libraryStatus.textContent = `${libraryEntries.length} 段录音 · ${(total/1048576).toFixed(2)} MB`;
  for (const entry of libraryEntries) {
    const row = document.createElement('article'); row.className = 'recording-row'; row.dataset.recordingId = entry.id;
    const selected = entry.id === currentTakeId; row.classList.toggle('selected',selected);
    const play = document.createElement('button'); play.className='recording-play'; play.type='button';
    play.setAttribute('aria-label',`播放 ${entry.title}`); play.setAttribute('aria-pressed',String(selected));
    const icon = document.createElement('span'); icon.className='play-icon'; icon.textContent='▶'; icon.setAttribute('aria-hidden','true');
    const text = document.createElement('span'); text.className='recording-text';
    const title = document.createElement('strong'); title.textContent=entry.title;
    const details = document.createElement('span'); details.textContent=`${stamp(entry.frames/entry.sampleRate)} · ${entry.device || '麦克风'} · ${(entry.bytes/1048576).toFixed(2)} MB${entry.interrupted?' · 中断录音':''}`;
    text.append(title,details); play.append(icon,text);
    const download = document.createElement('button'); download.type='button'; download.className='library-download';
    download.textContent='下载 WAV'; download.setAttribute('aria-label',`下载 ${entry.title}`);
    play.onclick=()=>openTake(entry.id,true); download.onclick=()=>downloadTake(entry.id);
    row.append(play,download); ui.libraryList.append(row);
  }
  controls();
}
async function savePendingTake() {
  if (!pendingTake) return;
  const take = pendingTake;
  try {
    await saveRecording(take.metadata,take.blob,take.peaks);
    currentTakeId = take.metadata.id; pendingTake = null; unsaved = false; ui.retrySave.hidden = true;
    ui.stateText.textContent = take.metadata.interrupted ? '中断前的录音已保存' : '已保存到录音库';
    ui.notice.textContent = '本段已自动保存，可以直接录下一段；下方录音库可随时回听。';
    await refreshLibrary();
  } catch(e) {
    unsaved = true; ui.retrySave.hidden = false;
    ui.stateText.textContent = '录音已生成，自动保存未成功';
    const cause = e.name === 'QuotaExceededError' ? '浏览器存储空间不足' : humanError(e);
    libraryMessage(`本次录音尚未保存：${cause}。请先下载 WAV 保留；已有录音不会被替换。`);
    ui.notice.textContent = '自动保存未成功，请下载本次录音，或点击「重试保存」。';
  }
}
async function openTake(id,autoplay=false) {
  if (recording || busy || stopping) return;
  if (unsaved) { error('当前录音还未保存，请先下载 WAV 或重试保存，再打开历史录音。'); return; }
  busy=true; controls(); ui.player.pause(); error('');
  try {
    const take=await readRecording(id);
    if (savedURL) URL.revokeObjectURL(savedURL);
    savedURL=URL.createObjectURL(take.blob); ui.player.src=savedURL;
    ui.download.href=savedURL; ui.download.download=take.filename;
    frames=take.frames; sampleRate=take.sampleRate; peaks=take.peaks;
    currentTakeId=id; ui.result.hidden=false; ui.resultTitle.textContent=`回听 ${take.title}`;
    ui.fileInfo.textContent=`${take.device} · ${stamp(frames/sampleRate)} · ${sampleRate/1000} kHz · 单声道 · ${(take.bytes/1048576).toFixed(2)} MB`;
    ui.clock.innerHTML=stamp(0,true); ui.duration.textContent=stamp(frames/sampleRate); ui.emptyWave.hidden=true;
    ui.level.textContent='点击波形可定位'; ui.stateText.textContent='回听历史录音';
    ui.notice.textContent='这段录音已保存在录音库中，回听后可直接开始下一段。';
    draw(); renderLibrary();
    if (autoplay) {
      try { await ui.player.play(); } catch { ui.notice.textContent='录音已载入，点击播放器的播放按钮即可回听。'; }
    }
  } catch(e) { libraryMessage(humanError(e)); }
  finally { busy=false; controls(); }
}
async function downloadTake(id) {
  if (recording || busy || stopping) return;
  busy=true; controls();
  try {
    const take=await readRecording(id); const url=URL.createObjectURL(take.blob);
    const link=document.createElement('a'); link.href=url; link.download=take.filename;
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
  } catch(e) { libraryMessage(humanError(e)); }
  finally { busy=false; controls(); }
}
ui.libraryRefresh.onclick=refreshLibrary;
ui.retrySave.onclick=async()=>{if(busy||recording||stopping)return;busy=true;controls();try{await savePendingTake();}finally{busy=false;controls();}};
window.addEventListener('focus',()=>{if(!recording&&!busy&&!stopping)refreshLibrary();});
function draw() {
  const canvas = ui.wave, rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  if (!rect.width) return;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr,dpr);
  const w = rect.width, h = rect.height;
  ctx.strokeStyle = '#e2e8f2'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();
  const buckets = new Float32Array(Math.max(1, Math.floor(w / 2)));
  const span = Math.max(sampleRate * 5, frames);
  for (const p of peaks) { const index = Math.min(buckets.length-1, Math.floor(p.start / span * buckets.length)); buckets[index] = Math.max(buckets[index],p.peak); }
  ctx.strokeStyle = '#3c6aca'; ctx.lineWidth = 1.4; ctx.beginPath();
  for(let i=0;i<buckets.length;i++) if(buckets[i]>0) {const x=i/buckets.length*w,y=Math.max(1,buckets[i]*h*.45);ctx.moveTo(x,h/2-y);ctx.lineTo(x,h/2+y);} ctx.stroke();
  if (frames) {const pos=recording?frames:ui.player.currentTime*sampleRate;const x=Math.min(w,pos/span*w);ctx.strokeStyle=recording?'#d84151':'#db8b36';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
}
ui.wave.onclick = e => {
  if (recording || stopping || !savedURL) return;
  const rect = ui.wave.getBoundingClientRect(); ui.player.currentTime = Math.min(frames/sampleRate, Math.max(0,(e.clientX-rect.left)/rect.width*Math.max(5,frames/sampleRate)));
  ui.clock.innerHTML = stamp(ui.player.currentTime,true); draw();
};
ui.player.ontimeupdate = () => { ui.clock.innerHTML = stamp(ui.player.currentTime,true); draw(); };
ui.player.onseeked = () => { ui.clock.innerHTML = stamp(ui.player.currentTime,true); draw(); };
new ResizeObserver(draw).observe(ui.wave);
window.addEventListener('pagehide', () => { authorizedStream?.getTracks().forEach(t => t.stop()); stream?.getTracks().forEach(t => t.stop()); });
window.addEventListener('beforeunload',e => {if(recording||busy||stopping||unsaved){e.preventDefault();e.returnValue='';}});
navigator.mediaDevices?.addEventListener('devicechange', () => {
  if (!recording && !busy && !stopping && authorizedStream?.active) {
    ui.notice.textContent = '检测到输入设备有变化。如已切换系统录音设备，请点击「重新连接」后再录音。';
  }
});
if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) { error('当前浏览器不支持此录音方式，请用最新版 Chrome / Edge 打开，或使用本机网页入口。'); ui.record.disabled=true;ui.authorize.disabled=true; }
draw();
refreshLibrary();
