import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { collectOrderPhotoAlbums } from '../shared/orderPhotoAlbums.mjs';
import { buildOrderPhotoDocument } from '../server/services/orderPhotoDocument.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {validatePhotoCategories}=await import('../server/services/orderPhotoExportService.mjs');
const {readOrderOverview}=await import('../server/repositories/orderOverviewRepository.mjs');
const file=(id,kind,extra={})=>({id,kind,mimeType:'image/jpeg',createdAt:'2026-10-27T02:00:00Z',originalName:id,...extra});
test('albums deduplicate files, exclude replaced photos/signatures and preserve explicit completion category',()=>{
  const result=collectOrderPhotoAlbums({inspection:{replacedPhotoIds:['hidden']},files:[file('a','vehicle_license'),file('b','damage_photo'),file('hidden','other'),file('sign','signature_image'),file('pdf','other',{mimeType:'application/pdf'})]},[file('b','damage_photo'),file('c','repair_progress_photo'),file('d','repair_parts_photo'),file('e','repair_completed_photo')]);
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([key,value])=>[key,value.map(f=>f.id)])),{reception:['a','b'],repair:['c','d'],completed:['e']});
});
test('invalid and empty categories are rejected',()=>{
  for(const categories of [[],['unknown'],['repair','repair'],['toString'],['__proto__'],null])assert.throws(()=>validatePhotoCategories({categories}),error=>error.status===400);
  assert.deepEqual(validatePhotoCategories({categories:['completed','reception']}),['completed','reception']);
});
test('overview checks role and shop before reading full details',async()=>{
  const database={query:async()=>({rows:[{shop_id:'shop-a'}]})};
  await assert.rejects(()=>readOrderOverview('id',{role:'technician',active:true,shopId:'shop-a'},database),error=>error.status===403);
  for(const role of ['advisor','manager'])await assert.rejects(()=>readOrderOverview('id',{role,active:true,shopId:'shop-b'},database),error=>error.status===403);
  await assert.rejects(()=>readOrderOverview('id',{role:'advisor',active:true,shopId:'shop-a'},{query:async()=>({rows:[]})}),error=>error.status===404);
});
test('Word embeds every photo and breaks after four, contains no visible text and preserves aspect ratios',async()=>{
  const image=await sharp({create:{width:800,height:400,channels:3,background:'#446688'}}).png().toBuffer();
  const photos=Array.from({length:11},(_,i)=>({...file(String(i),'other'),uploadedName:'不应显示的维修人',category:i<5?'reception':i<10?'repair':'completed'}));
  const content=await buildOrderPhotoDocument({id:'ORDER<&>',vehicle:{plate:'测试车'},dispatchNo:'PG<&>'},photos,async()=>image);
  const zip=unzipSync(content);const document=strFromU8(zip['word/document.xml']);
  assert.equal(Object.keys(zip).filter(name=>name.startsWith('word/media/')).length,11);
  assert.equal((document.match(/w:pageBreakBefore/g)||[]).length,2);
  assert.doesNotMatch(document,/ORDER|派工号|PG&lt;|测试车|维修完成/);
  assert.equal([...document.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match=>match[1]).join(''), '');
  assert.match(document,/cx="3333750" cy="1666875"/);
  assert.doesNotMatch(document,/不应显示的维修人|2026\/10\/27|时间未记录/);
  assert.equal((document.match(/<w:tbl>/g)||[]).length,3);
  assert.equal((strFromU8(zip['word/_rels/document.xml.rels']).match(/<Relationship /g)||[]).length,11);
});
test('unreadable photo fails the export instead of silently omitting it',async()=>{
  await assert.rejects(()=>buildOrderPhotoDocument({id:'id',vehicle:{}},[{...file('missing','other'),category:'reception'}],async()=>{throw new Error('missing');}),/missing/);
});


test('a lone photo keeps the same half-row size as a full page',async()=>{
  const image=await sharp({create:{width:800,height:400,channels:3,background:'#446688'}}).png().toBuffer();
  const photo={...file('single','other'),category:'reception'};
  const order={id:'order',vehicle:{plate:'测试车'},dispatchNo:'PG001'};
  const render=async photos=>strFromU8(unzipSync(await buildOrderPhotoDocument(order,photos,async()=>image))['word/document.xml']);
  const single=await render([photo]);
  const full=await render(Array.from({length:4},(_,index)=>({...photo,id:String(index)})));
  assert.equal((single.match(/<w:gridCol /g)||[]).length,2);
  assert.equal(single.match(/<wp:extent[^>]+/)[0],full.match(/<wp:extent[^>]+/)[0]);
  assert.match(single,/cx="3333750" cy="1666875"/);
});
