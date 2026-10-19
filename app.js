const $ = (selector) => document.querySelector(selector);
const state = { files: [], articleHtml: '', images: [], outputImages: [], stamp: '', title: '' };
const input = $('#folderInput');
const dropzone = $('#dropzone');
const dateInput = $('#dateInput');
const allowedImage = /\.(jpe?g|png|webp|gif|bmp|svg)$/i;
const contentExt = /\.(docx?|txt|html?)$/i;

function localStamp(value) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
function setDefaultDate(){ const now = new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset()); dateInput.value = now.toISOString().slice(0,19); }
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function filenameOf(file){ return file.webkitRelativePath || file.name; }
function chooseContent(files){
  return files.find(f=>/\.html?$/i.test(f.name))
    || files.find(f=>/\.txt$/i.test(f.name))
    || files.find(f=>/\.docx$/i.test(f.name));
}
async function docToHtml(file){
  const ext = file.name.toLowerCase();
  if(ext.endsWith('.docx')){
    if(!window.mammoth) throw new Error('ยังโหลดตัวอ่าน DOCX ไม่เสร็จ กรุณาลองใหม่อีกครั้ง');
    const result = await mammoth.convertToHtml({arrayBuffer: await file.arrayBuffer()}, {styleMap:["p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","b => strong","i => em"]});
    return result.value;
  }
  const text = await file.text();
  if(ext.endsWith('.html') || ext.endsWith('.htm')){ const doc = new DOMParser().parseFromString(text,'text/html'); return doc.body.innerHTML; }
  if(/<div[^>]+class=["']mb-5["']/.test(text)) return text;
  return text.split(/\r?\n\s*\r?\n/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\r?\n/g,'<br>')}</p>`).join('');
}
function imageName(index){ return `${state.stamp}-${index}.webp`; }
function loadImage(file){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=URL.createObjectURL(file); }); }
async function convertImage(file,index,options={}){
  const img = await loadImage(file); const cover=options.cover===true; const first = index === 0 && !cover; const targetW = cover ? 1200 : (first ? 1400 : 1000); const targetH = cover ? 625 : (first ? 700 : Math.max(1,Math.round((img.naturalHeight / img.naturalWidth) * targetW)));
  const canvas=document.createElement('canvas'); canvas.width=targetW; canvas.height=targetH; const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,targetW,targetH);
  if(first||cover){ const scale=Math.max(targetW/img.naturalWidth,targetH/img.naturalHeight); const w=img.naturalWidth*scale,h=img.naturalHeight*scale; ctx.drawImage(img,(targetW-w)/2,(targetH-h)/2,w,h); } else ctx.drawImage(img,0,0,targetW,targetH);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9)); URL.revokeObjectURL(img.src); return {name:cover?`${state.stamp}-cover.webp`:imageName(index),blob,width:targetW,height:targetH,source:file.name,previewUrl:URL.createObjectURL(blob)};
}
function imageTag(image){ return `<img src="images/${image.name}" alt="${esc(image.source.replace(/\.[^.]+$/,''))}" />`; }
function insertImages(html, images){
  const tags=images.map(imageTag).join('');
  if(!tags) return html;
  return html + `\n${tags}`;
}
function htcTemplate(html){
  const title=state.title || 'HTC Journey';
  return `<!-- HTC Journey · generated locally -->\n<article class="htc-journey">\n  <h1>${esc(title)}</h1>\n  <div class="htc-journey__content">\n${html}\n  </div>\n</article>`;
}
async function process(files){
  const list=Array.from(files); state.files=list; state.title=$('#articleTitle').value.trim(); state.stamp=localStamp(dateInput.value); state.images=list.filter(f=>allowedImage.test(f.name)); const content=chooseContent(list);
  if(!content) throw new Error('ไม่พบไฟล์ DOCX, HTML หรือ TXT ในโฟลเดอร์');
  state.articleHtml=await docToHtml(content); state.outputImages=[];
  for(let i=0;i<state.images.length;i++) state.outputImages.push(await convertImage(state.images[i],i));
  const full=htcTemplate(insertImages(state.articleHtml,state.outputImages)); state.fullHtml=`<!doctype html>\n<html lang="th">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(state.title || 'HTC Journey')}</title></head>\n<body>\n${full}\n</body>\n</html>`;
  render(full,content);
}
function render(full,content){
  $('#emptyState').hidden=true; $('#fileList').hidden=false; $('#previewCard').hidden=false; $('#fileList').innerHTML=[`<div class="file-item"><span>${esc(filenameOf(content))}</span><span class="kind">CONTENT</span></div>`,...state.outputImages.map(i=>`<div class="file-item"><span>${esc(i.name)} <small>${i.width}×${i.height}</small></span><span class="kind">WEBP</span></div>`)].join(''); $('#previewArticle').innerHTML=full.match(/<div class="htc-journey__content">([\s\S]*)<\/div>/)?.[1] || full; $('#statusText').textContent=`พร้อมส่งออก · ${state.outputImages.length} ภาพ`; $('#statusMeta').textContent=`${state.stamp} · ภาพแรก 1400×700 · ภาพถัดไปกว้างไม่เกิน 1000 px`; $('#downloadHtml').disabled=false; $('#downloadZip').disabled=false;
}
async function downloadHtml(){ const blob=new Blob([state.fullHtml],{type:'text/html;charset=utf-8'}); saveBlob(blob,'htc-journey.html'); }
async function downloadZip(){ const zip=new JSZip(); zip.file('htc-journey.html',state.fullHtml); const folder=zip.folder('images'); state.outputImages.forEach(i=>folder.file(i.name,i.blob)); const blob=await zip.generateAsync({type:'blob'}); saveBlob(blob,`htc-journey-${state.stamp}.zip`); }
function saveBlob(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
input.addEventListener('change',e=>process(e.target.files).catch(err=>alert(err.message)));
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add('dragover')})); ['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove('dragover')})); dropzone.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length)process(files).catch(err=>alert(err.message))});
$('#articleTitle').addEventListener('input',()=>{if(state.files.length)process(state.files).catch(err=>alert(err.message))}); dateInput.addEventListener('change',()=>{if(state.files.length)process(state.files).catch(err=>alert(err.message))}); $('#downloadHtml').addEventListener('click',downloadHtml); $('#downloadZip').addEventListener('click',downloadZip); $('#copyHtml').addEventListener('click',copyHtml); $('#copyHtmlBottom').addEventListener('click',copyHtml); setDefaultDate();

// HTC Journey template layer: preserve the canonical newsroom wrappers/classes.
const htcStorageRoot = '/storage/newsroom/haadthip-journey';
function htcImageSrc(name){ return `${htcStorageRoot}/${state.stamp.slice(0,4)}/${state.stamp.slice(4,6)}/${name}`; }
function htcNormalizeBody(elements){
  const nodes=elements.map(html=>{const d=new DOMParser().parseFromString(html,'text/html');return d.body.firstElementChild||d.body;});
  nodes.forEach(n=>n.querySelectorAll('img[src^="data:"]').forEach(img=>img.remove()));
  nodes.forEach(n=>n.querySelectorAll('em,i').forEach(el=>el.replaceWith(...el.childNodes)));
  const cleanNodes=nodes.filter(n=>n.textContent.trim()||['ul','ol'].includes(n.tagName?.toLowerCase()));
  const ps=cleanNodes.filter(n=>n.tagName?.toLowerCase()==='p'); const last=ps.at(-1);
  return cleanNodes.map(n=>{const tag=n.tagName?.toLowerCase(); if(tag==='ul'){n.className='list list--color-green ';n.querySelectorAll('ul').forEach(u=>{if(u!==n)u.className='pl-4';});} if(tag==='ol')n.className='list-number'; if(tag==='p'&&n===last)n.className='mb-0'; return n.outerHTML||n.innerHTML;}).join('\n\t');
}
function htcStripLeadingMetadata(root){
  const thaiMonths='มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม';
  const nodes=[...root.children]; let index=0; let extractedTitle='';
  while(index<nodes.length && index<8){
    const text=nodes[index].textContent.replace(/\s+/g,' ').trim();
    if(!text){index++;continue;}
    const titleMatch=text.match(/^Content\s*\d+\s*[:：]\s*(.+)$/i);
      const isDate=new RegExp(`^(?:${thaiMonths})\\s+\\d{4}$`).test(text)||new RegExp(`^\\d{1,2}\\s+(?:${thaiMonths})\\s+\\d{4}$`).test(text);
    const isMetadata=/^(?:ประเภท|หมวดหมู่)\s*[:：]/i.test(text)||/โพสต์\s*[:：]/i.test(text);
    if(titleMatch){extractedTitle=titleMatch[1].trim();index++;continue;}
    if(isDate||isMetadata){index++;continue;}
    break;
  }
  if(extractedTitle && !state.title) state.title=extractedTitle;
  nodes.slice(0,index).forEach(node=>node.remove());
}
  function htcParseSections(html){
    state.canonicalTemplate='';
    if(/<div[^>]+class=["']mb-5["']/.test(html)){
      const templateDoc=new DOMParser().parseFromString(`<div id="template-root">${html}</div>`,'text/html');
      const templateRoot=templateDoc.querySelector('#template-root'); htcStripLeadingMetadata(templateRoot);
      state.canonicalTemplate=[...templateRoot.children].map(el=>el.outerHTML).join('\n');
    }
    const d=new DOMParser().parseFromString(`<div id="content-root">${html}</div>`,'text/html');
    const root=d.querySelector('#content-root'); htcStripLeadingMetadata(root);
    const sections=[]; let current={heading:'',body:[]};
    const normalizeText=value=>String(value||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    const isStandaloneBold=el=>{
      if(el.tagName!=='P') return false;
      const text=normalizeText(el.textContent); if(!text) return false;
      const meaningful=[...el.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE&&normalizeText(node.textContent));
      const child=el.children.length===1?el.children[0]:null;
      return meaningful.length===0&&!!child&&/^(STRONG|B)$/.test(child.tagName)&&normalizeText(child.textContent)===text;
    };
    [...root.children].forEach(el=>{
      const tag=el.tagName;
      const isHeading=/^H[1-6]$/.test(tag)||isStandaloneBold(el);
      if(isHeading){
        const heading=normalizeText(el.textContent);
        if(!current.heading&&!current.body.length&&normalizeText(state.title)===heading) return;
        if(current.heading||current.body.length) sections.push(current);
        current={heading,body:[]};
      }else if(!current.heading&&!current.body.length&&tag==='P'&&normalizeText(state.title)===normalizeText(el.textContent)){
        return;
      }else current.body.push(el.outerHTML);
    });
    if(current.heading||current.body.length||!sections.length) sections.push(current);
    return sections;
  }
function htcImgTag(image,first=false){return first?`<img alt="" class="img-fluid" src="${htcImageSrc(image.name)}" />`:`<img class="img-fluid" src="${htcImageSrc(image.name)}" />`;}
function htcFigure(image,first=false){return `<figure class="text-center ${first?'mb-4':'mb-md-0'}">${htcImgTag(image,first)}</figure>`;}
function htcRows(images){
  if(images.length===4){return `\t<div class="row justify-content-center no-gutters">\n${images.slice(0,3).map(img=>`\t\t<div class="col-md-3">\n\t\t\t${htcFigure(img)}\n\t\t</div>`).join('\n')}\n\t</div>\n\t<div class="row justify-content-center no-gutters mb-4">\n\t\t<div class="col-md-9">\n\t\t\t${htcFigure(images[3])}\n\t\t</div>\n\t</div>`;}
  const groups=images.length===3?[[images[0],images[1],images[2]]]:images.length===5?[[images[0],images[1],images[2]],[images[3],images[4]]]:[[images[0],images[1],images[2]],[images[3],images[4],images[5]]];
  const col=images.length===3||images.length>=5?'4':'5'; return groups.map((group,i)=>`\t<div class="row justify-content-center no-gutters ${i===groups.length-1?'mb-4':''}">\n${group.map(img=>`\t\t<div class="col-md-${col}">\n\t\t\t${htcFigure(img)}\n\t\t</div>`).join('\n')}\n\t</div>`).join('\n');
}
function htcLaterBlock(section,images){
  let media=''; if(images.length===1)media=`\t${htcFigure(images[0],true)}`; else if(images.length===2)media=`\t<div class="row justify-content-center no-gutters mb-4">\n${images.map(img=>`\t\t<div class="col-md-6">\n\t\t\t${htcFigure(img)}\n\t\t</div>`).join('\n')}\n\t</div>`; else if(images.length>2)media=htcRows(images);
  const body=htcNormalizeBody(section.body); const heading=section.heading?`\n\t<h6>${esc(section.heading)}</h6>`:''; return `<div class="mb-5">\n${media}${heading}${body?`\n\t${body}`:''}\n</div>`;
}
function htcFirstBlock(section,image){const body=htcNormalizeBody(section.body);return `<div class="mb-5">\n${image?`\t<figure class="text-center mb-4">${htcImgTag(image,true)}</figure>\n`:''}\t<h5 class="mb-3">${esc(section.heading||state.title||'')}</h5>${body?`\n\t${body}`:''}\n</div>`;}
function htcBuildMarkup(sections,images){
  const out=[htcFirstBlock(sections[0]||{heading:'',body:[]},images[0])]; let index=1; const later=sections.slice(1);
  later.forEach((section,i)=>{const left=later.length-i;const take=Math.min(6,Math.max(1,Math.ceil((images.length-index)/left)));const group=images.slice(index,index+take);index+=group.length;out.push(htcLaterBlock(section,group));});
  while(index<images.length){const group=images.slice(index,index+6);index+=group.length;out.push(htcLaterBlock({heading:'',body:[]},group));} return out.join('\n');
}
  function htcDocument(markup){return markup;}
  function htcTemplateImageCount(html){
    return (String(html||'').replace(/<img\b(?=[^>]*\bsrc=["']data:[^"']+["'])[^>]*>\s*/gi,'').match(/<img\b/gi)||[]).length;
  }
  function htcPreserveTemplate(html,images){
    html=html.replace(/<!--[\s\S]*?-->/g,'');
    html=html.replace(/<img\b(?=[^>]*\bsrc=["']data:[^"']+["'])[^>]*>\s*/gi,'');
    let index=0;
    return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi,(match,prefix,oldSrc,suffix)=>{
      const image=images[index];
      index++;
      return image?`${prefix}${htcImageSrc(image.name)}${suffix}`:'';
    });
  }
  function htcDocument(markup){
    if(state.canonicalTemplate){
      const html=htcPreserveTemplate(state.canonicalTemplate,state.outputImages||[]);
      state.canonicalTemplate='';
      return html;
    }
    return markup;
  }

// HTC Journey Master Template: keep the supplied wrapper/classes exactly.
function htcLaterBlock(section,images){
  let media='';
  if(images.length===1){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n\t\t<div class="col-md-8">\n\t\t\t${htcFigure(images[0])}\n\t\t</div>\n\t</div>`;
  }else if(images.length===2){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n${images.map(image=>`\t\t<div class="col-md-5">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`;
  }else if(images.length===3){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n${images.map(image=>`\t\t<div class="col-md-4">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`;
  }else if(images.length===4){
    const rows=[images.slice(0,2),images.slice(2,4)];
    media=rows.map((row,rowIndex)=>`\t<div class="row justify-content-center no-gutters${rowIndex===1?' mb-4':''}">\n${row.map(image=>`\t\t<div class="col-md-5">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`).join('\n');
  }else if(images.length===5 || images.length===6){
    const rows=[images.slice(0,3),images.slice(3)];
    media=rows.map((row,rowIndex)=>`\t<div class="row justify-content-center no-gutters${rowIndex===1?' mb-4':''}">\n${row.map(image=>`\t\t<div class="col-md-4">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`).join('\n');
  }
  const body=htcNormalizeBody(section.body);
  const heading=section.heading?`\n\t<h6>${esc(section.heading)}</h6>`:'';
  return `<div class="mb-5">\n${media}${heading}${body?`\n\t${body}`:''}\n</div>`;
}
async function process(files){
  const list=Array.from(files);state.files=list;state.title=$('#articleTitle').value.trim();state.stamp=localStamp(dateInput.value);const content=chooseContent(list);if(!content)throw new Error('ไม่พบไฟล์ DOCX, HTML หรือ TXT ในโฟลเดอร์');
  state.sections=htcParseSections(await docToHtml(content));
  const sourceImages=list.filter(f=>allowedImage.test(f.name)&&!/^\d{8}-\d{6}-(?:\d+|cover)(?:\s*\(\d+\))?\.webp$/i.test(f.name)).sort((a,b)=>filenameOf(a).localeCompare(filenameOf(b),undefined,{numeric:true,sensitivity:'base'}));
  const expectedImages=state.canonicalTemplate?htcTemplateImageCount(state.canonicalTemplate):sourceImages.length;
  state.images=sourceImages.slice(0,expectedImages);state.ignoredImages=sourceImages.slice(expectedImages);state.outputImages=[];for(let i=0;i<state.images.length;i++)state.outputImages.push(await convertImage(state.images[i],i));state.coverImage=null;
  state.articleMarkup=state.canonicalTemplate?htcPreserveTemplate(state.canonicalTemplate,state.outputImages):htcBuildMarkup(state.sections,state.outputImages);state.canonicalTemplate='';state.fullHtml=state.articleMarkup;htcRender(content);
}
function htcRender(content){
  $('#emptyState').hidden=true;$('#fileList').hidden=false;$('#previewCard').hidden=false;$('#fileList').innerHTML=[`<div class="file-item"><span>${esc(filenameOf(content))}</span><span class="kind">CONTENT</span></div>`,...(state.coverImage?[`<div class="file-item"><span>${esc(state.coverImage.name)} <small>1200×625</small></span><span class="kind">COVER</span></div>`]:[]),...state.outputImages.map(i=>`<div class="file-item"><span>${esc(i.name)} <small>${i.width}×${i.height}</small></span><span class="kind">WEBP</span></div>`)].join('');
  let preview=state.articleMarkup;state.outputImages.forEach(i=>preview=preview.replaceAll(htcImageSrc(i.name),i.previewUrl));$('#previewArticle').innerHTML=preview;$('#htmlOutput').value=state.fullHtml;$('#codeCard').hidden=false;$('#statusText').textContent=`พร้อมคัดลอกโค้ด · ${state.outputImages.length} ภาพ`;const ignored=state.ignoredImages?.length||0;$('#statusMeta').textContent=`${state.stamp} · ภาพแรก 1400×700 · ภาพถัดไปกว้าง 1000 px · Cover ให้นำไปตัดเอง 1200×625${ignored?` · ไม่ใช้รูปเกิน template ${ignored} ไฟล์`:''}`;$('#downloadHtml').disabled=false;$('#copyHtmlBottom').disabled=false;$('#downloadZip').disabled=false;
}
async function copyHtml(){
  const output=$('#htmlOutput');
  try{await navigator.clipboard.writeText(output.value);}
  catch{output.focus();output.select();document.execCommand('copy');}
  const buttons=[$('#copyHtml'),$('#copyHtmlBottom')].filter(Boolean);buttons.forEach(button=>{button.textContent='คัดลอกแล้ว ✓';setTimeout(()=>{button.textContent=button.id==='copyHtml'?'คัดลอกโค้ด':'คัดลอกโค้ด ⧉';},1400);});
}
async function downloadHtml(){saveBlob(new Blob([state.fullHtml],{type:'text/html;charset=utf-8'}),'htc-journey.html');}
async function downloadZip(){const zip=new JSZip();zip.file('htc-journey.html',state.fullHtml);const manifest=[...(state.coverImage?[{name:state.coverImage.name,width:1200,height:625,source:state.coverImage.source,type:'cover',src:htcImageSrc(state.coverImage.name)}]:[]),...state.outputImages.map(({name,width,height,source})=>({name,width,height,source,type:'article',src:htcImageSrc(name)}))];zip.file('image-manifest.json',JSON.stringify(manifest,null,2));const folder=zip.folder('images');state.outputImages.forEach(i=>folder.file(i.name,i.blob));if(state.coverImage)folder.file(state.coverImage.name,state.coverImage.blob);saveBlob(await zip.generateAsync({type:'blob'}),`htc-journey-${state.stamp}.zip`);}
