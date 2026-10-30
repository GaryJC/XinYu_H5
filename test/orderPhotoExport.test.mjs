import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { unzipSync, strFromU8 } from 'fflate';
import { collectOrderPhotoAlbums } from '../shared/orderPhotoAlbums.mjs';
import { layoutOrderPhotos, PHOTO_PAGE_WIDTH, PHOTO_PAGE_HEIGHT, PHOTO_GAP, PHOTO_MAX_WIDTH, PHOTO_MAX_HEIGHT } from '../server/services/orderPhotoLayout.mjs';
import { buildOrderPhotoDocument } from '../server/services/orderPhotoDocument.mjs';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {validatePhotoCategories}=await import('../server/services/orderPhotoExportService.mjs');
const {readOrderOverview}=await import('../server/repositories/orderOverviewRepository.mjs');
const file=(id,kind,extra={})=>({id,kind,mimeType:'image/jpeg',createdAt:'2026-10-27T02:00:00Z',originalName:id,...extra});
test('albums deduplicate files, exclude replaced photos/signatures and include historical completion photos in the repair album',()=>{
  const result=collectOrderPhotoAlbums({inspection:{replacedPhotoIds:['hidden']},files:[file('a','vehicle_license'),file('b','damage_photo'),file('hidden','other'),file('sign','signature_image'),file('pdf','other',{mimeType:'application/pdf'})]},[file('b','damage_photo'),file('c','repair_progress_photo'),file('d','repair_parts_photo'),file('e','repair_completed_photo')]);
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([key,value])=>[key,value.map(f=>f.id)])),{reception:['a','b'],repair:['c','d','e']});
});
test('invalid and empty categories are rejected',()=>{
  for(const categories of [[],['completed'],['unknown'],['repair','repair'],['toString'],['__proto__'],null])assert.throws(()=>validatePhotoCategories({categories}),error=>error.status===400);
  assert.deepEqual(validatePhotoCategories({categories:['repair','reception']}),['repair','reception']);
});
test('overview checks role and shop before reading full details',async()=>{
  const database={query:async()=>({rows:[{shop_id:'shop-a'}]})};
  await assert.rejects(()=>readOrderOverview('id',{role:'technician',active:true,shopId:'shop-a'},database),error=>error.status===403);
  for(const role of ['advisor','manager'])await assert.rejects(()=>readOrderOverview('id',{role,active:true,shopId:'shop-b'},database),error=>error.status===403);
  await assert.rejects(()=>readOrderOverview('id',{role:'advisor',active:true,shopId:'shop-a'},{query:async()=>({rows:[]})}),error=>error.status===404);
});
test('Word packs landscape photos into fewer pages, embeds every photo and preserves aspect ratios',async()=>{
  const image=await sharp({create:{width:800,height:400,channels:3,background:'#446688'}}).png().toBuffer();
  const photos=Array.from({length:11},(_,i)=>({...file(String(i),'other'),uploadedName:'不应显示的维修人',category:i<5?'reception':i<10?'repair':'completed'}));
  const content=await buildOrderPhotoDocument({id:'ORDER<&>',vehicle:{plate:'测试车'},dispatchNo:'PG<&>'},photos,async()=>image);
  const zip=unzipSync(content);const document=strFromU8(zip['word/document.xml']);
  assert.equal(Object.keys(zip).filter(name=>name.startsWith('word/media/')).length,11);
  assert.equal((document.match(/w:pageBreakBefore/g)||[]).length,0);
  assert.doesNotMatch(document,/ORDER|派工号|PG&lt;|测试车|维修完成/);
  assert.equal([...document.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match=>match[1]).join(''), '');
  for (const [, cx, cy] of document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)) assert.ok(Math.abs(Number(cx)/Number(cy)-2)<0.002);
  assert.doesNotMatch(document,/不应显示的维修人|2026\/10\/27|时间未记录/);

  assert.equal((strFromU8(zip['word/_rels/document.xml.rels']).match(/<Relationship /g)||[]).length,11);
});
test('unreadable photo fails the export instead of silently omitting it',async()=>{
  await assert.rejects(()=>buildOrderPhotoDocument({id:'id',vehicle:{}},[{...file('missing','other'),category:'reception'}],async()=>{throw new Error('missing');}),/missing/);
});


test('a lone photo stays within one third of the page instead of enlarging',async()=>{
  const image=await sharp({create:{width:800,height:400,channels:3,background:'#446688'}}).png().toBuffer();
  const document=strFromU8(unzipSync(await buildOrderPhotoDocument({},[file('single','other')],async()=>image))['word/document.xml']);
  assert.equal((document.match(/<w:gridCol /g)||[]).length,1);
  const [,cx,cy]=document.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
  assert.ok(Number(cx)<=PHOTO_MAX_WIDTH*635);
  assert.ok(Number(cy)<=PHOTO_MAX_HEIGHT*635);
  assert.ok(Math.abs(Number(cx)/Number(cy)-2)<0.002);
});

test('adaptive layouts fit the page, preserve order and proportions across mixed and extreme shapes',()=>{
  for (const ratios of [Array(12).fill(4/3),Array(9).fill(3/4),Array(11).fill(2),[0.02,50,1,0.75,1.5,2,0.5,1,1.33],Array.from({length:300},(_,i)=>[0.75,1.33,2][i%3])]) {
    const images=ratios.map(ratio=>({width:ratio*1000,height:1000}));
    const pages=layoutOrderPhotos(images);
    assert.deepEqual(pages.flat(2).map(cell=>cell.index),images.map((_,i)=>i));
    for (const rows of pages) {
      assert.ok(rows.reduce((sum,row)=>sum+Math.max(...row.map(cell=>cell.height))+2*PHOTO_GAP+60,0)<=PHOTO_PAGE_HEIGHT);
      for (const row of rows) {
        assert.ok(row.reduce((sum,cell)=>sum+cell.width+2*PHOTO_GAP,0)<=PHOTO_PAGE_WIDTH);
        for (const cell of row) {
          assert.ok(cell.width <= PHOTO_MAX_WIDTH);
          assert.ok(cell.height <= PHOTO_MAX_HEIGHT);
          assert.ok(Math.abs(cell.width-cell.height*ratios[cell.index])<=ratios[cell.index]+1);
        }
      }
    }
    if(ratios.length===12 || ratios.every(ratio=>ratio===0.75))assert.equal(pages.length,1);
    if(ratios.length===11)assert.equal(pages.length,1);
  }
});

test('single portraits, panoramas and last-page leftovers obey both size limits in Word',async()=>{
  for (const [width,height] of [[400,1600],[1600,400],[800,800]]) {
    const image=await sharp({create:{width,height,channels:3,background:'#446688'}}).png().toBuffer();
    for (const count of [1,10]) {
      const photos=Array.from({length:count},(_,i)=>file(String(i),'other'));
      const document=strFromU8(unzipSync(await buildOrderPhotoDocument({},photos,async()=>image))['word/document.xml']);
      const extents=[...document.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"/g)];
      assert.equal(extents.length,count);
      for(const [,cx,cy] of extents) {
        assert.ok(Number(cx)<=PHOTO_MAX_WIDTH*635);
        assert.ok(Number(cy)<=PHOTO_MAX_HEIGHT*635);
        assert.ok(Math.abs(Number(cx)/Number(cy)-width/height)<0.005);
      }
    }
  }
});

test('mixed neighbors and page breaks never shrink independently sized photos',()=>{
  const images=[{width:1200,height:1600},{width:1600,height:1200},{width:1200,height:1600}];
  const mixed=layoutOrderPhotos([...images,...Array(8).fill(images[0])]).flat(2);
  for(const cell of mixed){
    const image=cell.index<3?images[cell.index]:images[0];
    const alone=layoutOrderPhotos([image])[0][0][0];
    assert.equal(cell.width,alone.width);
    assert.equal(cell.height,alone.height);
  }
  assert.equal(layoutOrderPhotos([...images,...Array(8).fill(images[0])]).length,2);
  assert.equal(layoutOrderPhotos(Array(9).fill(images[0])).length,1);
});
