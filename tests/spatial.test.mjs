import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/vendor/three.module.js';
import {partitionGeometry,batchGeometries,createInstanceCuller} from '../game/spatial.js';

test('terrain partitions retain every triangle, normal and texture coordinate with tight bounds',()=>{
  const geometry=new THREE.PlaneGeometry(800,800,80,80).rotateX(-Math.PI/2);
  const position=geometry.attributes.position;
  for(let i=0;i<position.count;i++)position.setY(i,Math.sin(position.getX(i)/80)*15);
  geometry.computeVertexNormals();
  const parts=partitionGeometry(geometry,100),actual=[];
  assert.ok(parts.length>=64);
  for(const part of parts){
    assert.equal(part.attributes.position,position);
    assert.equal(part.attributes.normal,geometry.attributes.normal);
    assert.equal(part.attributes.uv,geometry.attributes.uv);
    assert.ok(part.boundingBox.max.x-part.boundingBox.min.x<=120);
    for(let i=0;i<part.index.count;i+=3){actual.push(Array.from(part.index.array.slice(i,i+3)).join(','));}
    for(const index of part.index.array){
      const vertex=new THREE.Vector3().fromBufferAttribute(position,index);
      assert.ok(part.boundingBox.containsPoint(vertex));
      assert.ok(part.boundingSphere.containsPoint(vertex));
    }
  }
  const expected=[];
  for(let i=0;i<geometry.index.count;i+=3)expected.push(Array.from(geometry.index.array.slice(i,i+3)).join(','));
  assert.deepEqual(actual.sort(),expected.sort(),'no triangle lost, duplicated or rewound');
  const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().makeOrthographic(-60,60,60,-60,1,100));
  assert.ok(parts.some(part=>!frustum.intersectsSphere(part.boundingSphere)),'offscreen partitions can be culled');
});

test('batched terrain retains exact vertex attributes and independent culling bounds',()=>{
  const source=new THREE.PlaneGeometry(800,800,80,80).rotateX(-Math.PI/2);
  const parts=partitionGeometry(source,100),batch=batchGeometries(parts,new THREE.MeshStandardMaterial());
  assert.equal(batch.instanceCount,parts.length);assert.ok(batch.perObjectFrustumCulled);
  assert.equal(batch.geometry.index.count,source.index.count);
  assert.ok(batch.geometry.attributes.position.count<source.attributes.position.count*2,'shared vertices are packed per tile, not copied as a whole landscape');
  let cursor=0;
  for(const part of parts)for(const sourceIndex of part.index.array){
    const batchIndex=batch.geometry.index.array[cursor++];
    for(const name of Object.keys(source.attributes)){
      const original=source.attributes[name],packed=batch.geometry.attributes[name];
      for(let component=0;component<original.itemSize;component++)assert.equal(packed.array[batchIndex*packed.itemSize+component],original.array[sourceIndex*original.itemSize+component]);
    }
  }
});

test('static instance culling preserves transforms, colours and offscreen shadow casters',()=>{
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(2,12,3),new THREE.MeshStandardMaterial(),60);
  mesh.castShadow=mesh.receiveShadow=true;mesh.customDepthMaterial=new THREE.MeshDepthMaterial();
  const transform=new THREE.Matrix4(),colour=new THREE.Color();
  for(let i=0;i<mesh.count;i++){
    transform.makeRotationY(i*.1);transform.setPosition(i*12,10,i%7*70);mesh.setMatrixAt(i,transform);
    colour.setRGB(i/60,.5,1);mesh.setColorAt(i,colour);
  }
  const expected=[];
  for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,transform);mesh.getColorAt(i,colour);expected.push([...transform.elements,...colour.toArray()].join(','));}

  const frustum=(left,right)=>new THREE.Frustum(new THREE.Plane(new THREE.Vector3(1,0,0),-left),new THREE.Plane(new THREE.Vector3(-1,0,0),right),new THREE.Plane(new THREE.Vector3(0,1,0),100),new THREE.Plane(new THREE.Vector3(0,-1,0),100),new THREE.Plane(new THREE.Vector3(0,0,1),1000),new THREE.Plane(new THREE.Vector3(0,0,-1),1000));
  const culler=createInstanceCuller(mesh,20),camera=frustum(-10,70),shadow=frustum(580,680);
  assert.ok(culler.update(camera,shadow));assert.ok(mesh.count<25&&mesh.count>10);
  const retained=[];for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,transform);retained.push(transform.elements[12]);}
  assert.ok(retained.includes(24),'camera-visible instance retained');
  assert.ok(retained.includes(612),'offscreen shadow caster retained');
  assert.ok(!retained.includes(300),'instance outside both frusta omitted');
  assert.ok(culler.shadowCount<culler.visibleCount);
  assert.ok(retained.slice(0,culler.shadowCount).includes(612));
  assert.ok(!retained.slice(0,culler.shadowCount).includes(24),'camera-only objects are omitted from the shadow pass');
  assert.equal(culler.update(camera,shadow),false,'unchanged visibility reuses buffers');
  culler.update(frustum(1000,1100),frustum(1000,1100));assert.equal(mesh.count,0,'fully hidden batches submit no instances');
  culler.update(frustum(-1000,1000),shadow);assert.equal(mesh.count,60);
  const restored=[];for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,transform);mesh.getColorAt(i,colour);restored.push([...transform.elements,...colour.toArray()].join(','));}
  assert.deepEqual(restored.toSorted(),expected.toSorted());
});
