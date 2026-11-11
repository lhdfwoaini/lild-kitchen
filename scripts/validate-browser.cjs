/* Local Chromium QA, adapted from the photography workflow, no external page requests. */
const fs=require('node:fs'),path=require('node:path');
const {createServer,ROOT,config}=require('./preview.cjs');
const runtime=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {chromium}=require(runtime);
const release=JSON.parse(fs.readFileSync(path.join(ROOT,'dist/release.json'),'utf8'));
const source=JSON.parse(fs.readFileSync(path.join(ROOT,'data/recipes.json'),'utf8'));
const recipes=source.recipes.filter(r=>r.status==='ready');
const expectedTheme=r=>r.theme||['orange','pink','forest','lime'][Array.from(r.id).reduce((h,c)=>(Math.imul(h,31)+c.codePointAt(0))>>>0,0)%4];
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
async function contrast(page,selector,label){
  const samples=await page.locator(selector).evaluateAll(elements=>{
    const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
    const luminance=s=>rgb(s).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    return elements.filter(el=>el.getClientRects().length).map(el=>{
      const style=getComputedStyle(el);let ancestor=el,bg;
      do{bg=getComputedStyle(ancestor).backgroundColor;ancestor=ancestor.parentElement;}while(ancestor&&(bg==='transparent'||bg==='rgba(0, 0, 0, 0)'));
      const a=luminance(style.color),b=luminance(bg);
      return {text:el.textContent.slice(0,24),ratio:Number(((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2))};
    });
  });
  check(label+'/text-contrast',samples.length>0&&samples.every(s=>s.ratio>=4.5),samples);
}
async function homeDesign(page,label,width){
  const cards=await page.locator('.recipe-card').evaluateAll(nodes=>nodes.map(el=>{
    const image=el.querySelector('.card-image'),title=el.querySelector('h3'),im=image.querySelector('img');
    return {id:el.hash.slice(1),theme:el.dataset.theme,bg:getComputedStyle(el).backgroundColor,title:title.textContent,
      weight:getComputedStyle(title).fontWeight,fontSize:parseFloat(getComputedStyle(title).fontSize),titleFits:title.scrollWidth<=title.clientWidth+1,
      number:el.querySelector('.recipe-code').textContent,
      ratio:image.clientWidth/image.clientHeight,nativeRatio:im.naturalWidth/im.naturalHeight,
      fillsFrame:Math.abs(im.getBoundingClientRect().width-image.getBoundingClientRect().width)<1&&Math.abs(im.getBoundingClientRect().height-image.getBoundingClientRect().height)<1,
      fit:getComputedStyle(im).objectFit,top:el.offsetTop,left:el.offsetLeft,width:el.clientWidth,
      bottom:el.querySelector('.card-bottom').getBoundingClientRect().bottom};
  }));
  check(label+'/id-bound-themes',cards.every(c=>c.theme===expectedTheme(recipes.find(r=>r.id===c.id))),cards);
  check(label+'/uniform-photos-and-readable-titles',cards.every(c=>Math.abs(c.ratio-4/3)<.025&&Math.abs(c.nativeRatio-4/3)<.005&&c.fillsFrame&&c.fit==='cover'&&c.titleFits&&Number(c.weight)>=700&&c.fontSize>=20),cards);
  const columns=width>=1100?3:2;
  check(label+'/responsive-columns',await page.locator('.recipe-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)===columns,{width,columns});
  check(label+'/first-row-aligned',cards.slice(0,columns).every(c=>c.top===cards[0].top&&Math.abs(c.bottom-cards[0].bottom)<1),cards);
  check(label+'/continuous-numbers',cards.every((c,i)=>c.number==='NO. '+String(i+1).padStart(3,'0')),cards.map(c=>({id:c.id,number:c.number})));
  if(width===390)check(label+'/cards-start-in-first-screen',cards[0].top<500,cards[0].top);
  await contrast(page,'.card-copy h3,.card-subtitle,.card-topline,.image-source,.card-link,.intro-copy,.home-intro h1,.title-highlight,.count,.header-link',label+'/home');
  const first=page.locator('.recipe-card').first();await first.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  check(label+'/keyboard-focus-visible',await first.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'&&parseFloat(getComputedStyle(el).outlineWidth)>=3));
  await screenshot(page,label+'-keyboard-focus',false);
  await page.keyboard.press('Enter');await page.locator('#recipe-title').waitFor();await page.goBack();await page.locator('.recipe-grid').waitFor();
  await page.locator('.recipe-card').first().evaluate(el=>el.blur());
}
async function futureDesign(page,label){
  // In-memory fixture only: no production recipe/photo files are changed.
  const result=await page.evaluate(()=>{
    const source=window.KITCHEN_DATA.recipes,original=[...source];
    const colours=()=>Object.fromEntries([...document.querySelectorAll('.recipe-card')].map(el=>[el.hash,{theme:el.dataset.theme,bg:getComputedStyle(el).backgroundColor}]));
    const render=()=>window.dispatchEvent(new HashChangeEvent('hashchange'));
    const numberSnapshots=[];
    const numbers=()=>numberSnapshots.push([...document.querySelectorAll('.recipe-code')].map(el=>el.textContent));
    const before=colours();source.reverse();render();const reversed=colours();numbers();
    const fixture={...original[0],id:'recipe-qa-future',number:'TEST',name:'未来新增菜品长名称验证',theme:undefined};source.push(fixture);render();
    const defaultTheme=colours()['#recipe-qa-future'];numbers();source.reverse();render();const reordered=colours()['#recipe-qa-future'];numbers();
    history.replaceState(null,'','#'+fixture.id);render();const reorderedDetail=document.querySelector('.recipe-title .eyebrow').textContent;
    history.replaceState(null,'','#home');render();
    source.splice(0,source.length,fixture);render();const filtered=colours()['#recipe-qa-future'];numbers();
    fixture.theme='pink';render();const override=colours()['#recipe-qa-future'];
    source.splice(0,source.length,...original);render();
    return {stable:Object.keys(before).every(id=>JSON.stringify(before[id])===JSON.stringify(reversed[id])),defaultTheme,reordered,filtered,override,numberSnapshots,reorderedDetail};
  });
  check(label+'/stable-after-reorder-and-filter',result.stable&&JSON.stringify(result.defaultTheme)===JSON.stringify(result.reordered)&&JSON.stringify(result.defaultTheme)===JSON.stringify(result.filtered),result);
  check(label+'/future-recipe-and-explicit-theme',!!result.defaultTheme?.bg&&result.override.theme==='pink'&&result.override.bg==='rgb(237, 181, 217)');
  check(label+'/renumbers-after-add-remove-and-reorder',result.numberSnapshots.every(numbers=>numbers.every((n,i)=>n==='NO. '+String(i+1).padStart(3,'0')))&&result.reorderedDetail==='RECIPE 001',result.numberSnapshots);
  await page.evaluate(()=>{
    const data=window.KITCHEN_DATA.recipes;
    for(const theme of ['orange','pink','forest','lime'])data.push({...data[0],id:'recipe-qa-'+theme,theme});
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  await contrast(page,'.recipe-card h3,.card-subtitle,.image-source,.card-link,.card-topline',label+'/all-four-themes');
  await page.evaluate(()=>{const data=window.KITCHEN_DATA.recipes;data.splice(data.length-4,4);window.dispatchEvent(new HashChangeEvent('hashchange'));});
  await contrast(page,'.recipe-card h3,.image-source,.card-link',label+'/restored-themes');
}
async function narrowAndLargeText(page,label){
  await page.setViewportSize({width:320,height:844});await overflow(page,label+'/320px-home');
  check(label+'/320px-single-column',await page.locator('.recipe-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1));
  await screenshot(page,label+'-320-home');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await overflow(page,label+'/200-percent-home');
  check(label+'/large-text-single-column',await page.locator('.recipe-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length===1));
  await screenshot(page,label+'-large-text-home');
  const longest=recipes.reduce((a,b)=>a.ingredients.length>b.ingredients.length?a:b);
  await page.locator('.recipe-card[href="#'+longest.id+'"]').click();await page.locator('#recipe-title').waitFor();
  await overflow(page,label+'/200-percent-detail');await screenshot(page,label+'-large-text-detail');
  await page.evaluate(()=>document.documentElement.style.fontSize='');await page.locator('.back-link').click();
  await page.emulateMedia({reducedMotion:'reduce'});
  check(label+'/reduced-motion',await page.locator('.recipe-card').first().evaluate(el=>getComputedStyle(el).transitionDuration==='0s'));
}
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
    await homeDesign(page,label,width);await page.mouse.move(0,0);await page.evaluate(()=>scrollTo(0,0));
    await screenshot(page,label+'-home');
    for(const r of recipes){
      const card=page.locator('.recipe-card[href="#'+r.id+'"]');await activate(card);
      await page.locator('#recipe-title').waitFor();
      check(label+'/'+r.id+'/title',await page.locator('#recipe-title').textContent()===r.name);
      const number=String(recipes.indexOf(r)+1).padStart(3,'0');
      check(label+'/'+r.id+'/detail-number',await page.locator('.recipe-title .eyebrow').textContent()==='RECIPE '+number&&(await page.locator('.detail-nav > span').textContent()).endsWith('/ '+number));
      check(label+'/'+r.id+'/steps',JSON.stringify((await page.locator('.step p').allTextContents()).map(norm))===JSON.stringify(r.steps.map(norm)));
      check(label+'/'+r.id+'/ingredients',JSON.stringify(await page.locator('.ingredients li').allTextContents())===JSON.stringify(r.ingredients));
      check(label+'/'+r.id+'/record',await page.locator('.personal-record').textContent()===r.record);
      check(label+'/'+r.id+'/note',norm(await page.locator('.personal-note').textContent()).includes(norm(r.note)));
      check(label+'/'+r.id+'/quick',JSON.stringify(await page.locator('.quick-flow span').allTextContents())===JSON.stringify(r.quick));
      check(label+'/'+r.id+'/packaging',(await page.locator('.package p').allTextContents()).map(norm).join('|')===r.package.map(x=>norm(x.label+x.text)).join('|'));
      check(label+'/'+r.id+'/real-photo-count',await page.locator('.real-gallery figure').count()===r.photos.length);
      check(label+'/'+r.id+'/detail-theme',await page.locator('.recipe-detail').getAttribute('data-theme')===expectedTheme(r));
      check(label+'/'+r.id+'/reading-size',await page.locator('.step p').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
      await contrast(page,'.recipe-title h1,.subtitle,.personal-record,.detail-description,.cover-caption,.jump-quick,.ingredients li,.step p,.step-number,.quick-flow,.quick-note h2',label+'/'+r.id);
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
    await page.goto(base);await page.locator('.recipe-grid').waitFor();await futureDesign(page,label);
    if(width===1440){
      for(const [edge,columns] of [[1099,2],[1100,3],[1280,3]]){
        await page.setViewportSize({width:edge,height});await overflow(page,label+'/'+edge+'px-home');
        check(label+'/'+edge+'px-columns',await page.locator('.recipe-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)===columns);
        check(label+'/'+edge+'px-card-width',await page.locator('.recipe-card').first().evaluate(el=>el.clientWidth>=320));
        await screenshot(page,label+'-'+edge+'-home');
      }
    }
    if(width===390)await narrowAndLargeText(page,label);
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
