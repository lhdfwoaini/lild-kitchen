// A no-install CI packager: never reads raw photos or regenerates images.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const context=vm.createContext({window:{}},{codeGeneration:{strings:false,wasm:false}});
new vm.Script(read('assets/recipes.js').toString()).runInContext(context,{timeout:1000});
const pub=JSON.parse(JSON.stringify(context.window.KITCHEN_DATA));
const source=JSON.parse(read('data/recipes.json'));
const recipes=source.recipes.filter(r=>r.status==='ready').map(({sourceFolder,status,...r})=>r);
if(JSON.stringify(recipes)!==JSON.stringify(pub.recipes)) throw Error('Compiled recipe content is stale');
const paths=new Set(['index.html','assets/site.css','assets/site.js','assets/recipes.js','assets/favicon.png']);
for(const im of Object.values(pub.images)) for(const p of [im.src,im.small]) {
  if(!/^图片\/展示图\/[a-z0-9-]+\.webp$/.test(p)) throw Error('Unexpected public image path: '+p);
  paths.add(p);
}
const files=Object.fromEntries([...paths].sort().map(p=>[p,sha(read(p))]));
const fingerprint=sha(Object.entries(files).map(([p,h])=>p+':'+h).join('\n'));
if(process.argv.includes('--require-qa')) {
  const qa=JSON.parse(read('data/release-check.json'));
  if(!qa.passed||!qa.visualReview||qa.siteFingerprint!==fingerprint) throw Error('Current site has not passed browser and visual QA');
}
const dest=path.join(root,'dist');
for(const p of paths) {const target=path.join(dest,p);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,p),target);}
fs.writeFileSync(path.join(dest,'.nojekyll'),'');
fs.writeFileSync(path.join(dest,'release.json'),JSON.stringify({schema:'lild-kitchen-release-v1',siteFingerprint:fingerprint,files,recipeCount:recipes.length},null,2)+'\n');
console.log(JSON.stringify({files:paths.size,siteFingerprint:fingerprint,directory:dest}));
