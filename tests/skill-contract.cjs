const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');

const skill=fs.readFileSync(process.argv[2],'utf8');
const templates=[...skill.matchAll(/```html\r?\n([\s\S]*?)\r?\n```/g)].map(match=>match[1].replace(/\r\n/g,'\n'));
const dom=new JSDOM(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),{runScripts:'outside-only'});
const w=dom.window;
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8'),dom.getInternalVMContext());
w.eval(`state.stamp='20261021-110511';window.skillState=state;window.build=htcBuildMarkup;window.normalizeBody=htcNormalizeBody;window.filenameFor=imageName;window.pathFor=htcImageSrc;window.stampFor=imageStamp;`);
const stampAt=(elapsedSeconds=0)=>{const date=new Date(Date.UTC(2026,9,21,11,5,11+elapsedSeconds));return `${date.getUTCFullYear()}${String(date.getUTCMonth()+1).padStart(2,'0')}${String(date.getUTCDate()).padStart(2,'0')}-${String(date.getUTCHours()).padStart(2,'0')}${String(date.getUTCMinutes()).padStart(2,'0')}${String(date.getUTCSeconds()).padStart(2,'0')}`;};
const images=Array.from({length:7},(_,index)=>({name:`${stampAt()}-${index}.webp`,width:1000,height:index%2?1600:600}));
const body=['<p>เนื้อหา</p>','<p>เนื้อหา</p>','<p>เนื้อหา</p>'];
const hero={imageIndices:[0],content:['<h6>หัวเรื่อง</h6>',...body]};
const fill=(template,startIndex)=>{
  let index=startIndex;
  return template.replace(/src="[^"]*"/g,()=>`src="/storage/newsroom/haadthip-journey/2026/10/${stampAt()}-${index++}.webp"`)
    .replace('<h5 class="mb-3"></h5>','<h5 class="mb-3">หัวเรื่อง</h5>').replace('<h6></h6>','<h6>หัวเรื่อง</h6>')
    .replace(/(<p(?: class="mb-0")?>)<\/p>/g,'$1เนื้อหา</p>');
};
const first=templates.find(template=>template.startsWith('<div class="mb-5">')&&template.includes('<h5 class="mb-3">'));
assert.equal(w.build([hero],images),fill(first,0),'Hero output must match SKILL.md verbatim');
assert.deepEqual([w.filenameFor(0,'20261021-110511',0),w.filenameFor(1,'20261021-110511',0),w.filenameFor(2,'20261021-110511',0)],['20261021-110511-0.webp','20261021-110511-1.webp','20261021-110511-2.webp'],'Images completed in the same second share the real timestamp');
assert.equal(w.filenameFor(2,'20261021-110511',1),'20261021-110512-2.webp','An image completed in the next real second keeps its sequence index');
assert.equal(w.stampFor('20261231-235959',1),'20270101-000000','Real elapsed second advances correctly across year boundaries');
assert.equal(w.pathFor('20261101-000000-2.webp'),'/storage/newsroom/haadthip-journey/2026/11/20261101-000000-2.webp','Image path month follows the timestamp in its filename');
for(const count of [2,3,5,6]){
  const template=templates.find(value=>value.startsWith('<div class="mb-5">')&&!value.includes('<h5')&&!value.includes('<ul')&&(value.match(/<img\b/g)||[]).length===count);
  assert.ok(template,'Skill template for '+count+' images');
  const paragraphs=[...template.matchAll(/<p(?: class="mb-0")?><\/p>/g)].map(()=>'<p>เนื้อหา</p>');
  const section={imageIndices:Array.from({length:count},(_,index)=>index+1),content:['<h6>หัวเรื่อง</h6>',...paragraphs]};
  const actual=w.build([hero,section],images).split('\n</div>\n')[1];
  assert.equal(actual,fill(template,1),count+' image layout must match SKILL.md verbatim, regardless of image ratios');
}
const customBlock=(count)=>{
  const section={imageIndices:Array.from({length:count},(_,index)=>index+1),content:['<h6>หัวเรื่อง</h6>','<p>เนื้อหา</p>']};
  return new JSDOM(w.build([hero,section],images)).window.document.body.children[1];
};
const one=customBlock(1);
assert.equal(one.firstElementChild.tagName,'FIGURE','Single-image blocks start with the standalone figure');
assert.equal(one.firstElementChild.className,'text-center mb-md-0');
assert.equal(one.querySelector('.row'),null,'Single-image blocks do not add a row or column wrapper');
const four=customBlock(4);
assert.deepEqual([...four.querySelectorAll('.row')].map(row=>[...row.children].map(col=>col.className)),[['col-md-5','col-md-5'],['col-md-5','col-md-5']],'Two portrait and two landscape images retain the 2+2 layout');
const ratioFour=[images[0],images[1],images[3],images[5],images[2]];
const ratioOutput=w.build([hero,{imageIndices:[1,2,3,4],content:['<h6>หัวเรื่อง</h6>','<p>เนื้อหา</p>']}],ratioFour);
const ratioBlock=new JSDOM(ratioOutput).window.document.body.children[1];
assert.deepEqual([...ratioBlock.querySelectorAll('.row')].map(row=>[...row.children].map(col=>col.className)),[['col-md-3','col-md-3','col-md-3'],['col-md-9']],'Three portrait and one landscape image use the source-matched 3+1 layout');
assert.deepEqual([...ratioBlock.querySelectorAll('img')].map(img=>Number(img.getAttribute('src').match(/-(\d+)\.webp$/)[1])),[1,3,5,2],'The landscape image moves to the wide lower row while filenames retain their assigned sequence');
const result=w.normalizeBody(['<p style="color:red" class="WordClass">ข้อความ <b style="font-size:20px">ตัวหนา</b> <i>ปกติ</i></p>','<ul class="WordList"><li>หนึ่ง<ul><li>ย่อย</li></ul></li><li>สอง</li></ul>','<ol><li>ตัวเลข</li></ol>']);
const parsed=new JSDOM(result).window.document;
assert.equal(parsed.querySelector('p').className,'mb-2');
assert.equal(parsed.querySelector('ul').getAttribute('class'),'list list--color-green ');
assert.equal(parsed.querySelector('ul ul').className,'pl-4');
assert.equal(parsed.querySelector('ol').className,'list-number');
assert.equal(parsed.querySelector('strong').textContent,'ตัวหนา');
assert.equal(parsed.querySelector('[style],b,i'),null);
assert.equal(parsed.querySelectorAll('p').length,1,'Lists must remain lists');
assert.equal(w.normalizeBody(['<p>แรก</p>','<p>ท้าย</p>']),'<p>แรก</p>\n\t<p class="mb-0">ท้าย</p>');
assert.equal(w.normalizeBody(['<p>100 ปี "เต้าหู้"</p>']),'<p class="mb-0">100 ปี "เต้าหู้"</p>');
console.log('Skill contract: hero, 2/3/5/6 image layouts, user-specified standalone/3+1 layouts, lists, bold and paragraphs passed.');
dom.window.close();
