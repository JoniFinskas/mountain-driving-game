// V8 samples (CC BY-SA 4.0), CC0 tyre and wind layers. Source details are in credits.txt.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

// Match the energy of the two recordings without changing the source assets.
export function recordingGain(buffer){
  let energy=0;
  for(let channel=0;channel<buffer.numberOfChannels;channel++){
    const data=buffer.getChannelData(channel);
    for(const value of data)energy+=value*value;
  }
  const rms=Math.sqrt(energy/(buffer.length*buffer.numberOfChannels));
  return rms>1e-6?Math.min(3,.18/rms):0;
}

// Align the end of a steady engine take with a matching part of its beginning.
// A linear fade between unrelated phases produces a periodic volume dip that
// can sound like another shift, even while the gearbox stays in the same gear.
export function engineLoop(original){
  const fade=Math.min(Math.round(original.sampleRate*.016),Math.floor(original.length*.08));
  const channels=Array.from({length:original.numberOfChannels},(_,ch)=>original.getChannelData(ch));
  const score=offset=>{
    let aa=0,bb=0,ab=0;
    for(const data of channels)for(let j=0;j<fade;j+=3){const a=data[j],b=data[offset+j];aa+=a*a;bb+=b*b;ab+=a*b;}
    return aa*bb>1e-15?ab/Math.sqrt(aa*bb):0;
  };
  let end=original.length-fade,best=-Infinity;
  const lower=Math.floor(original.length*.72),upper=original.length-fade;
  for(let offset=lower;offset<=upper;offset+=8){const correlation=score(offset);if(correlation>best){best=correlation;end=offset;}}
  const coarse=end;for(let offset=Math.max(lower,coarse-7);offset<=Math.min(upper,coarse+7);offset++){const correlation=score(offset);if(correlation>best){best=correlation;end=offset;}}
  const correlation=clamp(best,0,1);
  return {end,correlation,channels:channels.map(data=>{
    const output=data.slice(0,end);
    for(let j=0;j<fade&&j<end;j++){
      const u=j/fade,v=1-u,normalise=1/Math.sqrt(u*u+v*v+2*correlation*u*v);
      output[j]=(data[j]*u+data[end+j]*v)*normalise;
    }
    return output;
  })};
}

export function engineMix(rpm,load,bonnet=false){
  load=clamp(load,0,1);
  const revs=clamp((rpm-850)/5950,0,1),level=(.52+.14*load)*(.48+.52*Math.sqrt(revs));
  // Equal-power fading keeps part throttle from falling into a volume hole.
  return {gains:[Math.sin(load*Math.PI/2)*level,Math.cos(load*Math.PI/2)*level],
    rates:[Math.max(.12,rpm/5570),Math.max(.12,rpm/5581)],
    cutoff:bonnet?1900+load*700:4000+load*1700};
}

export class DrivingAudio {
  constructor(){this.context=null;this.enabled=false;this.ready=false;this.loading=null;this.previousGear=1;this.shiftUntil=0;this.layers=[];this.lastImpact=0;this.rpm=850;this.lastPopCount=0;this.load=0;}
  async enable(value){
    this.enabled=value;
    if(!value){if(this.master)this.master.gain.setTargetAtTime(0,this.context.currentTime,.06);return;}
    try{
      if(!this.loading)this.loading=this.init().catch(async error=>{
        this.ready=false;const context=this.context;
        this.context=null;this.master=null;this.layers=[];
        try{if(context&&context.state!=='closed')await context.close();}catch{}
        this.loading=null;throw error;
      });
      await this.loading;
      if(this.enabled&&this.context.state==='suspended')await this.context.resume();
    }catch(error){this.enabled=false;throw error;}
  }
  async init(){
    this.context=new AudioContext();await this.context.resume();const ctx=this.context;
    this.master=ctx.createGain();this.master.gain.value=0;
    const compressor=ctx.createDynamicsCompressor();compressor.threshold.value=-12;compressor.knee.value=9;compressor.ratio.value=3;compressor.attack.value=.006;compressor.release.value=.18;this.master.connect(compressor);compressor.connect(ctx.destination);
    const engineBody=ctx.createBiquadFilter();engineBody.type='lowshelf';engineBody.frequency.value=140;engineBody.gain.value=2.5;
    const engineRumble=ctx.createBiquadFilter();engineRumble.type='highpass';engineRumble.frequency.value=25;engineRumble.Q.value=.5;
    engineBody.connect(engineRumble);engineRumble.connect(this.master);
    const paths=['v8-acceleration.wav','v8-deceleration.wav','tyres.ogg','wind.ogg'];
    const buffers=await Promise.all(paths.map(async name=>{const response=await fetch('./assets/audio/'+name);if(!response.ok)throw new Error('Audio could not load: '+name);return ctx.decodeAudioData(await response.arrayBuffer());}));
    buffers.forEach((original,i)=>{
      const loop=i<2?engineLoop(original):null;
      // Shorter ambience loops keep the decoded memory budget modest.
      const duration=i===3?14:i===2?5:original.duration,start=i===3?8:i===2?2:0;
      const frames=loop?loop.end:Math.min(Math.floor(duration*original.sampleRate),original.length-Math.floor(start*original.sampleRate));
      const buffer=ctx.createBuffer(original.numberOfChannels,frames,original.sampleRate);
      for(let ch=0;ch<buffer.numberOfChannels;ch++){
        if(loop){buffer.getChannelData(ch).set(loop.channels[ch]);continue;}
        const out=buffer.getChannelData(ch);out.set(original.getChannelData(ch).subarray(Math.floor(start*original.sampleRate),Math.floor(start*original.sampleRate)+frames));
        // Crossfade the seam rather than repeatedly clicking at a hard splice.
        const fade=Math.min(Math.floor(original.sampleRate*.04),Math.floor(frames*.08));
        for(let j=0;j<fade;j++){const u=j/fade;out[j]=out[j]*u+out[frames-fade+j]*(1-u);}
      }
      const source=ctx.createBufferSource();source.buffer=buffer;source.loop=true;
      // Skip the tail already blended into the loop head, avoiding a repeated seam.
      source.loopEnd=(loop?frames:frames-Math.min(Math.floor(original.sampleRate*.04),Math.floor(frames*.08)))/original.sampleRate;
      const gain=ctx.createGain();gain.gain.value=0;const filter=ctx.createBiquadFilter();filter.type=i===3?'lowpass':i===2?'bandpass':'lowpass';filter.frequency.value=i===3?1000:i===2?650:2400;filter.Q.value=i===2?.55:.7;
      const trim=i<2?recordingGain(buffer):1;
      source.connect(filter);filter.connect(gain);gain.connect(i<2?engineBody:this.master);source.start();this.layers.push({source,gain,filter,trim});
    });
    this.ready=true;
  }
  update({speed,slip,throttle,brake,rpm,gear,popCount,popStrength,exhaustPop,impact,offroad,collision,active,bonnet},dt){
    if(!this.ready)return;
    const ctx=this.context,now=ctx.currentTime;this.master.gain.setTargetAtTime(this.enabled&&active?.65*(this.volume??.75):0,now,.08);
    if(gear!==this.previousGear){this.previousGear=gear;this.shiftUntil=now+.20;}
    this.rpm=rpm;
    if(popCount!==this.lastPopCount){if(active&&this.enabled&&popCount>this.lastPopCount)this.exhaustPop(popStrength||exhaustPop||.25,bonnet);this.lastPopCount=popCount;}
    const targetLoad=brake?0:throttle;
    this.load+=(targetLoad-this.load)*(1-Math.exp(-Math.max(0,dt)/(targetLoad>this.load?.09:.15)));
    const mix=engineMix(this.rpm,this.load,bonnet),shift=now<this.shiftUntil?.88:1;
    for(let i=0;i<2;i++){
      const layer=this.layers[i];
      layer.source.playbackRate.setTargetAtTime(mix.rates[i],now,.045);
      layer.gain.gain.setTargetAtTime(mix.gains[i]*layer.trim*shift,now,.045);
      layer.filter.frequency.setTargetAtTime(mix.cutoff,now,.12);
    }
    const skid=Math.min(.045,Math.max(0,slip-.09)*.19)*Math.min(1,speed/12);this.layers[2].gain.gain.setTargetAtTime(skid,now,.06);this.layers[2].source.playbackRate.setTargetAtTime(.62+Math.min(.1,speed*.002),now,.1);
    const wind=Math.min(.13,(speed/50)**2*.1)+(offroad&&speed>2?.09:0);this.layers[3].gain.gain.setTargetAtTime(wind*(bonnet?.65:1),now,.2);this.layers[3].filter.frequency.setTargetAtTime(400+speed*33,now,.15);
    if(active&&this.enabled&&collision>.7&&now-this.lastImpact>1&&speed>1){this.lastImpact=now;this.impact(impact||.1);}
  }
  exhaustPop(strength,bonnet){
    const ctx=this.context,now=ctx.currentTime,duration=.28,pitch=.94+Math.random()*.12;
    const buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*duration),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++){
      const t=i/ctx.sampleRate,attack=1-Math.exp(-t*2200);
      const crack=(Math.random()*2-1)*Math.exp(-t*80)*.65;
      const body=Math.sin(2*Math.PI*pitch*(115*t-240*t*t))*Math.exp(-t*27)*.5;
      const tail=Math.sin(2*Math.PI*72*pitch*t)*Math.exp(-t*22)*.22;
      data[i]=(crack+body+tail)*attack;
    }
    const source=ctx.createBufferSource();source.buffer=buffer;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=bonnet?1150:2600;filter.Q.value=.5;
    const gain=ctx.createGain();gain.gain.value=clamp(strength,.15,.55)*(bonnet?.42:.9);source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start(now);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  impact(strength){
    const ctx=this.context,now=ctx.currentTime,buffer=ctx.createBuffer(1,Math.floor(ctx.sampleRate*.3),ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.exp(-i/ctx.sampleRate*22);
    const source=ctx.createBufferSource();source.buffer=buffer;const filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1000;const gain=ctx.createGain();gain.gain.value=.3*strength;source.connect(filter);filter.connect(gain);gain.connect(this.master);source.start(now);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  startTone(go){
    if(!this.enabled||!this.context||this.context.state!=='running')return;
    const ctx=this.context,now=ctx.currentTime,tone=ctx.createOscillator(),gain=ctx.createGain(),duration=go?.4:.12;
    tone.frequency.value=go?880:440;gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.12*(this.volume??.75)+.0001,now+.01);gain.gain.exponentialRampToValueAtTime(.0001,now+duration);
    tone.connect(gain);gain.connect(ctx.destination);tone.start(now);tone.stop(now+duration);tone.onended=()=>{tone.disconnect();gain.disconnect();};
  }
  status(){return {enabled:this.enabled,ready:this.ready,context:this.context?.state||'not-created',layers:this.layers.length,rpm:this.rpm,gear:this.previousGear,rates:this.layers.map(l=>l.source.playbackRate.value),gains:this.layers.map(l=>l.gain.gain.value)};}
}
