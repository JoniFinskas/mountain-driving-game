import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/vendor/three.module.js';
import {splitTerrainSurface} from '../game/terrain-surface.js';

test('terrain specialization only selects materials whose blend is constant over the whole triangle',()=>{
  const flat=new THREE.PlaneGeometry(10,10,2,2).rotateX(-Math.PI/2);
  assert.equal(splitTerrainSurface(flat).grass.index.count,flat.index.count);
  const high=flat.clone().translate(0,400,0);
  assert.equal(splitTerrainSurface(high).mixed.index.count,high.index.count,'altitude still blends rock into flat high ground');
  const cliff=flat.clone().rotateZ(1.1);
  assert.equal(splitTerrainSurface(cliff).rock.index.count,cliff.index.count);
  const slope=flat.clone().rotateZ(.6);
  assert.equal(splitTerrainSurface(slope).mixed.index.count,slope.index.count);
  const saddle=new THREE.BufferGeometry();
  saddle.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,0,1],3));
  saddle.setAttribute('normal',new THREE.Float32BufferAttribute([.8,.6,0,-.8,.6,0,0,.6,.8],3));saddle.setIndex([0,1,2]);
  assert.equal(splitTerrainSurface(saddle).mixed.index.count,3,'opposing normals can interpolate into upward-facing grass');
});
