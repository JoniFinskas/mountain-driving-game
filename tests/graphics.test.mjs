import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveResolution,graphicsPixelRatio,graphicsPresets} from '../game/graphics.js';

const feed=(controller,ms,seconds)=>{for(let t=0;t<seconds*1000;t+=ms)controller.sample(ms);};

test('automatic resolution responds to sustained low frame rates and remains bounded',()=>{
  const controller=createAdaptiveResolution();
  feed(controller,1000/40,7);assert.ok(controller.scale<.85);
  feed(controller,1000/15,60);assert.equal(controller.scale,.55);
  feed(controller,1000/100,90);assert.equal(controller.scale,1);
});

test('60 fps and isolated stalls do not cause resolution oscillation',()=>{
  const controller=createAdaptiveResolution();
  for(let i=0;i<1800;i++)controller.sample(i%100===0?120:1000/60);
  assert.equal(controller.scale,.85);
  for(const value of [NaN,Infinity,-1,0,10000])assert.equal(controller.sample(value),null);
  assert.equal(controller.scale,.85);
});

test('automatic resolution corrects sustained frame rates just below 60 fps',()=>{
  for(const fps of [55,57,59]){
    const controller=createAdaptiveResolution(),initial=controller.scale;
    feed(controller,1000/fps,2.2);
    assert.ok(controller.scale<initial,`${fps} fps must reduce resolution`);
  }
});

test('automatic resolution preserves headroom before increasing picture quality',()=>{
  const controller=createAdaptiveResolution(),initial=controller.scale;
  feed(controller,1000/75,20);
  assert.equal(controller.scale,initial);
  feed(controller,1000/100,10);
  assert.ok(controller.scale>initial);
});

test('paused frames are excluded and automatic selection can restart at its default',()=>{
  const controller=createAdaptiveResolution();feed(controller,40,7);
  const scale=controller.scale;
  for(let i=0;i<100;i++)controller.sample(100,false);
  assert.equal(controller.scale,scale);
  feed(controller,10,2);assert.equal(controller.scale,scale);
  controller.reset(true);assert.equal(controller.scale,.85);
});

test('automatic graphics cap 4K and high-density rendering while preserving manual presets',()=>{
  const ratio=graphicsPixelRatio('auto',3840,2160,2,1);
  assert.equal(ratio,.5);assert.equal(3840*2160*ratio*ratio,1920*1080);
  assert.equal(graphicsPixelRatio('auto',1920,1080,2,.75),.75);
  assert.equal(graphicsPixelRatio('auto',1280,720,.8,1),.8);
  assert.equal(graphicsPixelRatio('performance',3840,2160,2),.75);
  assert.equal(graphicsPixelRatio('balanced',1920,1080,2),1);
  assert.equal(graphicsPixelRatio('high',1920,1080,2),1.6);
  assert.equal(graphicsPresets.auto.shadow,512);
});
