import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/vendor/three.module.js';
import {createInstanceCuller} from '../game/spatial.js';

test('forest cells keep crossfade edges and shadow casters while rejecting distant detail',()=>{
  const frustum=(left,right)=>new THREE.Frustum(new THREE.Plane(new THREE.Vector3(1,0,0),-left),new THREE.Plane(new THREE.Vector3(-1,0,0),right),new THREE.Plane(new THREE.Vector3(0,1,0),100),new THREE.Plane(new THREE.Vector3(0,-1,0),100),new THREE.Plane(new THREE.Vector3(0,0,1),100),new THREE.Plane(new THREE.Vector3(0,0,-1),100));
  const viewer=new THREE.Vector3(),distance=new THREE.Vector2(30,60),matrix=new THREE.Matrix4();
  const build=far=>{
    const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(12,12,12),new THREE.MeshBasicMaterial(),5);mesh.castShadow=true;
    [0,30,60,90,150].forEach((x,i)=>mesh.setMatrixAt(i,matrix.makeTranslation(x,0,0)));
    return {mesh,culler:createInstanceCuller(mesh,20,{viewer,distance,far})};
  };
  const near=build(false),far=build(true),camera=frustum(-15,45),shadow=frustum(50,160);
  const positions=mesh=>Array.from({length:mesh.count},(_,i)=>mesh.instanceMatrix.array[i*16+12]).sort((a,b)=>a-b);
  near.culler.update(camera,shadow);far.culler.update(camera,shadow);
  assert.deepEqual(positions(near.mesh),[0,30,60],'a crown crossing the near limit still renders, including its offscreen shadow');
  assert.deepEqual(positions(far.mesh),[30,60,90,150],'a crown crossing the far fade-in limit still renders');
  assert.equal(near.culler.shadowCount,1);
  assert.equal(near.mesh.instanceMatrix.array[12],60,'shadow-only cells remain in the shadow prefix');
  assert.equal(near.culler.update(camera,shadow),false,'stationary view reuses its instance buffer');
  viewer.x=150;
  assert.equal(near.culler.update(camera,shadow),true,'moving the viewer updates distance visibility');
  assert.deepEqual(positions(near.mesh),[90,150]);
  far.culler.update(camera,shadow);
  assert.deepEqual(positions(far.mesh),[0,30,60,90],'distant cells change with the viewer too');
  distance.y=120;near.culler.update(camera,shadow);
  assert.deepEqual(positions(near.mesh),[30,60,90,150],'increasing quality restores the newly visible cells');
  distance.x=80;far.culler.update(camera,shadow);
  assert.deepEqual(positions(far.mesh),[0,30,60],'increasing quality delays the distant representation');
});
