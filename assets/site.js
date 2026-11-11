/* Rendered from the data files. Do not duplicate recipe text here. */
(() => {
  'use strict';
  const data = window.KITCHEN_DATA;
  const app = document.getElementById('app');
  if (!data) { app.textContent = '食谱数据未能加载，请通过“一键预览”重新打开。'; return; }
  const { recipes, images } = data;
  const dialog = document.getElementById('photo-dialog');
  let photoTrigger = null;
  let previousRecipe = null;
  let homeScroll = 0;
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sourceLabel = im => im.kind === 'ai' ? (im.basis === 'recipe' ? 'AI 生成示意图' : 'AI 重绘展示图') : im.kind === 'external' ? '外部授权图片' : '实拍记录';
  const sourceDetail = im => im.kind === 'ai' ? (im.basis === 'recipe' ? '根据实际做法生成 · 非实拍' : '依据本人实拍 · 实拍见文末') : '本人做饭记录';
  const imageTag = (id, type = 'cover', eager = false) => {
    const im = images[id];
    const sizes = type === 'card' ? '(max-width:560px) calc(100vw - 40px), (max-width:1144px) 46vw, 520px' : '(max-width:800px) 90vw, 500px';
    return `<img src="${escape(im.src)}" srcset="${escape(im.small)} ${im.smallWidth}w, ${escape(im.src)} ${im.width}w" sizes="${sizes}" width="${im.width}" height="${im.height}" alt="${escape(im.alt)}" style="object-position:${escape(im.focus)}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  };
  const heading = (title, en) => `<div class="block-heading"><h2>${title}</h2><span aria-hidden="true">${en}</span></div>`;
  function home() {
    return `<section class="home-intro" aria-labelledby="home-title"><div><p class="eyebrow">A LITTLE HOME KITCHEN</p><h1 id="home-title">${escape(data.title)}</h1></div><p class="intro-copy">${escape(data.description)}</p></section>
      <section aria-labelledby="collection-title"><div class="collection-head"><h2 id="collection-title">做过的菜</h2><span class="count"><b>${String(recipes.length).padStart(2,'0')}</b> 道记录 · 持续更新</span></div>
      <div class="recipe-grid">${recipes.map((r,i) => `<a class="recipe-card" href="#${r.id}" aria-label="查看${escape(r.name)}的完整做法"><div class="card-image">${imageTag(r.cover,'card',i===0)}<span class="image-source">${sourceLabel(images[r.cover])}</span></div><div class="card-copy"><div class="card-topline"><span class="recipe-code">RECIPE ${escape(r.number)}</span>${r.time?.label ? `<span>${escape(r.time.label)}</span>` : ''}</div><div class="card-heading"><h3>${escape(r.name)}</h3><span class="card-arrow" aria-hidden="true">↗</span></div><p>${escape(r.subtitle)}</p></div></a>`).join('')}</div></section>
      <p class="archive-note">每一份记录，都来自一次真正的下厨。已有实拍和制作小抄，收在各自的食谱里；示意封面均注明来源。</p>`;
  }
  function detail(r) {
    const next = recipes[(recipes.indexOf(r) + 1) % recipes.length];
    return `<nav class="detail-nav" aria-label="食谱导航"><a class="back-link" href="#home"><span aria-hidden="true">←</span> 返回食谱</a><span>我的厨房 / ${escape(r.number)}</span></nav>
      <article aria-labelledby="recipe-title"><div class="recipe-layout"><figure class="cover-figure"><button class="photo-button" data-photo="${r.cover}" aria-label="放大${escape(r.name)}展示图">${imageTag(r.cover,'cover',true).replace('<img ','<img class="cover-image" ')}<span class="zoom-label" aria-hidden="true">放大查看 ↗</span></button><figcaption class="cover-caption"><span>${sourceLabel(images[r.cover])}</span><span>${sourceDetail(images[r.cover])}</span></figcaption></figure>
      <div class="recipe-content"><header class="recipe-title"><p class="eyebrow">RECIPE ${escape(r.number)}</p><h1 id="recipe-title" tabindex="-1">${escape(r.name)}</h1><p class="subtitle">${escape(r.subtitle)}</p><p class="personal-record">${escape(r.record)}</p><div class="detail-meta">${r.method ? `<span>${escape(r.method)}</span>` : ''}${r.time?.label ? `<span>${escape(r.time.label)}</span>` : ''}</div><p class="detail-description">${escape(r.description)}</p><button class="jump-quick" type="button">下次制作速查 <span aria-hidden="true">↓</span></button></header>
      <section class="recipe-block">${heading('所需食材','INGREDIENTS')}<ul class="ingredients">${r.ingredients.map(x=>`<li>${escape(x)}</li>`).join('')}</ul>${r.package?.length ? `<aside class="package"><h3>包装说明</h3>${r.package.map(x=>`<p><strong>${escape(x.label)}</strong>${escape(x.text)}</p>`).join('')}</aside>` : ''}</section>
      <section class="recipe-block">${heading('制作步骤','METHOD')}<ol class="steps">${r.steps.map((s,i)=>`<li class="step"><span class="step-number" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><p>${escape(s).replace(/(\d+\s*分钟)/g,'<strong class="time">$1</strong>')}</p></li>`).join('')}</ol></section>
      ${r.note ? `<aside class="personal-note"><strong>我的下厨记录</strong>${escape(r.note)}</aside>` : ''}<aside class="quick-note" id="quick-note" tabindex="-1"><h2>下次制作速查</h2><p class="quick-flow">${r.quick.map(x=>`<span>${escape(x)}</span>`).join('<i aria-hidden="true">→</i>')}</p></aside></div></div>
      ${r.photos.length ? `<section class="real-record">${heading('那次下厨的实拍','FROM MY CAMERA')}<p>保留当时做好的样子。点击照片可放大查看。</p><div class="real-gallery">${r.photos.map(id=>`<figure><button class="photo-button" data-photo="${id}" aria-label="放大${escape(images[id].label)}实拍">${imageTag(id,'photo')}</button><figcaption>${escape(images[id].label)} · ${sourceLabel(images[id])}</figcaption></figure>`).join('')}</div></section>` : ''}
      ${recipes.length>1 ? `<nav class="next-recipe" aria-label="更多食谱"><a href="#home">← 全部食谱</a><a href="#${next.id}">${escape(next.name)} →</a></nav>` : ''}</article>`;
  }
  function render(initial = false) {
    if (dialog.open) dialog.close();
    let hash=''; try { hash=decodeURIComponent(location.hash.slice(1)); } catch { /* Invalid hashes fall back to the list. */ }
    const recipe = recipes.find(r=>r.id === hash);
    const returningFrom = previousRecipe;
    if (!previousRecipe && recipe && !initial) homeScroll = scrollY;
    app.innerHTML = recipe ? detail(recipe) : home();
    document.title = recipe ? `${recipe.name}｜Lil D Home Kitchen` : 'Lil D Home Kitchen｜我的个人食谱';
    previousRecipe = recipe?.id || null;
    if (!initial) {
      if (recipe) { window.scrollTo(0,0); document.getElementById('recipe-title').focus({preventScroll:true}); }
      else { window.scrollTo(0,homeScroll); const link=app.querySelector(`a[href="#${returningFrom}"]`); if(link) link.focus({preventScroll:true}); }
    }
  }
  app.addEventListener('click', (event) => {
    if(event.target.closest('.jump-quick')) { const note=document.getElementById('quick-note'); note.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'}); note.focus({preventScroll:true}); return; }
    const button=event.target.closest('[data-photo]');
    if (!button) return;
    photoTrigger=button;
    const im=images[button.dataset.photo];
    const full=document.getElementById('photo-full');
    full.src=im.src; full.alt=im.alt;
    document.getElementById('photo-caption').textContent=`${im.label} · ${sourceLabel(im)}`;
    document.body.classList.add('modal-open'); dialog.showModal(); dialog.querySelector('button').focus();
  });
  dialog.querySelector('.viewer-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();dialog.querySelector('.viewer-close').focus();}});
  dialog.addEventListener('click',event=>{if(event.target===dialog) dialog.close();});
  dialog.addEventListener('close',()=>{document.body.classList.remove('modal-open');if(photoTrigger?.isConnected) photoTrigger.focus({preventScroll:true});});
  window.addEventListener('hashchange',()=>render());
  render(true);
})();
