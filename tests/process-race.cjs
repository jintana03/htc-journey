const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function verify(relativePath) {
  const elements = new Map();
  const revoked = [];
  const context = vm.createContext({
    Intl, Date, setTimeout,
    URL: { revokeObjectURL: value => revoked.push(value) },
    document: { querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, {value:'', addEventListener(){}});
      return elements.get(selector);
    } }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8'), context);
  vm.runInContext(`
    var renders=[];
    var conversions=0;
    docToHtml=async file=>{await new Promise(resolve=>setTimeout(resolve,0));return file.name;};
    htcParseSections=()=>{state.canonicalTemplate='';return [{heading:'บทความ',body:[]}];};
    htcNormalizeBody=()=>'';
    convertImage=async (file,index,options={})=>{
      await new Promise(resolve=>setTimeout(resolve,0));
      conversions++;
      return {name:(options.stamp||state.stamp)+'-'+index+'.webp',source:file.name,previewUrl:'blob:'+conversions};
    };
    htcRender=content=>renders.push({content:content.name,count:state.outputImages.length});
    function files(count,name){return [{name:name+'.docx'},...Array.from({length:count},(_,index)=>({name:index+'.jpg'}))];}
  `, context);

  await vm.runInContext(`Promise.all([process(files(17,'original')),process(files(17,'original'))])`, context);
  assert.equal(vm.runInContext('state.outputImages.length', context), 17, relativePath);
  assert.equal(vm.runInContext('(state.fullHtml.match(/<img\\b/g)||[]).length', context), 17);
  assert.equal(vm.runInContext('new Set(state.outputImages.map(image=>image.name)).size', context), 17);
  assert.equal(vm.runInContext('renders.length', context), 1);

  const pending = vm.runInContext(`process(files(17,'old'))`, context);
  await new Promise(resolve=>setTimeout(resolve,2));
  await vm.runInContext(`process(files(3,'latest'))`, context);
  await pending;
  assert.equal(vm.runInContext('state.outputImages.length', context), 3);
  assert.equal(vm.runInContext('renders.at(-1).content', context), 'latest.docx');
  assert.equal(vm.runInContext('(state.fullHtml.match(/<img\\b/g)||[]).length', context), 3);
  assert.ok(revoked.length >= 17, 'Previous preview URLs must be released');
  console.log(relativePath+': concurrent 17+17 -> 17; interrupted 17 -> 3 passed');
}

(async()=>{await verify('app.js');await verify('dist/app.js');})().catch(error=>{console.error(error);process.exitCode=1;});
