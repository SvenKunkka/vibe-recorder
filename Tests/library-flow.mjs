import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {wavHeader} from '../web/wav.mjs';

class Element {
  constructor(){this.options=[];this.children=[];this.dataset={};this._value='';this.textContent='';this.hidden=false;this.classList={add(){},remove(){},toggle(){}};}
  replaceChildren(){this.options=[];this.children=[];this._value='';}
  add(option){this.options.push(option);}
  append(...children){this.children.push(...children);}
  querySelectorAll(){return this.children.flatMap(row=>row.children).filter(child=>child.type==='button');}
  setAttribute(){} removeAttribute(){} pause(){} load(){} play(){return Promise.resolve();}
  get value(){return this._value;}
  set value(v){this._value=this.options.some(o=>o.value===v)?v:'';}
  get length(){return this.options.length;}
  getBoundingClientRect(){return {width:0,height:0};}
}
const elements=new Map(), get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
const tracks=[], requests=[];
let defaultName='XYJ F4 Vibe',failMic=false;
function requestMicrophone(options){
  micCalls++;requests.push(options);
  assert.equal('deviceId' in options.audio,false,'always request default input without deviceId');
  if(failMic){const e=new Error('denied');e.name='NotAllowedError';throw e;}
  const track={label:defaultName,readyState:'live',getSettings:()=>({sampleRate:48000}),stop(){this.readyState='ended';}};
  tracks.push(track);
  return {get active(){return track.readyState==='live';},getTracks:()=>[track],getAudioTracks:()=>[track]};
}
const stored=new Map();let failSaving=false,node,micCalls=0,confirmCalls=0;
const sandbox={console,Blob,Date,crypto:{randomUUID},wavHeader,
  listRecordings:async()=>[...stored.values()].map(({blob,peaks,...metadata})=>metadata),
  readRecording:async id=>stored.get(id),
  saveRecording:async(metadata,blob,peaks)=>{if(failSaving){const e=new Error('quota');e.name='QuotaExceededError';throw e;}stored.set(metadata.id,{...metadata,blob,peaks});},
  document:{getElementById:get,createElement:()=>new Element(),body:new Element()},
  Option:class{constructor(text,value){this.text=text;this.value=value;}},
  navigator:{mediaDevices:{getUserMedia:async options=>requestMicrophone(options),enumerateDevices:async()=>{throw new Error('device enumeration must not be called');},addEventListener(){}}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},window:{isSecureContext:true,AudioWorkletNode:true,addEventListener(){}},
  ResizeObserver:class{observe(){}},devicePixelRatio:1,
  AudioContext:class{constructor(){this.state='running';this.sampleRate=48000;this.audioWorklet={addModule:async()=>{}};}createMediaStreamSource(){return{connect(){},disconnect(){}};}createGain(){return{gain:{value:1},connect(){},disconnect(){}};}resume(){return Promise.resolve();}close(){return Promise.resolve();}},
  AudioWorkletNode:class{constructor(){node=this;this.port={postMessage:()=>Promise.resolve().then(()=>this.port.onmessage({data:{type:'stopped'}}))};}connect(){}disconnect(){}},
  URL:{revokeObjectURL(){},createObjectURL:()=> 'blob:test'},performance:{now:()=>0},confirm:()=>{confirmCalls++;return false;},setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout};
vm.runInNewContext(fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),sandbox);
async function finishTake(){node.port.onmessage({data:{type:'pcm',buffer:new ArrayBuffer(8192),frames:4096,peak:.04,missing:0}});await get('stop').onclick();}
await get('record').onclick();await finishTake();
assert.equal(stored.size,1);assert.equal(get('stateText').textContent,'已保存到录音库');
const firstId=[...stored.keys()][0];
await get('record').onclick();
assert.equal(confirmCalls,0,'saved takes must not trigger overwrite confirmation');assert.equal(micCalls,1,'same approved microphone reused');
failSaving=true;await finishTake();
assert.equal(stored.size,1,'quota failure preserves the previous recording');
assert.equal(get('retrySave').hidden,false);assert.match(get('libraryError').textContent,/空间不足/);
const unsavedDownload=get('download').href;
failMic=true;await get('authorize').onclick();
assert.equal(tracks[0].readyState,'ended','reconnect releases previous source');
assert.equal(get('actualInput').textContent,'尚未连接','failed reconnection cannot show stale device');
assert.equal(get('download').href,unsavedDownload,'failed reconnection preserves current WAV');
assert.equal(get('retrySave').hidden,false,'failed reconnection preserves pending library save');
assert.equal(stored.size,1,'failed reconnection never changes the saved library');
await get('record').onclick();assert.equal(confirmCalls,1);assert.equal(stored.size,1);
await get('libraryList').children[0].children[0].onclick();
assert.match(get('error').textContent,/请先下载/,'history cannot replace the only unsaved take');
failSaving=false;await get('retrySave').onclick();
assert.equal(stored.size,2);assert.equal(get('retrySave').hidden,true);
assert.equal(get('libraryList').children.length,2);
assert.ok(stored.has(firstId),'second save never overwrites the first take');
await get('retrySave').onclick();assert.equal(stored.size,2,'retry after success does not duplicate records');
await get('libraryList').children[0].children[0].onclick();
assert.equal(get('stateText').textContent,'回听历史录音');
failMic=false;defaultName='MacBook Pro麦克风';
await get('authorize').onclick();
assert.equal(micCalls,3,'explicit reconnection requests the current default anew');
assert.match(get('actualInput').textContent,/MacBook Pro/);
assert.equal(stored.size,2,'changing default input preserves library');
await get('record').onclick();await finishTake();
assert.equal(micCalls,3,'recording reuses the reconnected default stream');
assert.equal(stored.size,3);assert.match([...stored.values()].at(-1).device,/MacBook Pro/);
assert.equal(requests.every(r=>!('deviceId' in r.audio)),true);
console.log('PASS: default-only permission requests, stream reuse, explicit reconnection releases old track and adopts changed default, failed reconnect preserves pending WAV and library, automatic saving and playback, quota recovery.');
