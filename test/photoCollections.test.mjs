import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const source=readFileSync(new URL('../client/src/features/work-order-photos/photoCollections.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {orderPhotoCollections,supplementaryPhotoSlot}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const file=(id,kind,mimeType='image/jpeg')=>({id,kind,mimeType,originalName:`${id}.jpg`});
const order=()=>({inspection:{preRepairPhotos:{front45:'front',rear45:'rear',mileage:'meter',extra:['extra','extra']},replacedPhotoIds:['hidden']},files:[file('front','repair_order_photo'),file('rear','repair_order_photo'),file('meter','repair_order_photo'),file('extra','repair_order_photo'),file('legacy','other'),file('damage','damage_photo'),file('hidden','other'),file('license','vehicle_license'),file('pdf','other','application/pdf'),file('progress','repair_progress_photo')]});

test('supplementary album unifies both categories, deduplicates IDs and excludes hidden/non-image/non-supplementary files',()=>{
  const original=order(),before=structuredClone(original);
  const result=orderPhotoCollections(original);
  assert.deepEqual(result.photos.extra,['extra','legacy','damage']);
  assert.deepEqual(result.supplementaryFiles.map(file=>file.id),['extra','legacy','damage']);
  assert.deepEqual(result.licenseFiles.map(file=>file.id),['license']);
  assert.deepEqual(original,before);
});
test('paper photos stay in a separate album in every paper order mode',()=>{
  for(const mode of ['pending','dingtalk','runfeng']) {
    const original=order();original.paperOrder={mode,photoIds:['legacy','paper','hidden']};original.files.push(file('paper','other'));
    const result=orderPhotoCollections(original);
    assert.deepEqual(result.photos.extra,['extra','damage']);
    assert.deepEqual(result.paperFiles.map(file=>file.id),['legacy','paper']);
  }
});
test('standard angle, license and paper references never leak into supplementary photos even in legacy data',()=>{
  const original=order();original.inspection.preRepairPhotos.extra.push('front','license');original.files.push(file('front','other'));
  const result=orderPhotoCollections(original);
  assert.deepEqual(result.photos.extra,['extra','legacy','damage']);
});
test('legacy extra references remain visible when attachment descriptions are absent',()=>{
  const original={inspection:{preRepairPhotos:{extra:['old']}},files:[]};
  assert.deepEqual(orderPhotoCollections(original).photos.extra,['old']);
  assert.equal(orderPhotoCollections(original).supplementaryFiles[0].originalName,'补充照片 1');
  assert.deepEqual(orderPhotoCollections({inspection:{}}).photos.extra,[]);
});
test('replacement routes old other/damage images to their original API slot and current extras to extra',()=>{
  const original=order();
  assert.equal(supplementaryPhotoSlot(original,'extra'),'extra');
  assert.equal(supplementaryPhotoSlot(original,'legacy'),'other');
  assert.equal(supplementaryPhotoSlot(original,'damage'),'other');
  assert.equal(supplementaryPhotoSlot(original,'old-missing-metadata'),'extra');
});

 test('license gallery shows only the selected current photo, or newest visible legacy photo',()=>{
  const original=order();
  original.files.push({...file('new-license','vehicle_license'),createdAt:'2026-10-26T10:00:00Z'});
  original.files.find(value=>value.id==='license').createdAt='2026-10-25T10:00:00Z';
  assert.deepEqual(orderPhotoCollections(original).licenseFiles.map(value=>value.id),['new-license']);
  original.inspection.vehicleLicenseFileId='license';
  assert.deepEqual(orderPhotoCollections(original).licenseFiles.map(value=>value.id),['license']);
  original.inspection.replacedPhotoIds.push('license');
  assert.deepEqual(orderPhotoCollections(original).licenseFiles.map(value=>value.id),['new-license']);
});
