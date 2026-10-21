const $ = (selector) => document.querySelector(selector);
const state = { files: [], articleHtml: '', images: [], outputImages: [], stamp: '', title: '' };
const input = $('#folderInput');
const dropzone = $('#dropzone');
const allowedImage = /\.(jpe?g|png|webp|gif|bmp|svg)$/i;
const contentExt = /\.(docx?|txt|html?)$/i;
let processingRevision = 0;

function localStamp(value) {
  const date = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(date).reduce((a,p)=>(a[p.type]=p.value,a),{});
  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function filenameOf(file){ return file.webkitRelativePath || file.name; }
function isGeneratedContent(file){ return /^htc-journey(?:[-_].*)?\.html?$/i.test(file.name); }
function chooseContent(files){
  const usable=files.filter(file=>!isGeneratedContent(file));
  return usable.find(f=>/\.html?$/i.test(f.name))
    || usable.find(f=>/\.txt$/i.test(f.name))
    || usable.find(f=>/\.docx$/i.test(f.name));
}
async function htcSelectSourceImages(files,content){
  const candidates=files.filter(file=>allowedImage.test(file.name)&&!/^\d{8}-\d{6}-(?:\d+|cover)(?:\s*\(\d+\))?\.webp$/i.test(file.name));
  const parent=file=>(file.webkitRelativePath||'').replace(/\\/g,'/').split('/').slice(0,-1).join('/');
  const contentParent=parent(content);
  const direct=contentParent?candidates.filter(file=>parent(file)===contentParent):[];
  const scoped=direct.length?direct:candidates;
  const groups=new Map(),images=[],bytesByFile=new Map();
  let duplicates=0;
  for(const file of scoped){
    const key=String(file.size??'unknown');
    const matches=groups.get(key)||[];
    let duplicate=false;
    for(const previous of matches){
      if(previous===file){duplicate=true;break;}
      if(typeof previous.arrayBuffer!=='function'||typeof file.arrayBuffer!=='function')continue;
      let left=bytesByFile.get(previous),right=bytesByFile.get(file);
      if(!left){left=new Uint8Array(await previous.arrayBuffer());bytesByFile.set(previous,left);}
      if(!right){right=new Uint8Array(await file.arrayBuffer());bytesByFile.set(file,right);}
      if(left.length===right.length&&left.every((value,index)=>value===right[index])){duplicate=true;break;}
    }
    if(duplicate){duplicates++;continue;}
    matches.push(file);groups.set(key,matches);images.push(file);
  }
  images.sort((a,b)=>filenameOf(a).localeCompare(filenameOf(b),undefined,{numeric:true,sensitivity:'base'}));
  return {images,duplicates,otherFolders:candidates.length-scoped.length};
}
function htcReportImageMismatch(images,expected){
  $('#emptyState').hidden=true;$('#fileList').hidden=false;
  $('#fileList').innerHTML=images.map(file=>`<div class="file-item"><span>${esc(filenameOf(file))}</span><span class="kind">SOURCE</span></div>`).join('');
  $('#statusText').textContent=`Word ${expected} ภาพ · ไฟล์ต้นฉบับ ${images.length} ภาพ`;
  $('#statusMeta').textContent='ตรวจรายชื่อไฟล์ที่ระบบรับเข้าในรายการด้านบน';
  $('#codeCard').hidden=true;$('#previewCard').hidden=true;
  ['#downloadHtml','#downloadZip','#copyHtmlBottom'].forEach(selector=>$(selector).disabled=true);
}
async function docToHtml(file){
  const ext = file.name.toLowerCase();
  if(ext.endsWith('.docx')){
    if(!window.mammoth) throw new Error('ยังโหลดตัวอ่าน DOCX ไม่เสร็จ กรุณาลองใหม่อีกครั้ง');
    const result = await mammoth.convertToHtml({arrayBuffer: await file.arrayBuffer()}, {styleMap:["p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","b => strong","i => em"],convertImage:mammoth.images.imgElement(()=>Promise.resolve({src:'htc-source-image'}))});
    return result.value;
  }
  const text = await file.text();
  if(ext.endsWith('.html') || ext.endsWith('.htm')){ const doc = new DOMParser().parseFromString(text,'text/html'); return doc.body.innerHTML; }
  if(/<div[^>]+class=["']mb-5["']/.test(text)) return text;
  return text.split(/\r?\n\s*\r?\n/).filter(Boolean).map(p=>`<p>${esc(p).replace(/\r?\n/g,'<br>')}</p>`).join('');
}
function imageStamp(base,index=0){
  const parts=String(base||'').match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if(!parts)return base;
  const date=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3]),Number(parts[4]),Number(parts[5]),Number(parts[6])+index));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}${String(date.getUTCDate()).padStart(2,'0')}-${String(date.getUTCHours()).padStart(2,'0')}${String(date.getUTCMinutes()).padStart(2,'0')}${String(date.getUTCSeconds()).padStart(2,'0')}`;
}
function imageName(index,base=state.stamp,elapsedSeconds=0){ return `${imageStamp(base,elapsedSeconds)}-${index}.webp`; }
function loadImage(file){ return new Promise((resolve,reject)=>{ const img=new Image(); img.onload=()=>resolve(img); img.onerror=reject; img.src=URL.createObjectURL(file); }); }
async function convertImage(file,index,options={}){
  const img = await loadImage(file); const cover=options.cover===true; const first = index === 0 && !cover; const targetW = cover ? 1200 : (first ? 1400 : 1000); const targetH = cover ? 625 : (first ? 700 : Math.max(1,Math.round((img.naturalHeight / img.naturalWidth) * targetW)));
  const canvas=document.createElement('canvas'); canvas.width=targetW; canvas.height=targetH; const ctx=canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,targetW,targetH);
  if(first||cover){ const scale=Math.max(targetW/img.naturalWidth,targetH/img.naturalHeight); const w=img.naturalWidth*scale,h=img.naturalHeight*scale; ctx.drawImage(img,(targetW-w)/2,(targetH-h)/2,w,h); } else ctx.drawImage(img,0,0,targetW,targetH);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.9)); URL.revokeObjectURL(img.src); const stamp=options.stamp||state.stamp; const elapsedSeconds=options.startedAt?Math.floor((Date.now()-options.startedAt)/1000):0; return {name:cover?`${stamp}-cover.webp`:imageName(index,stamp,elapsedSeconds),blob,width:targetW,height:targetH,source:file.name,previewUrl:URL.createObjectURL(blob)};
}
function saveBlob(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
input.addEventListener('change',e=>process(e.target.files).catch(err=>alert(err.message)));
['dragenter','dragover'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.add('dragover')})); ['dragleave','drop'].forEach(type=>dropzone.addEventListener(type,e=>{e.preventDefault();dropzone.classList.remove('dragover')})); dropzone.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length)process(files).catch(err=>alert(err.message))});
$('#downloadHtml').addEventListener('click',downloadHtml); $('#downloadZip').addEventListener('click',downloadZip); $('#copyHtml').addEventListener('click',copyHtml); $('#copyHtmlBottom').addEventListener('click',copyHtml);

// HTC Journey template layer: preserve the canonical newsroom wrappers/classes.
const htcStorageRoot = '/storage/newsroom/haadthip-journey';
function htcImageSrc(name){ const parts=String(name||'').match(/^(\d{4})(\d{2})\d{2}-\d{6}-/); const year=parts?.[1]||state.stamp.slice(0,4),month=parts?.[2]||state.stamp.slice(4,6); return `${htcStorageRoot}/${year}/${month}/${name}`; }
function htcNormalizeBody(elements){
  const doc=new DOMParser().parseFromString(elements.join('\n'),'text/html');
  doc.querySelectorAll('img,script,style').forEach(node=>node.remove());
  const nodes=[...doc.body.children].filter(node=>node.textContent.trim());
  const last=nodes.at(-1);
  const paragraphs=nodes.filter(node=>node.tagName==='P');
  return nodes.map(node=>{
    if(node.tagName==='P'){
      const className=node===last?'mb-0':node===paragraphs.at(-1)&&['UL','OL'].includes(last?.tagName)?'mb-2':'';
      return `<p${className?` class="${className}"`:''}>${htcInline(node).trim()}</p>`;
    }
    if(['UL','OL'].includes(node.tagName))return htcList(node,1);
    if(node.tagName==='H5')return `<h5 class="mb-3">${htcInline(node).trim()}</h5>`;
    if(/^H[1-6]$/.test(node.tagName))return `<h6>${htcInline(node).trim()}</h6>`;
    return `<p${node===last?' class="mb-0"':''}>${htcInline(node).trim()}</p>`;
  }).join('\n\t');
}
function htcInline(node){
  return [...node.childNodes].map(child=>{
    if(child.nodeType===Node.TEXT_NODE)return child.parentElement?.tagName==='A'?htcText(child.textContent):htcTextWithLinks(child.textContent);
    if(['IMG','SCRIPT','STYLE'].includes(child.tagName))return '';
    if(child.tagName==='BR')return ' ';
    const text=htcInline(child);
    if(child.tagName==='A'&&child.getAttribute('href'))return `<a href="${htcAttr(child.getAttribute('href'))}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    return ['B','STRONG'].includes(child.tagName)?`<strong>${text}</strong>`:text;
  }).join('');
}
function htcAttr(value){return String(value||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function htcTextWithLinks(value){
  const raw=String(value||''),pattern=/https?:\/\/[^\s<>"']+/g; let output='',last=0,match;
  while((match=pattern.exec(raw))){
    output+=htcText(raw.slice(last,match.index));
    output+=`<a href="${htcAttr(match[0])}" target="_blank" rel="noopener noreferrer">${htcText(match[0])}</a>`;
    last=match.index+match[0].length;
  }
  return output+htcText(raw.slice(last));
}
function htcList(node,depth=1,nested=false){
  const tag=node.tagName.toLowerCase();
  const className=tag==='ol'?'list-number':nested?'pl-4':'list list--color-green ';
  const indent='\t'.repeat(depth);
  const lines=[`<${tag} class="${className}">`];
  for(const child of node.children){
    if(['UL','OL'].includes(child.tagName)){lines.push(`${indent}\t${htcList(child,depth+1,true)}`);continue;}
    if(child.tagName!=='LI')continue;
    const clone=child.cloneNode(true);
    const sublists=[...clone.children].filter(item=>['UL','OL'].includes(item.tagName));
    sublists.forEach(item=>item.remove());
    lines.push(`${indent}\t<li>${htcInline(clone).trim()}</li>`);
    sublists.forEach(item=>lines.push(`${indent}\t${htcList(item,depth+1,true)}`));
  }
  lines.push(`${indent}</${tag}>`);
  return lines.join('\n');
}
function htcStripLeadingMetadata(root){
  const thaiMonths='มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม';
  const nodes=[...root.children]; let index=0; let extractedTitle='';
  while(index<nodes.length && index<8){
    const text=nodes[index].textContent.replace(/\s+/g,' ').trim();
    if(!text){if(nodes[index].querySelector('img'))break;index++;continue;}
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
      const text=normalizeText(el.textContent); if(!text||text.length>160||/^["“'‘]/.test(text)) return false;
      const meaningful=[...el.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE&&normalizeText(node.textContent));
      const child=el.children.length===1?el.children[0]:null;
      return meaningful.length===0&&!!child&&/^(STRONG|B)$/.test(child.tagName)&&normalizeText(child.textContent)===text;
    };
    if(!state.canonicalTemplate&&root.querySelector('img')){
      return htcParseImagePositions(root,el=>/^H[1-6]$/.test(el.tagName));
    }
    [...root.children].forEach(el=>{
      const tag=el.tagName;
      const isHeading=/^H[1-6]$/.test(tag)||(isStandaloneBold(el)&&!current.heading&&!current.body.length);
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
function htcParseImagePositions(root,isHeading){
  const blocks=[];
  let current={imageIndices:[],content:[]},imageIndex=0;
  const isStandaloneBold=el=>{
    if(el.tagName!=='P') return false;
    const text=String(el.textContent||'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
    const meaningful=[...el.childNodes].filter(node=>node.nodeType===Node.TEXT_NODE&&String(node.textContent||'').trim());
    const child=el.children.length===1?el.children[0]:null;
    return !!text&&meaningful.length===0&&!!child&&/^(STRONG|B)$/.test(child.tagName);
  };
  const flush=()=>{if(current.imageIndices.length||current.content.length)blocks.push(current);current={imageIndices:[],content:[]};};
  const appendText=html=>{
    const doc=new DOMParser().parseFromString(html,'text/html');
    if(doc.body.textContent.trim())current.content.push(html);
  };
  function split(node){
    if(node.nodeType===Node.ELEMENT_NODE&&node.tagName==='IMG')return [{image:true}];
    if(node.nodeType!==Node.ELEMENT_NODE){const span=root.ownerDocument.createElement('span');span.textContent=node.textContent;return [{html:span.innerHTML}];}
    if(!node.querySelector('img'))return [{html:node.outerHTML}];
    const tokens=[];let buffer='';
    const text=()=>{if(buffer){const shell=node.cloneNode(false);shell.innerHTML=buffer;tokens.push({html:shell.outerHTML});buffer='';}};
    for(const child of node.childNodes){for(const token of split(child)){if(token.image){text();tokens.push(token);}else buffer+=token.html;}}
    text();return tokens;
  }
  for(const el of root.children){
    if((isHeading(el)||(isStandaloneBold(el)&&!current.content.length))&&!el.querySelector('img')){
      current.content.push(`<h6>${htcText(el.textContent.trim())}</h6>`);
    }else for(const token of split(el)){
      if(token.image){if(current.content.length)flush();current.imageIndices.push(imageIndex++);}
      else appendText(token.html);
    }
  }
  flush();return blocks;
}
function htcText(value){return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/“/g,'&ldquo;').replace(/”/g,'&rdquo;');}
function htcImgTag(image,first=false){return first?`<img alt="" class="img-fluid" src="${htcImageSrc(image.name)}" />`:`<img class="img-fluid" src="${htcImageSrc(image.name)}" />`;}
function htcFigure(image,first=false){return `<figure class="text-center ${first?'mb-4':'mb-md-0'}">${htcImgTag(image,first)}</figure>`;}
function htcFirstBlock(section,image){const body=htcNormalizeBody(section.body);return `<div class="mb-5">\n${image?`\t<figure class="text-center mb-4">${htcImgTag(image,true)}</figure>\n`:''}\t<h5 class="mb-3">${htcText(section.heading||state.title||'')}</h5>${body?`\n\t${body}`:''}\n</div>`;}
function htcBuildMarkup(sections,images){
  if(sections.some(section=>Array.isArray(section.imageIndices))){
    return sections.map((section,index)=>{
      const group=section.imageIndices.map(imageIndex=>images[imageIndex]);
      if(group.some(image=>!image))throw new Error('จำนวนรูปต้นฉบับไม่ตรงกับตำแหน่งรูปในเอกสาร');
      let content=section.content.slice();
      if(index===0){
        const heading=content.findIndex(html=>/^<h6>/.test(html));
        if(heading>=0)content[heading]=content[heading].replace(/^<h6>/,'<h5 class="mb-3">').replace(/<\/h6>$/,'</h5>');
        else content.unshift(`<h5 class="mb-3">${htcText(state.title||'')}</h5>`);
      }
      const media=index===0?group.map(image=>`\t${htcFigure(image,true)}`).join('\n'):htcMedia(group);
      const body=htcNormalizeBody(content);
      return `<div class="mb-5">\n${media}${body?`\n\t${body}`:''}\n</div>`;
    }).join('\n');
  }
  const out=[htcFirstBlock(sections[0]||{heading:'',body:[]},images[0])]; let index=1; const later=sections.slice(1);
  later.forEach((section,i)=>{const left=later.length-i;const take=Math.min(6,Math.max(1,Math.ceil((images.length-index)/left)));const group=images.slice(index,index+take);index+=group.length;out.push(htcLaterBlock(section,group));});
  while(index<images.length){const group=images.slice(index,index+6);index+=group.length;out.push(htcLaterBlock({heading:'',body:[]},group));} return out.join('\n');
}
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

// HTC Journey Master Template: keep the supplied wrapper/classes exactly.
function htcMedia(images){
  let media='';
  if(images.length===1){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n\t\t<div class="col-md-8">\n\t\t\t${htcFigure(images[0])}\n\t\t</div>\n\t</div>`;
  }else if(images.length===2){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n${images.map(image=>`\t\t<div class="col-md-5">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`;
  }else if(images.length===3){
    media=`\t<div class="row justify-content-center no-gutters mb-4">\n${images.map(image=>`\t\t<div class="col-md-4">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`;
  }else if(images.length===4){
    const portraits=images.filter(image=>image.height/image.width>=1.05);
    const landscapes=images.filter(image=>image.width/image.height>=1.05);
    if(portraits.length===3&&landscapes.length===1){
      const firstRow=portraits.map(image=>`\t\t<div class="col-md-3">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n');
      const lastRow=`\t\t<div class="col-md-9">\n\t\t\t${htcFigure(landscapes[0])}\n\t\t</div>`;
      media=`\t<div class="row justify-content-center no-gutters">\n${firstRow}\n\t</div>\n\t<div class="row justify-content-center no-gutters mb-4">\n${lastRow}\n\t</div>`;
    }else{
      const rows=[images.slice(0,2),images.slice(2,4)];
      media=rows.map((row,rowIndex)=>`\t<div class="row justify-content-center no-gutters${rowIndex===1?' mb-4':''}">\n${row.map(image=>`\t\t<div class="col-md-5">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`).join('\n');
    }
  }else if(images.length===5 || images.length===6){
    const rows=[images.slice(0,3),images.slice(3)];
    media=rows.map((row,rowIndex)=>`\t<div class="row justify-content-center no-gutters${rowIndex===1?' mb-4':''}">\n${row.map(image=>`\t\t<div class="col-md-4">\n\t\t\t${htcFigure(image)}\n\t\t</div>`).join('\n')}\n\t</div>`).join('\n');
  }
  return media;
}
function htcLaterBlock(section,images){
  const media=htcMedia(images);
  const body=htcNormalizeBody(section.body);
  const heading=section.heading?`\n\t<h6>${htcText(section.heading)}</h6>`:'';
  return `<div class="mb-5">\n${media}${heading}${body?`\n\t${body}`:''}\n</div>`;
}
async function process(files){
  const revision=++processingRevision;
  const list=Array.from(files);
  state.files=list;
  let title='';
  const stamp=localStamp();
  const content=chooseContent(list);
  if(!content)throw new Error('ไม่พบไฟล์ DOCX, HTML หรือ TXT ในโฟลเดอร์');
  const outputImages=[];
  const discard=()=>outputImages.forEach(image=>URL.revokeObjectURL(image.previewUrl));
  try{
  const html=await docToHtml(content);
  if(revision!==processingRevision)return;
  state.title=title;
  const sections=htcParseSections(html);
  title=state.title;
  const canonicalTemplate=state.canonicalTemplate;
  const selection=await htcSelectSourceImages(list,content);
  if(revision!==processingRevision)return;
  const sourceImages=selection.images;
  const positioned=sections.some(section=>Array.isArray(section.imageIndices));
  const expectedImages=canonicalTemplate?htcTemplateImageCount(canonicalTemplate):positioned?sections.reduce((total,section)=>total+section.imageIndices.length,0):sourceImages.length;
  if(positioned&&sourceImages.length!==expectedImages){htcReportImageMismatch(sourceImages,expectedImages);throw new Error(`Word มีตำแหน่งรูป ${expectedImages} ภาพ แต่พบไฟล์รูป ${sourceImages.length} ภาพ ดูรายชื่อไฟล์ที่ระบบรับเข้าในรายการด้านบน`);}
  const images=sourceImages.slice(0,expectedImages);
  const imageClockStarted=Date.now();
  for(let i=0;i<images.length;i++){
    outputImages.push(await convertImage(images[i],i,{stamp,startedAt:imageClockStarted}));
    if(revision!==processingRevision){discard();return;}
  }
  state.outputImages.forEach(image=>URL.revokeObjectURL(image.previewUrl));
  Object.assign(state,{title,stamp,sections,images,sourceSummary:selection,ignoredImages:sourceImages.slice(expectedImages),outputImages,coverImage:null,canonicalTemplate:''});
  state.articleMarkup=canonicalTemplate?htcPreserveTemplate(canonicalTemplate,outputImages):htcBuildMarkup(sections,outputImages);
  state.fullHtml=state.articleMarkup;
  htcRender(content);
  if(selection.duplicates||selection.otherFolders)$('#statusMeta').textContent+=` · ข้ามไฟล์ซ้ำ ${selection.duplicates} รายการ · ไฟล์ในโฟลเดอร์อื่น ${selection.otherFolders} รายการ`;
  }catch(error){discard();if(revision===processingRevision)throw error;}
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

const guideTrigger=$('#guideTrigger');
const guideModal=$('#guideModal');
function setGuide(open){if(!guideModal)return;guideModal.hidden=!open;document.body.style.overflow=open?'hidden':'';if(open)guideModal.querySelector('.guide-close')?.focus();}
guideTrigger?.addEventListener('click',()=>setGuide(true));
guideModal?.querySelectorAll('[data-guide-close]').forEach(button=>button.addEventListener('click',()=>setGuide(false)));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!guideModal?.hidden)setGuide(false);});
