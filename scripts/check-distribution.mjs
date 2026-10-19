import {readdirSync,readFileSync} from 'node:fs';
import {resolve,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

// Check the static distribution against the entry page and its module graph.
// A checksum entry or a mention in documentation does not make a file required.
export function checkDistribution(root){
  const files=new Set(),required=new Set(),errors=[],pending=['index.html'];
  function inventory(directory=''){
    for(const entry of readdirSync(resolve(root,directory),{withFileTypes:true})){
      const path=posix.join(directory,entry.name);
      if(entry.isSymbolicLink())errors.push('Symbolic link in distribution: '+path);
      else if(entry.isDirectory())inventory(path);
      else files.add(path);
    }
  }
  inventory();
  const html=files.has('index.html')?readFileSync(resolve(root,'index.html'),'utf8'):'';
  const importMap=html.match(/<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  const imports=importMap?JSON.parse(importMap[1]).imports||{}:{};
  function localPath(from,spec){
    if(/^(?:[a-z]+:|\/\/|#)/i.test(spec))return null;
    const target=spec.split(/[?#]/)[0];
    const path=posix.normalize(posix.join(posix.dirname(from),target+(target.endsWith('/')?'index.html':'')));
    if(path.startsWith('../')||posix.isAbsolute(path)){errors.push('Resource outside distribution: '+from);return null;}
    return path;
  }
  function include(from,spec){
    const path=localPath(from,spec);if(!path)return;
    if(!files.has(path)){errors.push('Missing resource: '+path+' (from '+from+')');return;}
    if(!required.has(path))pending.push(path);
  }
  function modules(from,source){
    const specifiers=[...source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/g)].map(match=>match[1]);
    for(const match of source.matchAll(/\bimport\s*\(\s*(['"])([^'"\r\n]+)\1\s*(?:,|\))/g))specifiers.push(match[2]);
    for(const spec of specifiers){
      if(spec.startsWith('.'))include(from,spec);
      else if(imports[spec])include('index.html',imports[spec]);
      else errors.push('Unresolved module: '+spec+' (from '+from+')');
    }
  }
  while(pending.length){
    const path=pending.pop();if(required.has(path))continue;
    if(!files.has(path)){errors.push('Missing entry page: '+path);continue;}
    required.add(path);
    if(!/\.(?:html|js|css)$/.test(path))continue;
    const source=readFileSync(resolve(root,path),'utf8');
    if(path.endsWith('.html')){
      for(const match of source.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))include(path,match[1]);
      for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(/\btype\s*=\s*['"]module['"]/i.test(match[1]))modules(path,match[2]);
    }else if(path.endsWith('.js')){
      modules(path,source);
      // Application loaders use literal paths, or literal filenames joined to
      // a directory/prefix. Vendor examples are not application resources.
      if(!path.startsWith('vendor/')){
        const literals=[...source.matchAll(/(['"])([^'"\r\n]+)\1/g)].map(match=>match[2]);
        const prefixes=literals.filter(value=>value.startsWith('./')&&!/\.[a-z0-9]+$/i.test(value));
        for(const value of literals.filter(value=>/\.(?:wav|ogg|jpg|png|hdr|glb|json)$/i.test(value))){
          if(value.startsWith('.'))include(path,value);
          else{
            const matches=prefixes.map(prefix=>localPath(path,prefix+value)).filter(candidate=>candidate&&files.has(candidate));
            if(!matches.length)errors.push('Missing loader resource: '+value+' (from '+path+')');
            for(const match of matches)pending.push(match);
          }
        }
      }
    }else{
      for(const match of source.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/g))include(path,match[1]);
    }
  }
  const documentation=['README.md','credits.txt','SHA256SUMS.txt'];
  const notices={
    'LICENSE':'index.html',
    'vendor/THREE-LICENSE.txt':'vendor/three.module.js',
    'vendor/ui-controls.LICENSE.txt':'vendor/ui-controls.js',
    'assets/nurburgring-gp-LICENSE.txt':'assets/nurburgring-gp.json',
  };
  for(const path of documentation)if(files.has(path))required.add(path);
  for(const [notice,owner] of Object.entries(notices))if(required.has(owner)){
    if(files.has(notice))required.add(notice);else errors.push('Missing licence: '+notice);
  }
  for(const path of files)if(!required.has(path))errors.push('Unreferenced distribution file: '+path);
  return {files:files.size,required:required.size,errors:[...new Set(errors)].sort()};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=checkDistribution(fileURLToPath(new URL('../game/',import.meta.url)));
  if(result.errors.length){for(const error of result.errors)console.error(error);process.exitCode=1;}
  else console.log(`Distribution check passed: ${result.files} referenced files and notices.`);
}
