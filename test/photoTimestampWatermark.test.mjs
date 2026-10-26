import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../client/src/shared/images/prepareOcrImage.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({encodingFails = false, decodingFails = false, largeOutput = false, missingContext = false} = {}) {
  const draws = [], encoded = [], revoked = [];
  const context = {
    save(){}, restore(){}, fillRect(){},
    drawImage(){draws.push({type:'image'});},
    measureText(text){return {width:text.length * 20};},
    fillText(text,x,y){draws.push({type:'text',text,x,y,width:canvas.width,height:canvas.height});}
  };
  const canvas = {width:0,height:0,getContext(){return missingContext ? null : context;},toBlob(callback){
    encoded.push({width:this.width,height:this.height});
    callback(encodingFails ? null : {size:largeOutput && Math.max(this.width,this.height)>960 ? 600*1024 : 100});
  }};
  class Image {
    naturalWidth = 1600; naturalHeight = 1200;
    set src(value) {queueMicrotask(() => decodingFails ? this.onerror() : this.onload());}
  }
  class FileReader {
    readAsDataURL(blob){this.result=blob.original ? 'original' : 'watermarked';this.onload();}
  }
  const exports = {};
  vm.runInNewContext(compiled,{exports,Image,FileReader,Intl,performance,console:{info(){}},document:{createElement:()=>canvas},URL:{createObjectURL:()=> 'blob:photo',revokeObjectURL:url=>revoked.push(url)}});
  return {...exports,draws,encoded,revoked,canvas};
}
const file = {name:'car.png',type:'image/png',size:50,original:true};
const uploadedAt = new Date('2026-10-26T01:02:03Z');

test('small photos are encoded with a permanent Beijing upload timestamp even when larger than the original', async () => {
  const h = setup();
  const image = await h.prepareUploadPhoto(file,uploadedAt);
  assert.equal(image.imageBase64,'watermarked');
  assert.equal(image.fileName,'car.jpg');
  assert.equal(image.mimeType,'image/jpeg');
  const text = h.draws.find(draw=>draw.type==='text');
  assert.equal(text.text,'上传时间：2026-10-26 09:02:03');
  assert.ok(text.x>0 && text.y>text.height/2 && text.y<text.height);
  assert.deepEqual(h.revoked,['blob:photo']);
  assert.equal(h.canvas.width,0);
});
test('every additional size reduction redraws the timestamp before encoding', async () => {
  const h = setup({largeOutput:true});
  await h.prepareUploadPhoto(file,uploadedAt);
  assert.ok(h.encoded.length>3);
  for (const size of h.encoded) assert.ok(h.draws.some(draw=>draw.type==='text' && draw.width===size.width && draw.height===size.height));
});
test('contact details appear below the timestamp on separate lines and survive size reduction', async () => {
  const h = setup({largeOutput:true});
  await h.prepareUploadPhoto(file,uploadedAt,['联系人：张三','联系电话：13800000000']);
  for (const size of h.encoded) {
    const lines = h.draws.filter(draw=>draw.type==='text' && draw.width===size.width && draw.height===size.height);
    assert.deepEqual(lines.map(line=>line.text),['上传时间：2026-10-26 09:02:03','联系人：张三','联系电话：13800000000']);
    assert.ok(lines[0].y<lines[1].y && lines[1].y<lines[2].y && lines[2].y<size.height);
  }
});
test('empty contact lines are omitted and embedded line breaks are normalized', async () => {
  const h = setup();
  await h.prepareUploadPhoto(file,uploadedAt,['','  ','联系人：张\n三']);
  assert.deepEqual(h.draws.filter(draw=>draw.type==='text').map(draw=>draw.text),['上传时间：2026-10-26 09:02:03','联系人：张 三']);
});
test('timestamp failures reject instead of uploading an unmarked original and still release resources', async () => {
  for (const options of [{encodingFails:true},{decodingFails:true},{missingContext:true}]) {
    const h = setup(options);
    await assert.rejects(h.prepareUploadPhoto(file,uploadedAt),/照片时间水印添加失败/);
    assert.deepEqual(h.revoked,['blob:photo']);
    assert.equal(h.canvas.width,0);
  }
});
test('ordinary photos and OCR documents retain their original small-file behavior', async () => {
  const h = setup();
  assert.equal((await h.prepareUploadPhoto(file)).imageBase64,'original');
  assert.equal((await h.prepareOcrImage(file)).imageBase64,'original');
  assert.equal(h.draws.length,0);
  assert.equal(h.encoded.length,0);
  const fallback = setup({decodingFails:true});
  assert.equal((await fallback.prepareUploadPhoto(file)).imageBase64,'original');
});
