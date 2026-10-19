import test from 'node:test';
import assert from 'node:assert/strict';
import {DrivingAudio,engineMix,recordingGain} from '../game/audio.js';

const buffer=channels=>({numberOfChannels:channels.length,length:channels[0].length,getChannelData:i=>channels[i]});
const rms=values=>Math.sqrt(values.reduce((sum,value)=>sum+value*value,0)/values.length);

test('recording trims balance mono and stereo takes and do not amplify silence',()=>{
  const coast=[.1,-.1,.1,-.1],load=[.3,-.3,.3,-.3];
  const coastLevel=rms(coast)*recordingGain(buffer([coast]));
  const loadLevel=rms(load)*recordingGain(buffer([load,load]));
  assert.ok(Math.abs(coastLevel-loadLevel)<1e-8);
  assert.equal(recordingGain(buffer([[0,0,0,0]])),0);
  assert.ok(recordingGain(buffer([[.0001,-.0001]]))<=3,'quiet noise is not boosted without a limit');
});

test('engine load changes tone without a volume hole or an oversized loudness jump',()=>{
  for(const rpm of [850,2400,4200,6200]){
    const coast=Math.hypot(...engineMix(rpm,0).gains),full=Math.hypot(...engineMix(rpm,1).gains);
    assert.ok(20*Math.log10(full/coast)<2.2,'full load stays within 2.2 dB at the same RPM');
    let previous=coast;
    for(let load=0;load<=1;load+=.01){
      const level=Math.hypot(...engineMix(rpm,load).gains);
      assert.ok(level>=previous-1e-9&&level<=full+1e-9,'crossfade energy is continuous and monotonic');previous=level;
    }
  }
  assert.ok(engineMix(850,0).rates[0]<.17,'idle playback follows 850 RPM');
  assert.ok(Math.hypot(...engineMix(850,0).gains)<Math.hypot(...engineMix(4200,1).gains)*.5,'idle is softer than a loaded engine at speed');
});

const param=()=>({value:0,setTargetAtTime(value){this.value=value;}});
function mixer(){
  const audio=new DrivingAudio();audio.ready=audio.enabled=true;audio.context={currentTime:1};audio.master={gain:param()};
  audio.layers=Array.from({length:4},()=>({source:{playbackRate:param()},gain:{gain:param()},filter:{frequency:param()},trim:1}));
  audio.exhaustPop=()=>{audio.pops=(audio.pops||0)+1;};audio.impact=()=>{audio.hits=(audio.hits||0)+1;};
  return audio;
}
const state={speed:25,slip:0,throttle:1,brake:0,rpm:4200,gear:1,popCount:0,impact:1,collision:0,active:true,bonnet:false};

test('a key press and a gear change preserve the engine bed',()=>{
  const audio=mixer();audio.update(state,1/60);
  assert.ok(audio.layers[0].gain.gain.value>0&&audio.layers[1].gain.gain.value>0,'load fades in through the coast take');
  for(let i=0;i<100;i++)audio.update(state,1/60);
  const before=Math.hypot(...audio.layers.slice(0,2).map(layer=>layer.gain.gain.value));
  audio.update({...state,gear:2},1/60);
  const after=Math.hypot(...audio.layers.slice(0,2).map(layer=>layer.gain.gain.value));
  assert.ok(after/before>.8,'shift does not halve the engine volume');
});

test('pause and mute suppress effects without replaying old exhaust events',()=>{
  const audio=mixer();audio.update({...state,popCount:1,popStrength:.4},1/60);assert.equal(audio.pops,1);
  audio.update({...state,popCount:2,active:false,collision:1},1/60);assert.equal(audio.pops,1);assert.equal(audio.hits,undefined);assert.equal(audio.master.gain.value,0);
  audio.enabled=false;audio.update({...state,popCount:3,collision:1},1/60);assert.equal(audio.pops,1);assert.equal(audio.hits,undefined);
  audio.enabled=true;audio.update({...state,popCount:3},1/60);assert.equal(audio.pops,1);
});

test('failed audio loading releases its context and can be retried',async()=>{
  const audio=new DrivingAudio();let attempts=0,closed=0;
  audio.init=async()=>{
    attempts++;audio.context={state:'running',close:async()=>{closed++;}};
    audio.master={gain:param()};audio.layers=[{}];
    if(attempts===1)throw new Error('Download interrupted');
    audio.ready=true;
  };
  await assert.rejects(audio.enable(true),/Download interrupted/);
  assert.equal(audio.enabled,false);assert.equal(audio.ready,false);
  assert.equal(closed,1);assert.equal(audio.context,null);assert.equal(audio.master,null);assert.deepEqual(audio.layers,[]);
  await audio.enable(true);
  assert.equal(attempts,2);assert.equal(audio.enabled,true);assert.equal(audio.ready,true);
});

test('concurrent sound requests share loading and a pending mute stays muted',async()=>{
  const audio=new DrivingAudio();let complete,attempts=0,resumes=0;
  audio.init=()=>{attempts++;audio.context={state:'suspended',resume:async()=>{resumes++;}};return new Promise(resolve=>{complete=()=>{audio.ready=true;resolve();};});};
  const first=audio.enable(true),second=audio.enable(true);await audio.enable(false);complete();await Promise.all([first,second]);
  assert.equal(attempts,1);assert.equal(resumes,0);assert.equal(audio.enabled,false);
  await audio.enable(true);assert.equal(attempts,1);assert.equal(resumes,1);assert.equal(audio.enabled,true);
});
