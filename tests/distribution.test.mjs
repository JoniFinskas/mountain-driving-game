import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {checkDistribution} from '../scripts/check-distribution.mjs';

function fixture(t,files){
  const root=mkdtempSync(join(tmpdir(),'distribution-test-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const [path,content] of Object.entries(files)){
    const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content);
  }
  return root;
}

test('follows entry modules, import maps and split loader paths',t=>{
  const root=fixture(t,{
    'LICENSE':'Game licence',
    'index.html':'<script type="importmap">{"imports":{"library":"./library.js"}}</script><script src="main.js"></script>',
    'main.js':"import {x} from 'library';\nconst sounds=['engine.wav'];sounds.map(name=>fetch('./assets/audio/'+name));",
    'library.js':'export const x=1;',
    'assets/audio/engine.wav':'sound',
  });
  assert.deepEqual(checkDistribution(root).errors,[]);
});

test('rejects unused audio, modules and extra documents even when checksummed',t=>{
  const root=fixture(t,{
    'LICENSE':'Game licence',
    'index.html':'<script src="main.js"></script>',
    'main.js':'export const running=true;',
    'assets/audio/unused.wav':'unused',
    'unused.js':'export const unused=true;',
    'notes.md':'Notes',
    'SHA256SUMS.txt':'placeholder  assets/audio/unused.wav',
  });
  assert.deepEqual(checkDistribution(root).errors,[
    'Unreferenced distribution file: assets/audio/unused.wav',
    'Unreferenced distribution file: notes.md',
    'Unreferenced distribution file: unused.js',
  ]);
});

test('reports missing resources and required licences',t=>{
  const root=fixture(t,{
    'index.html':'<script src="main.js"></script>',
    'main.js':"import './missing.js';\nimport './vendor/three.module.js';\nfetch('./assets/missing.wav');",
    'vendor/three.module.js':'export const version=1;',
  });
  const {errors}=checkDistribution(root);
  assert.ok(errors.some(error=>error.startsWith('Missing resource: missing.js')));
  assert.ok(errors.some(error=>error.startsWith('Missing resource: assets/missing.wav')));
  assert.ok(errors.includes('Missing licence: vendor/THREE-LICENSE.txt'));
  assert.ok(errors.includes('Missing licence: LICENSE'));
});

test('follows inline module bootstraps and deferred local dependencies',t=>{
  const root=fixture(t,{
    'LICENSE':'Game licence',
    'index.html':'<script type="module">import("./main.js").catch(console.error);</script>',
    'main.js':"export const load=()=>import('./feature.js');",
    'feature.js':"import data from './data.json' with {type:'json'};",
    'data.json':'{}',
  });
  assert.deepEqual(checkDistribution(root).errors,[]);
  writeFileSync(join(root,'feature.js'),"export const load=()=>import('./missing.js');");
  const {errors}=checkDistribution(root);
  assert.ok(errors.includes('Missing resource: missing.js (from feature.js)'));
  assert.ok(errors.includes('Unreferenced distribution file: data.json'));
});
