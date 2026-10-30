import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('../client/src/shared/browser/copyImage.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function setup({secure=true,denied=false,blobOnly=false,missingApi=false}={}) {
 const exports={},calls=[];let image;
 const canvas={width:0,height:0,getContext:()=>({drawImage:()=>calls.push('draw')}),toBlob(callback,type){calls.push(['encode',type,this.width,this.height]);callback(new Blob(['pixels'],{type}));}};
 vm.runInNewContext(code,{exports,Error,Blob,window:{isSecureContext:secure},document:{createElement:()=>canvas},Image:class {constructor(){image=this;this.naturalWidth=1600;this.naturalHeight=1200;}},ClipboardItem:missingApi?undefined:class {constructor(data){if(blobOnly && !(data["image/png"] instanceof Blob)){const error=new Error("Blob required");error.name="TypeError";throw error;}this.data=data;}},navigator:{clipboard:{write(items){calls.push('write');if(denied){const error=new Error('denied');error.name='NotAllowedError';return Promise.reject(error);}return Promise.resolve(items[0].data['image/png']).then(blob=>{assert.equal(blob.type,'image/png');calls.push('written');});}}}});
 return{copy:exports.copyImage,supported:exports.canCopyImage,calls,load:()=>image.onload()};
}
test('image clipboard write starts before decode, with full-resolution PNG pixels',async()=>{
 const s=setup();const result=s.copy('data:image/jpeg;base64,AA==');assert.deepEqual(s.calls,['write']);s.load();await result;
 assert.deepEqual(s.calls,['write','draw',['encode','image/png',1600,1200],'written']);
});
test('clipboard permission denial does not report success',async()=>{
 const s=setup({denied:true});await assert.rejects(s.copy('data:image/jpeg;base64,AA=='),/未允许写入剪贴板/);s.load();
});
test('insecure clients receive a usable fallback instruction',async()=>{
 const s=setup({secure:false});await assert.rejects(s.copy('data:image/jpeg;base64,AA=='),/保存图片/);assert.deepEqual(s.calls,[]);
});
test('missing original image cannot copy a link or empty content',async()=>{
 const s=setup();await assert.rejects(s.copy(''),/图片尚未加载完成/);assert.ok(!s.calls.includes('written'));
});

test('older clients accepting only Blob values still copy PNG pixels',async()=>{
 const s=setup({blobOnly:true});const result=s.copy('data:image/jpeg;base64,AA==');
 s.load();await result;assert.deepEqual(s.calls,['draw',['encode','image/png',1600,1200],'write','written']);
});
test('missing ClipboardItem disables custom copying',async()=>{
 const s=setup({missingApi:true});assert.equal(s.supported(),false);
 await assert.rejects(s.copy('data:image/jpeg;base64,AA=='),/保存图片/);assert.deepEqual(s.calls,[]);
});
