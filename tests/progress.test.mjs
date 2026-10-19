import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgress} from '../game/progress.js';

test('best-run data stays available within the current page session',()=>{
  const progress=createProgress();assert.equal(progress.getItem('best'),null);
  progress.setItem('best','first run');progress.setItem('best','faster run');
  assert.equal(progress.getItem('best'),'faster run');
});

test('new page sessions do not restore old progress',()=>{
  const progress=createProgress();progress.setItem('best','run');
  assert.equal(createProgress().getItem('best'),null);
});

test('progress works without accessing browser storage',()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let accesses=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){accesses++;throw Error('Browser storage must not be accessed');}});
  try{
    const progress=createProgress();progress.setItem('best','run');
    assert.equal(progress.getItem('best'),'run');assert.equal(accesses,0);
  }finally{
    if(previous)Object.defineProperty(globalThis,'localStorage',previous);else delete globalThis.localStorage;
  }
});
