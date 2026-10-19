export const graphicsPresets=Object.freeze({
  auto:{scale:1,detail:70,shadow:512,groundFiltering:2},
  performance:{scale:.75,detail:70,shadow:512,groundFiltering:2},
  balanced:{scale:1,detail:100,shadow:1024,groundFiltering:8},
  high:{scale:1.6,detail:230,shadow:2048,groundFiltering:8},
});

export function graphicsPixelRatio(mode,width,height,dpr,automaticScale=.85){
  const preset=graphicsPresets[mode]||graphicsPresets.auto;
  const density=Math.max(.1,Number.isFinite(dpr)?dpr:1);
  if(mode!=='auto')return Math.min(density,preset.scale);
  // Keep large and high-density displays within a 1080p rendering budget.
  const budget=Math.sqrt(1920*1080/Math.max(1,width*height));
  return Math.min(density,1,budget)*automaticScale;
}

export function createAdaptiveResolution(){
  let scale=.85,warmup=1000,elapsed=0,samples=[],fastWindows=0;
  function reset(resetScale=false){
    if(resetScale)scale=.85;
    warmup=1000;elapsed=0;samples=[];fastWindows=0;
  }
  return {
    get scale(){return scale;},reset,
    sample(milliseconds,active=true){
      if(!active){reset();return null;}
      if(!Number.isFinite(milliseconds)||milliseconds<=0||milliseconds>250)return null;
      if(warmup>0){warmup-=milliseconds;return null;}
      samples.push(milliseconds);elapsed+=milliseconds;
      if(elapsed<1000||samples.length<30)return null;
      // Isolated loading or collection stalls should not permanently lower quality.
      const sorted=samples.sort((a,b)=>a-b),trim=Math.floor(sorted.length*.1),steady=sorted.slice(trim,sorted.length-trim);
      const mean=steady.reduce((sum,value)=>sum+value,0)/steady.length;
      let next=scale;
      // Respond below 60 fps; keep spare capacity before raising resolution.
      if(mean>16.8){next=Math.max(.55,Math.round(scale*.9*20)/20);fastWindows=0;}
      else if(mean<12){if(++fastWindows>=6){next=Math.min(1,Math.round((scale+.05)*20)/20);fastWindows=0;}}
      else fastWindows=0;
      elapsed=0;samples=[];
      if(next===scale)return null;
      warmup=next<scale?500:1000;scale=next;return scale;
    },
  };
}
