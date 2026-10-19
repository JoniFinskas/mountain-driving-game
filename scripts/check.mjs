import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
let failed=false;
for(const dir of ['game','scripts','tests']){
  for(const name of readdirSync(new URL('../'+dir+'/',import.meta.url))){
    if(!/\.(m?js)$/.test(name))continue;
    const result=spawnSync(process.execPath,['--check',dir+'/'+name],{cwd:root,stdio:'inherit'});
    if(result.status!==0)failed=true;
  }
}
const distribution=spawnSync(process.execPath,['scripts/check-distribution.mjs'],{cwd:root,stdio:'inherit'});
if(distribution.status!==0)failed=true;
if(failed)process.exit(1);
console.log('JavaScript syntax checks passed.');
