import * as THREE from './vendor/three.module.js';

// Keep the original vertex buffers and winding. Only the index lists and bounds
// change, so the camera and shadow frusta can reject distant parts independently.
export function partitionGeometry(geometry,cellSize){
  const position=geometry.attributes.position,index=geometry.index.array,cells=new Map();
  for(let i=0;i<index.length;i+=3){
    const a=index[i],b=index[i+1],c=index[i+2];
    const x=(position.getX(a)+position.getX(b)+position.getX(c))/3;
    const z=(position.getZ(a)+position.getZ(b)+position.getZ(c))/3;
    const key=Math.floor(x/cellSize)+','+Math.floor(z/cellSize);
    let cell=cells.get(key);if(!cell){cell=[];cells.set(key,cell);}cell.push(a,b,c);
  }
  const vertex=new THREE.Vector3();
  return [...cells.values()].map(indices=>{
    const part=new THREE.BufferGeometry();
    for(const [name,attribute] of Object.entries(geometry.attributes))part.setAttribute(name,attribute);
    part.setIndex(indices);
    // computeBoundingBox would include the entire shared vertex buffer.
    part.boundingBox=new THREE.Box3();
    for(const i of indices)part.boundingBox.expandByPoint(vertex.fromBufferAttribute(position,i));
    part.boundingSphere=part.boundingBox.getBoundingSphere(new THREE.Sphere());
    part.boundingSphere.radius+=1e-6;
    return part;
  });
}

export function batchGeometries(geometries,material){
  const compact=geometries.map(source=>{
    const ids=new Map(),vertices=[],indices=[];
    for(const index of source.index.array){
      if(!ids.has(index)){ids.set(index,vertices.length);vertices.push(index);}indices.push(ids.get(index));
    }
    const geometry=new THREE.BufferGeometry();geometry.setIndex(indices);
    for(const [name,attribute] of Object.entries(source.attributes)){
      const values=new attribute.array.constructor(vertices.length*attribute.itemSize);
      vertices.forEach((index,i)=>{
        for(let j=0;j<attribute.itemSize;j++)values[i*attribute.itemSize+j]=attribute.array[index*attribute.itemSize+j];
      });
      geometry.setAttribute(name,new THREE.BufferAttribute(values,attribute.itemSize,attribute.normalized));
    }
    geometry.boundingBox=source.boundingBox?.clone()||null;
    geometry.boundingSphere=source.boundingSphere?.clone()||null;
    return geometry;
  });
  const vertices=compact.reduce((sum,g)=>sum+g.attributes.position.count,0),indices=compact.reduce((sum,g)=>sum+g.index.count,0);
  const batch=new THREE.BatchedMesh(compact.length,vertices,indices,material);
  for(const geometry of compact){batch.addInstance(batch.addGeometry(geometry));geometry.dispose();}
  return batch;
}

// Cull static instance groups while retaining one hardware-instanced draw.
// The shadow frustum is included so offscreen trees still cast their shadows.
export function createInstanceCuller(mesh,cellSize=100,range=null){
  mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.geometry.computeBoundingSphere();
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  const matrices=mesh.instanceMatrix.array.slice(),colours=mesh.instanceColor?.array.slice();
  const count=mesh.count,cells=new Map(),matrix=new THREE.Matrix4(),sphere=new THREE.Sphere();
  for(let i=0;i<count;i++){
    matrix.fromArray(matrices,i*16);
    const key=Math.floor(matrix.elements[12]/cellSize)+','+Math.floor(matrix.elements[14]/cellSize);
    let cell=cells.get(key);if(!cell){cell={box:new THREE.Box3(),visibility:3,indices:[]};cells.set(key,cell);}
    sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(matrix);
    cell.box.union(sphere.getBoundingBox(new THREE.Box3()));cell.indices.push(i);
  }
  for(const cell of cells.values()){
    cell.sphere=cell.box.getBoundingSphere(new THREE.Sphere());cell.sphere.radius+=1e-6;
    cell.matrices=new Float32Array(cell.indices.length*16);cell.colours=colours?new Float32Array(cell.indices.length*3):null;
    cell.indices.forEach((index,i)=>{cell.matrices.set(matrices.subarray(index*16,index*16+16),i*16);if(colours)cell.colours.set(colours.subarray(index*3,index*3+3),i*3);});
  }
  return {visibleCount:count,shadowCount:count,update(cameraFrustum,shadowFrustum){
    let changed=false;
    for(const cell of cells.values()){
      let inRange=true;
      if(range){
        const {viewer,distance,far}=range,box=cell.box;
        // Bounds include the complete geometry, not just tree origins. Keep a
        // cell whenever any of it can contribute to the distance crossfade.
        const dx=far?Math.max(Math.abs(viewer.x-box.min.x),Math.abs(viewer.x-box.max.x)):Math.max(box.min.x-viewer.x,0,viewer.x-box.max.x);
        const dz=far?Math.max(Math.abs(viewer.z-box.min.z),Math.abs(viewer.z-box.max.z)):Math.max(box.min.z-viewer.z,0,viewer.z-box.max.z);
        inRange=far?dx*dx+dz*dz>distance.x*distance.x:dx*dx+dz*dz<distance.y*distance.y;
      }
      const visibility=inRange?((cameraFrustum.intersectsSphere(cell.sphere)?1:0)|(mesh.castShadow&&shadowFrustum.intersectsSphere(cell.sphere)?2:0)):0;
      if(visibility!==cell.visibility){changed=true;cell.visibility=visibility;}
    }
    if(!changed)return false;
    let target=0;
    // Shadow casters form a contiguous prefix. The shadow pass can select just
    // that prefix without rebuilding or uploading a second instance buffer.
    for(const shadowPass of [true,false]){
      for(const cell of cells.values())if(shadowPass?cell.visibility&2:cell.visibility===1){
        mesh.instanceMatrix.array.set(cell.matrices,target*16);
        if(colours)mesh.instanceColor.array.set(cell.colours,target*3);target+=cell.indices.length;
      }
      if(shadowPass)this.shadowCount=target;
    }
    this.visibleCount=mesh.count=target;
    if(target){
      mesh.instanceMatrix.clearUpdateRanges();mesh.instanceMatrix.addUpdateRange(0,target*16);mesh.instanceMatrix.needsUpdate=true;
      if(colours){mesh.instanceColor.clearUpdateRanges();mesh.instanceColor.addUpdateRange(0,target*3);mesh.instanceColor.needsUpdate=true;}
    }
    return true;
  }};
}
