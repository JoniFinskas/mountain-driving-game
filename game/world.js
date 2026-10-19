import * as THREE from 'three';
import {HDRLoader} from './vendor/HDRLoader.js';
import {frames,count,length,sample,nearest,ribbon,routeBounds,nearRouteBounds} from './road.js';
import {coastX,coastElevation,coastalShelfRise} from './geography.js';
export {coastX} from './geography.js';
import {partitionGeometry,batchGeometries,createInstanceCuller} from './spatial.js';
import {activeMap} from './maps.js';
import {adaptiveTerrain} from './terrain-geometry.js';
import {splitTerrainSurface} from './terrain-surface.js';
let groundMap,cliffMap,groundNormal,cliffNormal,foliageMap,foliageAlpha,foliageNormal,barkMap,barkNormal,terrainSurfaceMaterial;
export async function loadLandscapeAssets(){
  const loader=new THREE.TextureLoader();
  const [hdr,grass,rock,normal,rockNormal]=await Promise.all([new HDRLoader().loadAsync('./assets/alps_field_2k.hdr'),loader.loadAsync('./assets/aerial_grass_rock_diff_2k.jpg'),loader.loadAsync('./assets/rock_face_03_diff_2k.jpg'),loader.loadAsync('./assets/aerial_grass_rock_nor_gl_1k.jpg'),loader.loadAsync('./assets/rock_face_03_nor_gl_1k.jpg')]);
  for(const t of [grass,rock,normal,rockNormal]){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=8;}
  grass.colorSpace=rock.colorSpace=THREE.SRGBColorSpace;
  groundMap=grass;cliffMap=rock;groundNormal=normal;cliffNormal=rockNormal;
  [foliageMap,foliageAlpha,foliageNormal,barkMap,barkNormal]=await Promise.all(['twig_diff_1k.jpg','twig_alpha_1k.png','twig_nor_gl_1k.jpg','bark_diff_1k.jpg','bark_nor_gl_1k.jpg'].map(name=>loader.loadAsync('./assets/pine_tree_01_'+name)));
  foliageMap.colorSpace=barkMap.colorSpace=THREE.SRGBColorSpace;
  for(const t of [foliageMap,foliageAlpha,foliageNormal,barkMap,barkNormal]){t.anisotropy=8;}
  barkMap.wrapS=barkMap.wrapT=barkNormal.wrapS=barkNormal.wrapT=THREE.RepeatWrapping;barkMap.repeat.set(1,2);barkNormal.repeat.set(1,2);
  hdr.mapping=THREE.EquirectangularReflectionMapping;return hdr;
}
let seed=1745;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const smooth=t=>t*t*(3-2*t),mix=THREE.MathUtils.lerp,clamp=THREE.MathUtils.clamp;
function hash(x,y){let n=Math.imul(x,374761393)+Math.imul(y,668265263);n=Math.imul(n^(n>>>13),1274126177);return ((n^(n>>>16))>>>0)/4294967295;}
export function noise(x,z){const ix=Math.floor(x),iz=Math.floor(z),u=smooth(x-ix),v=smooth(z-iz);return mix(mix(hash(ix,iz),hash(ix+1,iz),u),mix(hash(ix,iz+1),hash(ix+1,iz+1),u),v);}
function fbm(x,z){return noise(x,z)*.52+noise(x*2.03,z*2.03)*.26+noise(x*4.13,z*4.13)*.14+noise(x*8.21,z*8.21)*.08;}
const peaks=[[690,-140,530,470],[1350,690,940,620],[740,-1300,700,510],[1800,-1000,1130,700],[1050,1900,930,720]];
export function naturalHeight(x,z){
  if(activeMap.kind==='circuit')return 626.84+(fbm(x*.002,z*.002)-.5)*45;
  const inland=x-coastX(z),coastalHeight=activeMap.kind==='classic'?132+clamp((z+500)*.083,-35,105)+noise(z*.009,0)*12:coastElevation(z)+20+coastalShelfRise(z,inland)+noise(z*.009,0)*4;
  if(inland<-55)return -22+noise(x*.04,z*.04)*7;
  const cliff=smooth(clamp((inland+47)/65,0,1));
  let h=-20+cliff*coastalHeight;
  const ridge=1-Math.abs(fbm(x*.004+noise(z*.003,0),z*.004)*2-1);
  const mountain=smooth(clamp(activeMap.kind==='classic'?inland/470:(inland-350)/850,0,1));
  h+=mountain*(60+ridge*ridge*160+(fbm(x*.012,z*.012)-.5)*58);
  for(const [px,pz,high,spread] of peaks){
    const d=((x-px)**2+(z-pz)**2)/(spread*spread);h+=mountain*high*Math.exp(-d*1.65);
  }
  h+=(fbm(x*.055,z*.055)-.5)*14*cliff;
  h+=Math.sin(z*.10+x*.035)*2.4*cliff*(1-cliff);
  return h;
}
export function terrainHeight(x,z,hint,knownRoad){
  let h=naturalHeight(x,z);
  if(nearRouteBounds(x,z)){
    const p=knownRoad===undefined?nearest(x,z,hint):knownRoad;
    if(p){const edge=activeMap.kind==='circuit'?p.railOffset+3:p.width/2+.75,reach=activeMap.kind==='circuit'?40:activeMap.kind==='classic'?p.width<6.3?14:30:x<p.x?8:p.width<6.3?14:30;
      if(p.distance<edge+reach){const t=smooth(clamp((p.distance-edge)/reach,0,1));h=mix(p.y-.16,h,t);
        if(p.width<6.3&&x>p.x){
          const d=p.distance-edge;
          const rise=(5+noise(p.s*.04,3)*4)*smooth(clamp((d-.5)/4.0,0,1))*(1-smooth(clamp((d-9)/32,0,1)));
          h=Math.max(h,p.y-.16+rise);
        }
      }
    }
  }
  return h;
}
function terrain(scene,bounds,spacing,exclude=null){
  const width=bounds.maxX-bounds.minX,depth=bounds.maxZ-bounds.minZ;
  const samples=new Map();
  const query=(x,z)=>{const key=x+','+z;if(samples.has(key))return samples.get(key);const road=nearRouteBounds(x,z,110)?nearest(x,z):null;const result={height:terrainHeight(x,z,undefined,road),clearance:road?road.distance-road.railOffset:1e6};samples.set(key,result);return result;};
  let g;
  if(spacing===4){
    const roadCells=new Set();
    for(const p of frames)for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
      const ix=Math.floor((p.x-bounds.minX)/128)+dx,iz=Math.floor((p.z-bounds.minZ)/128)+dz,x=bounds.minX+ix*128,z=bounds.minZ+iz*128;
      if(Math.hypot(Math.max(x-p.x,0,p.x-x-128),Math.max(z-p.z,0,p.z-z-128))<42)roadCells.add(ix+','+iz);
    }
    g=adaptiveTerrain(bounds,(x,z)=>query(x,z).height,(x0,z0,x1,z1)=>roadCells.has(Math.round((x0-bounds.minX)/128)+','+Math.round((z0-bounds.minZ)/128))||(activeMap.kind!=='circuit'&&coastX((z0+z1)/2)>x0-50&&coastX((z0+z1)/2)<x1+50),{skip:(x0,z0,x1,z1)=>activeMap.kind!=='circuit'&&x1<Math.min(coastX(z0),coastX((z0+z1)/2),coastX(z1))-60});
  }else{
    g=new THREE.PlaneGeometry(width,depth,Math.ceil(width/spacing),Math.ceil(depth/spacing));g.rotateX(-Math.PI/2);g.translate((bounds.minX+bounds.maxX)/2,0,(bounds.minZ+bounds.maxZ)/2);
    const p=g.attributes.position;for(let i=0;i<p.count;i++)p.setY(i,query(p.getX(i),p.getZ(i)).height);g.computeVertexNormals();
  }
  const p=g.attributes.position,clearance=new Float32Array(p.count);
  for(let i=0;i<p.count;i++)clearance[i]=query(p.getX(i),p.getZ(i)).clearance;
  const old=g.index.array,indices=[];
  for(let i=0;i<old.length;i+=3){const a=old[i],b=old[i+1],c=old[i+2];
    if(activeMap.kind!=='circuit'&&p.getY(a)<-10&&p.getY(b)<-10&&p.getY(c)<-10)continue;
    if(Math.min(clearance[a],clearance[b],clearance[c])<3.5)continue;
    if(exclude&&[a,b,c].every(j=>p.getX(j)>exclude.minX&&p.getX(j)<exclude.maxX&&p.getZ(j)>exclude.minZ&&p.getZ(j)<exclude.maxZ))continue;
    indices.push(a,b,c);
  }
  g.setIndex(indices);
  const mat=new THREE.MeshStandardMaterial({map:groundMap,roughness:.94});
  mat.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{cliffTexture:{value:cliffMap},rockNormal:{value:cliffNormal},grassNormal:{value:groundNormal}});
    shader.vertexShader='varying vec3 vTerrainWorld;varying vec3 vTerrainNormal;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvTerrainWorld=(modelMatrix*vec4(transformed,1.)).xyz;vTerrainNormal=normalize(mat3(modelMatrix)*objectNormal);');
    shader.fragmentShader=`uniform sampler2D cliffTexture;uniform sampler2D rockNormal;uniform sampler2D grassNormal;varying vec3 vTerrainWorld;varying vec3 vTerrainNormal;
      vec3 triSample(sampler2D tex,vec3 p,vec3 w,vec3 dx,vec3 dy){return textureGrad(tex,p.zy,dx.zy,dy.zy).rgb*w.x+textureGrad(tex,p.xz,dx.xz,dy.xz).rgb*w.y+textureGrad(tex,p.xy,dx.xy,dy.xy).rgb*w.z;}
    `+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      vec3 tn=normalize(vTerrainNormal),tw=pow(abs(tn),vec3(5.));tw/=tw.x+tw.y+tw.z;
      float rockBlend=smoothstep(.085,.37,1.-tn.y);rockBlend=max(rockBlend,smoothstep(320.,710.,vTerrainWorld.y)*.75);
      vec3 tdx=dFdx(vTerrainWorld),tdy=dFdy(vTerrainWorld),stone=vec3(0.),grass=vec3(0.);
      if(rockBlend>0.){
        stone=triSample(cliffTexture,vTerrainWorld/10.,tw,tdx/10.,tdy/10.);
        vec3 largeStone=triSample(cliffTexture,vTerrainWorld/79.+vec3(.37,.16,.57),tw,tdx/79.,tdy/79.);
        stone=mix(stone,largeStone,.22)*vec3(.88,.87,.82);
        float bedding=sin(vTerrainWorld.y*1.15+sin(vTerrainWorld.x*.11)*1.2+sin(vTerrainWorld.z*.09)*.7);
        stone*=.91+.09*smoothstep(-.6,.8,bedding);
      }
      if(rockBlend<1.){
        grass=textureGrad(map,vTerrainWorld.xz/6.,tdx.xz/6.,tdy.xz/6.).rgb*vec3(.56,.66,.45);
        grass*=.72+textureGrad(map,vTerrainWorld.xz/69.,tdx.xz/69.,tdy.xz/69.).g*.56;
      }
      vec3 surface=mix(grass,stone,rockBlend);
      float snow=smoothstep(1180.,1390.,vTerrainWorld.y)*(1.-smoothstep(.15,.65,1.-tn.y));
      diffuseColor.rgb*=mix(surface,vec3(.77,.81,.82),snow);
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      vec3 rn=vec3(0.),gn=vec3(0.);
      if(rockBlend>0.)rn=triSample(rockNormal,vTerrainWorld/10.,tw,tdx/10.,tdy/10.)*2.-1.;
      if(rockBlend<1.)gn=textureGrad(grassNormal,vTerrainWorld.xz/6.,tdx.xz/6.,tdy.xz/6.).xyz*2.-1.;
      vec3 detail=mix(vec3(gn.x,0.,gn.y)*.24,vec3(rn.x*tw.y+rn.y*tw.z,rn.y*(tw.x+tw.z)*.45,rn.x*tw.x+rn.y*tw.y)*.48,rockBlend);
      normal=normalize(normal+(viewMatrix*vec4(detail,0.)).xyz);
    `);
  };
  if(activeMap.kind==='circuit'){
    const compile=mat.onBeforeCompile;
    mat.onBeforeCompile=shader=>{compile(shader);shader.fragmentShader=shader.fragmentShader.replace('rockBlend=max(rockBlend,smoothstep(320.,710.,vTerrainWorld.y)*.75);','');};
  }
  if(!terrainSurfaceMaterial){
    terrainSurfaceMaterial={mixed:mat};
    for(const kind of ['grass','rock']){
      const variant=mat.clone();variant.customProgramCacheKey=()=>`terrain-${kind}`;
      variant.onBeforeCompile=shader=>{
        mat.onBeforeCompile(shader);
        shader.fragmentShader=shader.fragmentShader.replace(activeMap.kind==='circuit'?'float rockBlend=smoothstep(.085,.37,1.-tn.y);':'float rockBlend=smoothstep(.085,.37,1.-tn.y);rockBlend=max(rockBlend,smoothstep(320.,710.,vTerrainWorld.y)*.75);',`const float rockBlend=${kind==='grass'?'0.':'1.'};`);
      };
      terrainSurfaceMaterial[kind]=variant;
    }
  }else mat.dispose();
  for(const [kind,surface] of Object.entries(splitTerrainSurface(g,activeMap.kind!=='circuit'))){
    const mesh=batchGeometries(partitionGeometry(surface,spacing<=4?160:480),terrainSurfaceMaterial[kind]);
    mesh.receiveShadow=true;mesh.userData.terrain=true;scene.add(mesh);
  }
}
const skyCode=`
vec3 skyColor(vec3 direction){
  float h=max(direction.y,0.);
  vec3 sky=mix(vec3(.45,.62,.72),vec3(.065,.21,.43),pow(h,.42));
  float glow=pow(max(dot(direction,normalize(vec3(-.65,.7,-.3))),0.),14.);
  sky+=vec3(.21,.16,.08)*glow;
  return sky;
}`;
function atmosphere(scene){
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{},vertexShader:'varying vec3 vDirection;void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec3 vDirection;${skyCode}
    void main(){vec3 d=normalize(vDirection);vec3 c=skyColor(d);float sun=pow(max(dot(d,normalize(vec3(-.65,.7,-.3))),0.),12000.);c+=vec3(5.,4.2,2.9)*sun;
    float wisps=sin(d.x*23.+d.z*17.+sin(d.z*36.)*.8)*sin(d.x*35.-d.z*14.);
    float cloud=smoothstep(.55,.92,wisps)*smoothstep(.12,.4,d.y)*(1.-smoothstep(.48,.72,d.y));c=mix(c,vec3(.77,.81,.8),cloud*.14);
    gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`});
  const sky=new THREE.Mesh(new THREE.SphereGeometry(45000,40,24),mat);sky.frustumCulled=false;scene.add(sky);return sky;
}
function sea(scene){
  const mat=new THREE.ShaderMaterial({uniforms:{time:{value:0}},vertexShader:`varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,fragmentShader:`
    varying vec3 world;uniform float time;${skyCode}
    void main(){
      vec3 view=normalize(cameraPosition-world);float distance=length(cameraPosition-world);
      float atten=1./(1.+distance*.00045);
      float pixel=max(length(dFdx(world.xz)),length(dFdy(world.xz)));
      vec2 slope=vec2(0.);
      for(int i=0;i<6;i++){
        float k=.027*pow(1.83,float(i)),angle=float(i)*2.399+.4;
        vec2 dir=vec2(cos(angle),sin(angle));
        float filtered=exp(-k*k*pixel*pixel*.55);
        float amplitude=.038/pow(1.37,float(i));
        slope+=dir*cos(dot(world.xz,dir)*k+time*sqrt(9.81*k)+float(i)*8.7)*amplitude*filtered;
      }
      vec3 n=normalize(vec3(slope.x*atten,1.,slope.y*atten));
      vec3 reflected=reflect(-view,n);float fresnel=.025+.975*pow(1.-max(dot(view,n),0.),5.);
      vec3 color=mix(vec3(.006,.070,.12),skyColor(reflected),fresnel*.72);
      vec3 sun=normalize(vec3(-.65,.7,-.3)),halfway=normalize(sun+view);
      float spec=pow(max(dot(n,halfway),0.),900.);color+=vec3(1.8,1.55,1.07)*spec*atten;
      color+=vec3(.003,.009,.012)*(slope.x+slope.y)*atten;
      float haze=1.-exp(-distance*.00007);color=mix(color,vec3(.48,.63,.70),haze);
      gl_FragColor=vec4(color,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`});
  const mesh=new THREE.Mesh(new THREE.PlaneGeometry(70000,70000),mat);mesh.rotation.x=-Math.PI/2;mesh.position.y=0;scene.add(mesh);
  // Shallow turquoise surf follows the foot of the coast, just above the sea surface.
  const p=[],uv=[],index=[];
  for(let i=0;i<=2000;i++){const z=-4000+i*4,x=coastX(z)-43;for(const d of [-32,0,9]){p.push(x+d,.035,z);uv.push((d+32)/41,z*.08);}if(i<2000){const a=i*3;for(let j=0;j<2;j++)index.push(a+j,a+j+3,a+j+1,a+j+1,a+j+3,a+j+4);}}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);
  const surf=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:mat.uniforms,vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:`varying vec2 vUv;uniform float time;void main(){float fade=sin(vUv.x*3.14159);float wave=sin(vUv.x*35.-time*1.2+sin(vUv.y*.7)*1.8);float foam=smoothstep(.82,1.,wave)*pow(vUv.x,3.);gl_FragColor=vec4(mix(vec3(.055,.37,.35),vec3(.62,.75,.70),foam),fade*(.28+foam*.22));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`});scene.add(new THREE.Mesh(g,surf));return mat;
}
function texture(kind){
  const canvas=document.createElement('canvas'),size=kind==='asphalt'?1024:512;canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d'),img=ctx.createImageData(size,size);
  // Periodic, low-contrast binder variation avoids a quilt of repeated cloudy tiles.
  const periodic=(x,y)=>{
    const ix=Math.floor(x),iy=Math.floor(y),u=smooth(x-ix),v=smooth(y-iy),h=(a,b)=>hash(a%8,b%8);
    return mix(mix(h(ix,iy),h(ix+1,iy),u),mix(h(ix,iy+1),h(ix+1,iy+1),u),v);
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,n=random();
    const v=kind==='asphalt'?78+(n-.5)*30+(periodic(x/size*8,y/size*8)-.5)*4:125+noise(x*.023,y*.023)*28+n*60;
    img.data[i]=v;img.data[i+1]=v;img.data[i+2]=v*.97;img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(canvas);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t;
}
function treeGeometry(){
  // Irregular boughs share a photographed needle texture; each bough uses two cards.
  const p=[],n=[],uv=[],indices=[];
  let branchSeed=3641;const rng=()=>{branchSeed=(Math.imul(branchSeed,1664525)+1013904223)>>>0;return branchSeed/4294967296;};
  for(let i=0;i<48;i++){
    const t=i/47,y=1.5+t*7.7,angle=i*2.399963+(rng()-.5)*.5;
    const reach=(2.9*Math.pow(1-t,.65)+.18)*(.8+rng()*.25);
    const direction=new THREE.Vector3(Math.cos(angle),-.2+rng()*.4+t*.6,Math.sin(angle)).normalize();
    const across=new THREE.Vector3(-Math.sin(angle),0,Math.cos(angle));
    const origin=new THREE.Vector3(0,y+(rng()-.5)*.3,0);
    for(let j=0;j<2;j++){
      const cross=across.clone().applyAxisAngle(direction,j*1.05+.2);
      const base=p.length/3;
      for(const [a,b] of [[0,-1],[1,-1],[1,1],[0,1]]){
        const v=origin.clone().addScaledVector(direction,a*reach).addScaledVector(cross,b*reach*.35);
        p.push(v.x,v.y,v.z);const foliageNormal=new THREE.Vector3(v.x*.18,1,v.z*.18).normalize();n.push(foliageNormal.x,foliageNormal.y,foliageNormal.z);uv.push((b+1)/2,a);
      }
      indices.push(base,base+1,base+2,base,base+2,base+3);
    }
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);return geometry;
}
function branchTexture(renderer){
  // Bake small twigs once, retaining their colour, alpha and normal-map detail.
  const p=[],n=[],uv=[],indices=[];
  for(let i=0;i<28;i++){
    const t=i/27,side=i%2?1:-1,length=(.32+Math.sin(i*6.3)*.08)*(1-t*.6),angle=side*(.65+Math.sin(i*7.7)*.22);
    const direction=new THREE.Vector3(Math.sin(angle),Math.cos(angle),0),cross=new THREE.Vector3(direction.y,-direction.x,0);
    const start=new THREE.Vector3(side*.025,t*1.55+.03,Math.sin(i*2.4)*.06),base=p.length/3;
    for(const [a,b] of [[0,-1],[1,-1],[1,1],[0,1]]){
      const v=start.clone().addScaledVector(direction,a*length).addScaledVector(cross,b*length*.3);
      p.push(v.x,v.y,v.z);n.push(0,0,1);uv.push(.025+(b+1)*.097,.565+a*.395);
    }
    indices.push(base,base+1,base+2,base,base+2,base+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);
  const target=new THREE.WebGLRenderTarget(512,1024,{samples:4});target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
  const bake=new THREE.Scene(),material=new THREE.MeshStandardMaterial({map:foliageMap,alphaMap:foliageAlpha,normalMap:foliageNormal,normalScale:new THREE.Vector2(.25,.25),roughness:1,alphaTest:.18,side:THREE.DoubleSide});
  bake.add(new THREE.Mesh(geometry,material),new THREE.AmbientLight(0xffffff,1.7));
  const sun=new THREE.DirectionalLight(0xffffff,.8);sun.position.set(1,2,5);bake.add(sun);
  const camera=new THREE.OrthographicCamera(-.42,.42,1.8,0,.1,10);camera.position.set(0,0,3);camera.lookAt(0,0,0);
  const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),tone=renderer.toneMapping;
  try{renderer.toneMapping=THREE.NoToneMapping;renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(bake,camera);}
  finally{renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);renderer.toneMapping=tone;material.dispose();geometry.dispose();}
  return target;
}

function distantTreeTexture(renderer,geometry,width,map){
  // Bake the same photographed pine used nearby, instead of drawing another species.
  const target=new THREE.WebGLRenderTarget(512,1024,{samples:4});target.texture.generateMipmaps=true;target.texture.minFilter=THREE.LinearMipmapLinearFilter;
  const scene=new THREE.Scene(),material=new THREE.MeshBasicMaterial({map,alphaTest:.18,side:THREE.DoubleSide});
  scene.add(new THREE.Mesh(geometry,material));
  const camera=new THREE.OrthographicCamera(-width/2,width/2,10,0,.1,40);camera.position.set(0,0,20);camera.lookAt(0,0,0);
  const previous=renderer.getRenderTarget(),clear=renderer.getClearColor(new THREE.Color()),alpha=renderer.getClearAlpha(),tone=renderer.toneMapping;
  try{renderer.toneMapping=THREE.NoToneMapping;renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);}
  finally{renderer.setRenderTarget(previous);renderer.setClearColor(clear,alpha);renderer.toneMapping=tone;material.dispose();}
  return target;
}
function treeTransition(material,viewer,range,far){
  const result=material.clone(),compile=material.onBeforeCompile;result.customProgramCacheKey=()=>material.customProgramCacheKey()+(far?'tree-fade-far':'tree-fade-near');
  result.onBeforeCompile=(shader,renderer)=>{compile.call(material,shader,renderer);
    Object.assign(shader.uniforms,{treeViewer:viewer,treeRange:range});
    shader.vertexShader='varying float vTreeFade;uniform vec3 treeViewer;uniform vec2 treeRange;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec3 treeCentre=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;vTreeFade=smoothstep(treeRange.x,treeRange.y,distance(treeCentre.xz,treeViewer.xz));');
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>\nif(distance(treeCentre.xz,treeViewer.xz)${far?'<treeRange.x':'>treeRange.y'})gl_Position=vec4(2.,2.,2.,1.);`);
    shader.fragmentShader='varying float vTreeFade;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float treeNoise=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(${far?'treeNoise>=vTreeFade':'treeNoise<vTreeFade'})discard;
    `);
  };
  return result;
}
function billboardGeometry(width){
  const p=[],n=[],uv=[];
  for(let i=0;i<2;i++){const g=new THREE.PlaneGeometry(width,10).translate(0,5,0).rotateY(i*Math.PI/2).toNonIndexed();p.push(...g.attributes.position.array);for(let j=0;j<g.attributes.position.count;j++)n.push(0,1,0);uv.push(...g.attributes.uv.array);g.dispose();}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));return g;
}
function forestInstances(scene,positions,geometry,materials){
  if(!positions.length)return;
  const trees=new THREE.InstancedMesh(geometry,materials.leaves,positions.length);
  trees.customDepthMaterial=materials.depth;
  const trunks=new THREE.InstancedMesh(materials.trunkGeometry,materials.bark,positions.length);
  const dummy=new THREE.Object3D(),color=new THREE.Color();
  positions.forEach(([x,y,z,scale],i)=>{dummy.position.set(x,y,z);dummy.scale.setScalar(scale);dummy.rotation.set(0,noise(x*.19,z*.19)*6.283,0);dummy.updateMatrix();trees.setMatrixAt(i,dummy.matrix);color.setHSL(.20+noise(x,z)*.035,.08,.76+noise(z,x)*.16);trees.setColorAt(i,color);dummy.position.y=y+4.55*scale;dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);});
  trees.castShadow=true;trees.receiveShadow=true;trunks.castShadow=true;
  scene.add(trees,trunks);return [trees,trunks];
}
function vegetation(scene,renderer,viewer,range){
  const close=[],far=[];
  for(let i=0;i<(activeMap.kind==='circuit'?21000:15000);i++){
    const x=activeMap.kind==='coast'?-1100+random()*3000:routeBounds.minX-300+random()*(routeBounds.maxX-routeBounds.minX+1000),z=activeMap.kind==='coast'?-2300+random()*4800:routeBounds.minZ-300+random()*(routeBounds.maxZ-routeBounds.minZ+600),h=terrainHeight(x,z);
    if(h<36||h>710)continue;
    const p=nearest(x,z);if(p&&(p.distance<p.railOffset+3.5||(activeMap.kind!=='circuit'&&x<p.x&&p.distance<85)))continue;
    const slope=Math.hypot(terrainHeight(x+3,z)-terrainHeight(x-3,z),terrainHeight(x,z+3)-terrainHeight(x,z-3))/6;
    if(slope>.85||random()> .8-noise(x*.012,z*.012)*.55)continue;
    const near=p&&p.distance<(activeMap.kind==='circuit'?60:105);
    (near?close:far).push([x,h-.12,z,.68+random()*.70]);
  }
  // Roadside pines sit inland, leaving the ocean side of each terrace open.
  for(let i=0;i<(activeMap.kind==='circuit'?900:650);i++){const p=sample(random()*length),side=activeMap.kind==='circuit'?(random()<.5?1:-1):(p.nx>0?1:-1),offset=side*((activeMap.kind==='circuit'?p.railOffset:p.width/2)+8+random()*25),x=p.x+p.nx*offset,z=p.z+p.nz*offset,y=terrainHeight(x,z);
    if((activeMap.kind!=='circuit'||nearest(x,z)?.distance>p.railOffset+4)&&y>20&&Math.hypot(terrainHeight(x+2,z)-terrainHeight(x-2,z),terrainHeight(x,z+2)-terrainHeight(x,z-2))/4<.85)close.push([x,y-.1,z,.7+random()*.64]);
  }
  // Independent scatter seeds keep roadside rocks fixed when foliage changes.
  seed={circuit:1061831211,classic:4218864327,coast:1201961643}[activeMap.kind];
  const branchAtlas=branchTexture(renderer);scene.userData.branchAtlas=branchAtlas;
  const branchMap=branchAtlas.texture;
  const nearGeometry=treeGeometry();nearGeometry.computeBoundingBox();
  const bounds=nearGeometry.boundingBox,width=2*Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x),Math.abs(bounds.min.z),Math.abs(bounds.max.z))+.1;
  const farGeometry=billboardGeometry(width),atlas=distantTreeTexture(renderer,nearGeometry,width,branchMap),farMap=atlas.texture;scene.userData.treeAtlas=atlas;
  const trunkGeometry=new THREE.CylinderGeometry(.035,.12,9.1,8,1);
  const bark=new THREE.MeshStandardMaterial({map:barkMap,normalMap:barkNormal,normalScale:new THREE.Vector2(.55,.55),color:'#aaa18c',roughness:1});
  const treeMaterials=map=>({bark,trunkGeometry,
    leaves:new THREE.MeshLambertMaterial({map,side:THREE.DoubleSide,alphaTest:.18,alphaToCoverage:true}),
    depth:new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:.18,side:THREE.DoubleSide})});
  const nearBase=treeMaterials(branchMap),farMaterials=treeMaterials(farMap);
  // Foliage normals describe the canopy volume, including the backs of its cards.
  for(const material of [nearBase.leaves,farMaterials.leaves])material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;',''));};
  const transition=(source,far)=>({...source,leaves:treeTransition(source.leaves,viewer,range,far),bark:treeTransition(source.bark,viewer,range,far),depth:treeTransition(source.depth,viewer,range,far)});
  const nearMaterials=transition(nearBase,false),farTransition=transition(farMaterials,true);
  for(const far of [false,true]){
    const meshes=forestInstances(scene,close,far?farGeometry:nearGeometry,far?farTransition:nearMaterials);
    for(const mesh of meshes||[])mesh.userData.foliageRange={viewer:viewer.value,distance:range.value,far};
  }
  forestInstances(scene,far,farGeometry,farMaterials);
  const dummy=new THREE.Object3D(),rockGeo=new THREE.IcosahedronGeometry(1,2),pos=rockGeo.attributes.position;
  for(let i=0;i<pos.count;i++){const factor=.8+noise(pos.getX(i)*3+4,pos.getZ(i)*3+8)*.38;pos.setXYZ(i,pos.getX(i)*factor,pos.getY(i)*factor,pos.getZ(i)*factor);}rockGeo.computeVertexNormals();
  const rocks=new THREE.InstancedMesh(rockGeo,new THREE.MeshStandardMaterial({color:'#9f9c8f',map:cliffMap,normalMap:cliffNormal,normalScale:new THREE.Vector2(.7,.7),roughness:.94}),560);
  for(let i=0;i<560;i++){
    const p=sample(random()*length),offset=(random()<.5?-1:1)*(p.railOffset+2.5+random()*18),x=p.x+p.nx*offset,z=p.z+p.nz*offset;
    const slope=Math.hypot(terrainHeight(x+2,z)-terrainHeight(x-2,z),terrainHeight(x,z+2)-terrainHeight(x,z-2))/4;
    dummy.scale.set(.4+random()*2,.3+random()*1.3,.5+random()*2);dummy.rotation.set(random(),random()*6.28,random());
    const reach=Math.max(dummy.scale.x,dummy.scale.z),ground=Math.min(terrainHeight(x,z),terrainHeight(x-reach,z),terrainHeight(x+reach,z),terrainHeight(x,z-reach),terrainHeight(x,z+reach));
    dummy.position.set(x,ground-dummy.scale.y*.45,z);
    // Loose boulders sit in the ground; steep cliffs use the continuous rock surface.
    if(slope>.85)dummy.scale.setScalar(0);
    dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
  }
  rocks.castShadow=true;rocks.receiveShadow=true;scene.add(rocks);
}
function roadsideBanks(scene){
  // A road-aligned mesh replaces coarse ground triangles along both edges of the entire pass.
  const distances=[0,.6,1.2,1.8,2.4,3,3.6,4.2,4.8,5.4,6,8,11,16,24,34];
  const columns=distances.length,surfaces={grass:[],rock:[],mixed:[]};
  for(let start=0;start<count;start+=100)for(const side of [-1,1]){
    const end=Math.min(start+100,count),positions=[],uv=[],indices=[];
    for(let i=start;i<=end;i++){
      const frame=frames[i%count];
      for(let j=0;j<columns;j++){
        const offset=side*(frame.railOffset+.12+distances[j]),x=frame.x+frame.nx*offset,z=frame.z+frame.nz*offset;
        const y=j===0?frame.y+.025:terrainHeight(x,z,frame.index)+.025;
        positions.push(x,y,z);uv.push(offset/6,i*length/count/6);
        if(i<end&&j<columns-1){const a=(i-start)*columns+j;
          if(side===1)indices.push(a,a+1,a+columns,a+1,a+columns+1,a+columns);
          else indices.push(a,a+columns,a+1,a+1,a+columns,a+columns+1);
        }
      }
    }
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    for(const [kind,surface] of Object.entries(splitTerrainSurface(g,activeMap.kind!=='circuit'))){
      surfaces[kind].push(...partitionGeometry(surface,100));
    }
  }
  for(const [kind,parts] of Object.entries(surfaces))if(parts.length){
    const mesh=batchGeometries(parts,terrainSurfaceMaterial[kind]);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData.terrain=true;scene.add(mesh);
  }
}
function roadObjects(scene){
  const add=(...objects)=>{for(const object of objects){
    if(object.isInstancedMesh){scene.add(object);}
    else if(object.isMesh&&object.geometry.index){
      const batch=batchGeometries(partitionGeometry(object.geometry,100),object.material);
      batch.castShadow=object.castShadow;batch.receiveShadow=object.receiveShadow;batch.userData={...object.userData};scene.add(batch);
    }else scene.add(object);
  }};
  const asphaltMap=texture('asphalt');
  const asphalt=new THREE.MeshStandardMaterial({color:'#b7b9b7',map:asphaltMap,roughness:.96,bumpMap:asphaltMap,bumpScale:.0015,envMapIntensity:.2,side:THREE.DoubleSide});
  asphalt.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec2 roadUv;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nroadUv=uv;');
    shader.fragmentShader='varying vec2 roadUv;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      float joint=(1.-smoothstep(.0,.007,abs(roadUv.x)))*.06;
      float tracks=exp(-pow((abs(roadUv.x)-.34)*21.,2.))+exp(-pow((abs(roadUv.x)-.68)*21.,2.));
      diffuseColor.rgb*=1.-joint-tracks*.026;
    `);
  };
  const carriageway=ribbon(p=>-p.width/2,p=>p.width/2,.025,asphalt);carriageway.userData.groundOccluder=true;add(carriageway);
  const gravel=new THREE.MeshStandardMaterial({color:'#a39c89',map:texture('gravel'),roughness:1,side:THREE.DoubleSide});
  add(ribbon(p=>-p.railOffset-.12,p=>-p.width/2,.025,gravel),ribbon(p=>p.width/2,p=>p.railOffset+.12,.025,gravel));
  const paint=new THREE.MeshStandardMaterial({color:'#c9c8b6',roughness:.98,bumpMap:asphaltMap,bumpScale:.0005,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2});
  add(ribbon(p=>-p.width/2+.20,p=>-p.width/2+.30,.030,paint),ribbon(p=>p.width/2-.30,p=>p.width/2-.20,.030,paint));
  const centrePaint=paint.clone();
  centrePaint.onBeforeCompile=shader=>{
    shader.vertexShader='varying float roadDistance;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nroadDistance=uv.y*4.;');
    shader.fragmentShader='varying float roadDistance;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>','#include <alphatest_fragment>\nif(mod(roadDistance,9.)>3.)discard;');
  };
  if(activeMap.kind!=='circuit')add(ribbon(-.05,.05,.030,centrePaint));
  else{
    const kerb=paint.clone();kerb.color.set('#eee8df');kerb.onBeforeCompile=shader=>{shader.vertexShader='varying float kerbDistance;\n'+shader.vertexShader;shader.vertexShader=shader.vertexShader.replace('#include <uv_vertex>','#include <uv_vertex>\nkerbDistance=uv.y*4.;');shader.fragmentShader='varying float kerbDistance;\n'+shader.fragmentShader;shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=mod(kerbDistance,5.)<2.5?vec3(.55,.025,.02):vec3(1.);');};
    add(ribbon(p=>-p.width/2-.9,p=>-p.width/2,.055,kerb),ribbon(p=>p.width/2,p=>p.width/2+.9,.055,kerb));
  }
  const dummy=new THREE.Object3D();
  const metal=new THREE.MeshStandardMaterial({color:'#a5aba8',metalness:.82,roughness:.48,side:THREE.DoubleSide});
  for(const side of [-1,1]){
    const positions=[],indices=[];
    for(let i=0;i<=count;i++){const p=frames[i%count];for(const [h,inset] of [[.50,0],[.55,.045],[.62,0],[.69,.045],[.77,0],[.82,.045]])positions.push(p.x+p.nx*side*(p.railOffset+inset),p.y+h,p.z+p.nz*side*(p.railOffset+inset));}
    for(let i=0;i<count;i++)for(let j=0;j<5;j++){const a=i*6+j;indices.push(a,a+1,a+6,a+1,a+7,a+6);}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();const rail=new THREE.Mesh(g,metal);rail.castShadow=true;rail.receiveShadow=true;add(rail);
    const n=Math.floor(length/4),posts=new THREE.InstancedMesh(new THREE.BoxGeometry(.095,.92,.13),metal,n),bolts=new THREE.InstancedMesh(new THREE.SphereGeometry(.016,5,4),metal,n*2);
    const reflectors=new THREE.InstancedMesh(new THREE.BoxGeometry(.065,.055,.032),new THREE.MeshStandardMaterial({color:side===1?'#eed6a1':'#be3c27',roughness:.36}),n);
    for(let i=0;i<n;i++){const p=sample(i*4);dummy.position.set(p.x+p.nx*side*(p.railOffset+.05),p.y+.39,p.z+p.nz*side*(p.railOffset+.05));dummy.rotation.set(0,Math.atan2(p.tx,p.tz),0);dummy.updateMatrix();posts.setMatrixAt(i,dummy.matrix);
      for(let j=0;j<2;j++){dummy.position.set(p.x+p.nx*side*(p.railOffset-.008),p.y+.56+j*.16,p.z+p.nz*side*(p.railOffset-.008));dummy.updateMatrix();bolts.setMatrixAt(i*2+j,dummy.matrix);}
      dummy.position.set(p.x+p.nx*side*(p.railOffset-.028),p.y+.79,p.z+p.nz*side*(p.railOffset-.028));dummy.updateMatrix();reflectors.setMatrixAt(i,dummy.matrix);
    }posts.castShadow=true;add(posts,bolts,reflectors);
  }
  // Stone-faced retaining structures continue down the exposed coastal edge.
  const p=[],uv=[],indices=[];
  for(let i=0;i<=count;i++){const f=frames[i%count],side=f.nx<0?1:-1,offset=f.railOffset+.15;
    const x=f.x+f.nx*side*offset,z=f.z+f.nz*side*offset,depth=f.x<-380?12:2;
    p.push(x,f.y-.03,z,x,f.y-depth,z);uv.push(i*length/count/4,0,i*length/count/4,depth/4);
    if(i<count){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
  const wall=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:cliffMap,normalMap:cliffNormal,normalScale:new THREE.Vector2(.65,.65),color:'#8c8a7c',roughness:.95,side:THREE.DoubleSide}));wall.receiveShadow=true;wall.userData.groundOccluder=true;add(wall);
  // Drainage grates and repairs are sparse; the road stays readable at speed.
  const n=90,grates=new THREE.InstancedMesh(new THREE.BoxGeometry(.26,.022,.6),new THREE.MeshStandardMaterial({color:'#373a37',metalness:.5,roughness:.7}),n);
  for(let i=0;i<n;i++){const p=sample(i*length/n),side=p.nx>0?1:-1;dummy.position.set(p.x+p.nx*side*(p.width/2-.08),p.y+.035,p.z+p.nz*side*(p.width/2-.08));dummy.rotation.set(-Math.atan2(p.ty,Math.hypot(p.tx,p.tz)),Math.atan2(p.tx,p.tz),0,'YXZ');dummy.updateMatrix();grates.setMatrixAt(i,dummy.matrix);}add(grates);
  for(const [s,label,sub] of activeMap.kind==='circuit'?[[35,'GRAND PRIX','Start / Finish'],[length*.31,'SECTOR 2','Brake before turn-in'],[length*.67,'SECTOR 3','Build speed on exit']]:[[35,'COSTA ALTA','Strada panoramica'],[length*.075,'CARREGGIATA STRETTA','5,6 m · Rallentare'],[length*.55,'TORNANTI','Procedere con cautela']]){
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#254f4e';c.fillRect(0,0,768,320);c.strokeStyle='#e4e4d4';c.lineWidth=10;c.strokeRect(12,12,744,296);c.fillStyle='#f4f2de';c.font='500 43px sans-serif';c.fillText(label,35,98);c.font='32px sans-serif';c.fillText(sub,35,167);c.font='28px sans-serif';c.fillText('↑  '+(length/1000).toFixed(1)+' km',35,254);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;const sign=new THREE.Group(),face=new THREE.Mesh(new THREE.PlaneGeometry(2.25,.94),new THREE.MeshStandardMaterial({map,roughness:.85,side:THREE.DoubleSide}));face.position.y=2.25;sign.add(face);
    for(const x of [-.78,.78]){const pole=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,2.4,6),metal);pole.position.set(x,1.2,0);sign.add(pole);}
    const p=sample(s),side=p.nx>0?1:-1,x=p.x+p.nx*side*(p.railOffset+1.5),z=p.z+p.nz*side*(p.railOffset+1.5);
    sign.position.set(x,terrainHeight(x,z,p.index)+.025,z);sign.rotation.y=Math.atan2(-p.tx,-p.tz);add(sign);
  }
}
function circuitFurniture(scene){
  const concrete=new THREE.MeshStandardMaterial({color:'#bbbcb6',roughness:.85}),dark=new THREE.MeshStandardMaterial({color:'#30342f',roughness:.72}),dummy=new THREE.Object3D();
  const garages=new THREE.InstancedMesh(new THREE.BoxGeometry(9,4,7.6),concrete,10),doors=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,2.6,6.2),dark,10),roofs=new THREE.InstancedMesh(new THREE.BoxGeometry(11,.22,7.8),dark,10);
  for(let i=0;i<10;i++){
    const p=sample(30+i*8),offset=p.railOffset+9;
    dummy.position.set(p.x+p.nx*offset,terrainHeight(p.x+p.nx*offset,p.z+p.nz*offset)+2,p.z+p.nz*offset);dummy.rotation.set(0,Math.atan2(p.tx,p.tz),0);dummy.updateMatrix();garages.setMatrixAt(i,dummy.matrix);
    dummy.position.x-=p.nx*4.55;dummy.position.z-=p.nz*4.55;dummy.position.y-=.45;dummy.updateMatrix();doors.setMatrixAt(i,dummy.matrix);
    dummy.position.x+=p.nx*4.55;dummy.position.z+=p.nz*4.55;dummy.position.y+=2.65;dummy.updateMatrix();roofs.setMatrixAt(i,dummy.matrix);
  }
  garages.castShadow=roofs.castShadow=true;garages.receiveShadow=true;scene.add(garages,doors,roofs);
  const line=sample(0),white=new THREE.MeshBasicMaterial({color:'#eeeae1'}),black=new THREE.MeshBasicMaterial({color:'#171717'});
  for(let row=0;row<2;row++)for(let column=0;column<16;column++){
    const positions=[],across=column/16*line.width-line.width/2,along=row*.42;
    for(const [x,z] of [[across,along],[across+line.width/16,along],[across,along+.42],[across+line.width/16,along+.42]])positions.push(line.x+line.nx*x+line.tx*z,line.y+.042,line.z+line.nz*x+line.tz*z);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex([0,1,2,1,3,2]);const material=((row+column)%2)?white:black;material.side=THREE.DoubleSide;scene.add(new THREE.Mesh(geometry,material));
  }
}
export function createWorld(scene,renderer,hdr){
  const treeViewer={value:new THREE.Vector3()},treeRange={value:new THREE.Vector2(85,115)};
  seed=1745;terrainSurfaceMaterial=null;scene.fog=new THREE.FogExp2('#b3c6ca',.00025);
  scene.environment=hdr;scene.environmentIntensity=.7;scene.environmentRotation.y=1.4;
  const sky=atmosphere(scene),water=activeMap.kind==='circuit'?null:sea(scene);
  const nearBounds={minX:Math.floor((routeBounds.minX-180)/4)*4,maxX:Math.ceil((routeBounds.maxX+280)/4)*4,minZ:Math.floor((routeBounds.minZ-220)/4)*4,maxZ:Math.ceil((routeBounds.maxZ+220)/4)*4};
  terrain(scene,nearBounds,4);terrain(scene,{minX:-4000,maxX:4000,minZ:-4000,maxZ:4000},8000/260,{minX:nearBounds.minX+24,maxX:nearBounds.maxX-24,minZ:nearBounds.minZ+24,maxZ:nearBounds.maxZ-24});
  roadObjects(scene);roadsideBanks(scene);vegetation(scene,renderer,treeViewer,treeRange);if(activeMap.kind==='circuit')circuitFurniture(scene);
  // Resolve ground occlusion with a minimal shader before sampling its layered
  // rock and grass textures. Both passes use the exact same vertex buffers.
  const depthScene=new THREE.Scene(),depthMaterial=new THREE.MeshBasicMaterial({colorWrite:false}),depthDouble=depthMaterial.clone(),instanceCullers=[];depthDouble.side=THREE.DoubleSide;
  const staticDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),staticMaterials=new Set([depthMaterial,depthDouble,staticDepth]);
  scene.traverse(object=>{
    if(object.isInstancedMesh){
      const culler=createInstanceCuller(object,100,object.userData.foliageRange);instanceCullers.push({mesh:object,culler});
      object.onBeforeShadow=()=>{object.count=culler.shadowCount;};object.onAfterShadow=()=>{object.count=culler.visibleCount;};
    }
    if(object.isBatchedMesh){staticMaterials.add(object.material);object.customDepthMaterial=staticDepth;}
    if(object.userData.terrain||object.userData.groundOccluder){
      const material=object.material.side===THREE.DoubleSide?depthDouble:depthMaterial;
      const proxy=object.isBatchedMesh?new THREE.BatchedMesh(object.maxInstanceCount,0,0).copy(object):new THREE.Mesh(object.geometry,material);
      if(object.isBatchedMesh){proxy.geometry.dispose();proxy.geometry=object.geometry;proxy.material=material;}
      depthScene.add(proxy);
    }
    if(object!==sky){object.updateMatrix();object.matrixAutoUpdate=false;}
  });
  // These batches contain world-space vertices and identity transforms. Keep
  // per-part culling, without reading a transform texture for every vertex.
  for(const material of staticMaterials){
    const compile=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.customProgramCacheKey=()=>key+'-static-batch';
    material.onBeforeCompile=shader=>{
      compile.call(material,shader);
      shader.vertexShader=shader.vertexShader.replace('#include <batching_vertex>','#ifdef USE_BATCHING\nmat4 batchingMatrix=mat4(1.);\n#endif');
    };
  }
  depthScene.updateMatrixWorld(true);depthScene.traverse(object=>{object.matrixAutoUpdate=false;});
  scene.add(new THREE.HemisphereLight('#d1e4f4','#555745',.7));
  const sun=new THREE.DirectionalLight('#fff0d1',2.8);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-45,right:45,top:45,bottom:-45,near:1,far:350});sun.shadow.bias=-.00010;sun.shadow.normalBias=.035;sun.shadow.radius=2;scene.add(sun,sun.target);
  const offset=new THREE.Vector3(-139,150,-64),snapped=new THREE.Vector3(),viewFrustum=new THREE.Frustum(),viewProjection=new THREE.Matrix4();
  return {setQuality(detail,shadowSize,groundFiltering=8){
    treeRange.value.set(Math.max(0,detail-15),detail+15);sun.shadow.mapSize.set(shadowSize,shadowSize);
    sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;
    for(const texture of [groundMap,cliffMap,groundNormal,cliffNormal])if(texture.anisotropy!==groundFiltering){texture.anisotropy=groundFiltering;texture.needsUpdate=true;}
  },async prepare(camera){
    await renderer.compileAsync(depthScene,camera);await renderer.compileAsync(scene,camera);this.render(camera);
    const gl=renderer.getContext(),fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);gl.flush();
    while(!gl.isContextLost()&&gl.clientWaitSync(fence,0,0)===gl.TIMEOUT_EXPIRED)await new Promise(resolve=>setTimeout(resolve,0));
    gl.deleteSync(fence);
  },render(camera){
    scene.updateMatrixWorld();camera.updateMatrixWorld();sun.shadow.updateMatrices(sun);
    viewFrustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    for(const {mesh,culler} of instanceCullers)if(mesh.visible)culler.update(viewFrustum,sun.shadow.getFrustum());
    const autoClear=renderer.autoClear,autoReset=renderer.info.autoReset;
    renderer.autoClear=false;renderer.info.autoReset=false;renderer.info.reset();
    try{renderer.clear();renderer.render(depthScene,camera);renderer.render(scene,camera);}
    finally{renderer.autoClear=autoClear;renderer.info.autoReset=autoReset;}
  },update(t,position){
    if(water)water.uniforms.time.value=t;sky.position.copy(position);
    treeViewer.value.copy(position);
    // Quantise the moving shadow box to texels to avoid shimmering while driving.
    const texel=90/sun.shadow.mapSize.x;snapped.copy(position);snapped.x=Math.round(snapped.x/texel)*texel;snapped.z=Math.round(snapped.z/texel)*texel;
    sun.position.copy(snapped).add(offset);sun.target.position.copy(snapped);
  }};
}
