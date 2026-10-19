import {build} from 'esbuild';
import {readFileSync,readdirSync,existsSync,writeFileSync} from 'node:fs';
import {dirname,resolve,parse,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'game/vendor/ui-controls.js');
const result=await build({absWorkingDir:root,entryPoints:[resolve(root,'ui/controls.jsx')],outfile:output,bundle:true,minify:true,tsconfigRaw:{compilerOptions:{jsx:'react'}},
  format:'esm',platform:'browser',target:['es2022'],define:{'process.env.NODE_ENV':'"production"'},legalComments:'none',metafile:true,
  banner:{js:'/* Third-party licences: ui-controls.LICENSE.txt */'}});
// Remove indentation-only lines from bundled CSS template literals.
writeFileSync(output,readFileSync(output,'utf8').replace(/^[\t ]+$/gm,''));
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
  if(!input.includes('node_modules/'))continue;
  let directory=dirname(resolve(root,input));
  while(directory!==parse(directory).root&&!existsSync(resolve(directory,'package.json')))directory=dirname(directory);
  const manifest=JSON.parse(readFileSync(resolve(directory,'package.json'),'utf8'));
  if(packages.has(manifest.name))continue;
  const files=readdirSync(directory),license=files.find(name=>/^licen[cs]e(?:\.(?:md|txt))?$/i.test(name));
  const licensePath=license?resolve(directory,license):resolve(root,'ui/licenses',manifest.name+'.txt');
  if(!existsSync(licensePath))throw new Error('Missing licence for '+manifest.name);
  packages.set(manifest.name,`${manifest.name} ${manifest.version}\n${readFileSync(licensePath,'utf8').trim()}`);
}
writeFileSync(output.replace(/\.js$/,'.LICENSE.txt'),[...packages.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,text])=>text).join('\n\n'+'='.repeat(72)+'\n\n')+'\n');
console.log(`Built ${relative(root,output)} with ${packages.size} dependency licence notices.`);
