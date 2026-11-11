/* Local Chromium QA, adapted from the photography workflow, no external page requests. */
const fs=require('node:fs'),path=require('node:path');
const {createServer,ROOT,config}=require('./preview.cjs');
const runtime=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {chromium}=require(runtime);
const release=JSON.parse(fs.readFileSync(path.join(ROOT,'dist/release.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(ROOT,'data/recipes.json'),'utf8'));
const recipes=source.recipes.filter(r=>r.status==='ready');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'data/images.json'),'utf8')).images;
const online=process.argv.includes('--online');
if(online&&(!config.siteUrl||!config.repository||config.siteUrl!==`https://${config.repository.split('/')[0].toLowerCase()}.github.io/${config.repository.split('/')[1]}/`))throw Error('Unverified online target');
const output=path.join(ROOT,online?'.local/qa-online':'.local/qa');fs.mkdirSync(output,{recursive:true});
const report={passed:false,siteFingerprint:release.siteFingerprint,scenarios:[],checks:[],errors:[],screenshots:[]};
let browser,server,base;
function check(name,passed,evidence){report.checks.push({name,passed:!!passed,evidence});if(!passed)throw Error(name+': '+JSON.stringify(evidence));}
const norm=t=>t.replace(/\s+/g,'');
async function screenshot(page,name,fullPage=true){await page.screenshot({path:path.join(output,name+'.png'),fullPage,animations:'disabled'});report.screenshots.push(name+'.png');}
async function overflow(page,label){const s=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth}));check(label+'/overflow',s.document<=s.viewport,s);}
async function images(page){for(const im of await page.locator('#app img').all()){await im.scrollIntoViewIfNeeded();await im.evaluate(el=>el.decode());check('image-loaded',await im.evaluate(el=>el.naturalWidth>0),await im.getAttribute('src'));}}
async function scene(width,height,label){
  const context=await browser.newContext({viewport:{width,height},isMobile:width===390,hasTouch:width===390,deviceScaleFactor:1,locale:'zh-CN'});
  const errors=[];const external=[];
  await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(base).origin)return route.continue();external.push(route.request().url());return route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.status()>=400)errors.push(r.url()+':'+r.status());});
  page.on('requestfailed',r=>errors.push(r.url()+':'+r.failure()?.errorText));
  const result={label,width,passed:false};report.scenarios.push(result);
  const activate=loc=>width===390?loc.tap():loc.click();
  try{
    await page.goto(base);await page.locator('.recipe-card').first().waitFor();
    check(label+'/recipe-count',await page.locator('.recipe-card').count()===recipes.length);
    check(label+'/displayed-count',Number(await page.locator('.count b').textContent())===recipes.length);
    await images(page);await page.evaluate(()=>scrollTo(0,0));await overflow(page,label+'/home');
    await screenshot(page,label+'-home');
    for(const r of recipes){
      const card=page.locator('.recipe-card[href="#'+r.id+'"]');await activate(card);
      await page.locator('#recipe-title').waitFor();
      check(label+'/'+r.id+'/title',await page.locator('#recipe-title').textContent()===r.name);
      check(label+'/'+r.id+'/steps',JSON.stringify((await page.locator('.step p').allTextContents()).map(norm))===JSON.stringify(r.steps.map(norm)));
      check(label+'/'+r.id+'/ingredients',JSON.stringify(await page.locator('.ingredients li').allTextContents())===JSON.stringify(r.ingredients));
      check(label+'/'+r.id+'/record',await page.locator('.personal-record').textContent()===r.record);
      check(label+'/'+r.id+'/note',norm(await page.locator('.personal-note').textContent()).includes(norm(r.note)));
      check(label+'/'+r.id+'/quick',JSON.stringify(await page.locator('.quick-flow span').allTextContents())===JSON.stringify(r.quick));
      check(label+'/'+r.id+'/packaging',(await page.locator('.package p').allTextContents()).map(norm).join('|')===r.package.map(x=>norm(x.label+x.text)).join('|'));
      check(label+'/'+r.id+'/real-photo-count',await page.locator('.real-gallery figure').count()===r.photos.length);
      await images(page);await overflow(page,label+'/'+r.id);await page.evaluate(()=>scrollTo(0,0));
      await screenshot(page,label+'-'+r.id);
      const trigger=page.locator('.cover-figure button');await activate(trigger);
      await page.locator('#photo-dialog').waitFor({state:'visible'});await page.locator('#photo-full').evaluate(el=>el.decode());
      const cover=registry.find(im=>im.id===r.cover);
      const provenance=cover.kind==='ai'?(cover.basis==='recipe'?'AI 生成示意图':'AI 重绘展示图'):'实拍记录';
      check(label+'/'+r.id+'/source-label',(await page.locator('#photo-caption').textContent()).includes(provenance));
      if(cover.basis==='recipe')check(label+'/'+r.id+'/illustration-disclosure',(await page.locator('.cover-caption').textContent()).includes('非实拍'));
      await page.keyboard.press('Tab');check(label+'/focus-contained',await page.evaluate(()=>document.activeElement.closest('dialog')!==null));
      await page.keyboard.press('Escape');await page.locator('#photo-dialog').waitFor({state:'hidden'});
      check(label+'/focus-restored',await trigger.evaluate(el=>document.activeElement===el));
      await activate(trigger);await activate(page.locator('.viewer-close'));await page.locator('#photo-dialog').waitFor({state:'hidden'});
      await activate(trigger);await page.mouse.click(3,80);await page.locator('#photo-dialog').waitFor({state:'hidden'});
      if(r.photos.length){
        const real=page.locator('.real-gallery button').first();await activate(real);
        await page.locator('#photo-dialog').waitFor({state:'visible'});await page.locator('#photo-full').evaluate(el=>el.decode());
        check(label+'/real-label',(await page.locator('#photo-caption').textContent()).includes('实拍记录'));
        await page.keyboard.press('Escape');
      }else check(label+'/'+r.id+'/no-fake-photo-section',await page.locator('.real-record').count()===0);
      await activate(page.locator('.jump-quick'));await page.waitForFunction(()=>document.activeElement.id==='quick-note');
      await page.locator('#quick-note').scrollIntoViewIfNeeded();await overflow(page,label+'/quick');
      await screenshot(page,label+'-'+r.id+'-quick',false);
      await page.goBack();await page.locator('.recipe-grid').waitFor();
      await page.goForward();await page.locator('#recipe-title').waitFor();
      await page.reload();await page.locator('#recipe-title').waitFor();
      check(label+'/'+r.id+'/refresh',await page.locator('#recipe-title').textContent()===r.name);
      await activate(page.locator('.back-link'));await page.locator('.recipe-grid').waitFor();
      check(label+'/return-focus',await page.locator('.recipe-card[href="#'+r.id+'"]').evaluate(el=>document.activeElement===el));
    }
    for(const r of recipes){await page.goto(base+'#'+r.id);await page.locator('#recipe-title').waitFor();check(label+'/'+r.id+'/direct',await page.locator('#recipe-title').textContent()===r.name);}
    for(const r of source.recipes.filter(r=>r.status==='archived')){
      await page.goto(base+'#'+r.id);await page.locator('.recipe-grid').waitFor();
      check(label+'/'+r.id+'/archived-not-listed',await page.locator('.recipe-card[href="#'+r.id+'"]').count()===0);
      check(label+'/'+r.id+'/archived-not-exported',await page.evaluate(id=>!window.KITCHEN_DATA.recipes.some(r=>r.id===id),r.id));
      await page.reload();await page.locator('.recipe-grid').waitFor();
      check(label+'/'+r.id+'/archived-refresh-falls-back',await page.locator('#recipe-title').count()===0);
    }
    check(label+'/no-network-or-script-errors',!errors.length&&!external.length,{errors,external});
    result.passed=true;
  }catch(e){result.error=e.stack;report.errors.push(e.message);await screenshot(page,label+'-failure').catch(()=>{});}
  finally{await context.close();}
}
(async()=>{
  try{
    if(online)base=config.siteUrl;
    else{
      server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
      base='http://127.0.0.1:'+server.address().port+config.previewBase;
    }
    report.url=base;report.mode=online?'public-pages':'local-subpath';
    const executablePath=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
    browser=await chromium.launch({executablePath,headless:true,chromiumSandbox:true,timeout:20000,ignoreDefaultArgs:['--unsafely-disable-devtools-self-xss-warnings','--enable-unsafe-swiftshader','--disable-ipc-flooding-protection','--disable-popup-blocking','--disable-client-side-phishing-detection']});
    for(const size of [[1440,1000,'desktop'],[768,1024,'tablet'],[390,844,'mobile']])await scene(...size);
    report.passed=report.scenarios.length===3&&report.scenarios.every(x=>x.passed)&&report.checks.every(x=>x.passed);
  }catch(e){report.errors.push(e.stack);}
  finally{
    if(browser)await browser.close();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
    fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({passed:report.passed,checks:report.checks.length,scenarios:report.scenarios,errors:report.errors,output},null,2));
    process.exitCode=report.passed?0:1;
  }
})();
