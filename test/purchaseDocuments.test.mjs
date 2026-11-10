import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { zipSync,unzipSync } from 'fflate';
import { defaultRules,priceFor,validateRules,roundedProduct } from '../server/services/purchaseDocuments/rules.mjs';
import { readDocuments,safeUnzip } from '../server/services/purchaseDocuments/read.mjs';
import { prepareDocuments,preview } from '../server/services/purchaseDocuments/prepare.mjs';
import { exportDocuments,upperMoney } from '../server/services/purchaseDocuments/export.mjs';
import { purchaseDocumentAccess,processPurchaseDocuments } from '../server/services/purchaseDocumentService.mjs';
function file(rows,name='明细.xlsx',bookType='xlsx'){
 const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet(rows),'单据');return {name,base64:XLSX.write(b,{type:'buffer',bookType}).toString('base64')};
}
const source=(items=[['滤芯',2,10,20]])=>[['内部编号：00A01'],['车型：东风','车牌：鲁A12345'],['日期：2022.08.19'],['维修项目','数量','单价','金额'],['工时',1,200,200],['工时合计',200],['配件名称','数量','单价','金额'],...items,['配件合计']];
const user={id:'u',shopId:'shop',active:true,role:'advisor'};
test('read XLS and XLSX, preserve textual codes and isolate labor',()=>{
 for(const type of ['xls','xlsx']){const docs=readDocuments([file(source(),'明细.'+type,type==='xls'?'biff8':'xlsx')]);assert.equal(docs[0].code,'00A01');assert.equal(docs[0].items.length,1);assert.equal(docs[0].items[0].name,'滤芯');assert.equal(docs[0].date,'2022-08-19');}
});
test('exclude exact categories and below-10 boundary without removing related parts',()=>{
 const input=file(source([['电瓶',1,200,200],['电瓶支架',1,10,10],['机油',1,200,200],['机油滤芯',1,10,10],['轮胎',1,400,400],['轮胎螺丝',2,9.99,19.98],['清洗剂',1,10,10]]));
 const result=prepareDocuments(readDocuments([input]),defaultRules,'s');assert.deepEqual(result.docs[0].kept.map(i=>i.name),['电瓶支架','机油滤芯','清洗剂']);assert.equal(result.summary.excluded,4);
});
test('range is stable by normalized name/shop/range and override always wins',()=>{
 const r={...defaultRules,mode:'range',overrides:[{name:'清洗剂',kind:'percent',value:90}]};
 assert.equal(priceFor({name:'清洗 剂',price:100},r,'s').percent,90);
 const a=priceFor({name:'机油滤芯',price:100},r,'s');assert.ok(a.percent>=85&&a.percent<=90);assert.equal(priceFor({name:'机油 滤芯',price:200},r,'s').percent,a.percent);
 assert.equal(priceFor({name:'清洗剂',price:100},{...r,overrides:[{name:'清洗剂',kind:'price',value:12.5}]},'s').price,12.5);
 assert.equal(roundedProduct([10.075]),10.08);assert.equal(roundedProduct([100.05,90],2,100),90.05);assert.equal(roundedProduct([0.1,0.2]),0.02);
});
test('invalid rules, missing codes, unknown models and invalid numeric values block generation',()=>{
 assert.throws(()=>validateRules({...defaultRules,minPercent:95,maxPercent:90}));
 assert.throws(()=>validateRules({...defaultRules,dateMode:'fixed',date:'2026-02-30'}));
 const rows=source([['配件',0,20,0]]);rows[0]=['内部编号：'];rows[1]=['车型：未知'];
 const r=prepareDocuments(readDocuments([file(rows)]),defaultRules,'s');assert.equal(r.canGenerate,false);
 const rows2=source();rows2[0]=['内部编号：'];rows2[1]=['车型：未知'];const r2=prepareDocuments(readDocuments([file(rows2)]),defaultRules,'s');assert.ok(r2.issues.some(i=>i.message.includes('缺少内部编号')));assert.ok(r2.issues.some(i=>i.message.includes('尚未配置')));
});
test('ZIP, duplicates, paint split, original amounts and preview source lineage',()=>{
 const a=file(source([['滤芯',2,12.5,25],['漆及辅料',1,500,500]]));
 const zipped={name:'明细.zip',base64:Buffer.from(zipSync({'a.xlsx':Buffer.from(a.base64,'base64'),'b.xlsx':Buffer.from(a.base64,'base64')})).toString('base64')};
 const r=prepareDocuments(readDocuments([zipped]),defaultRules,'s');assert.equal(r.summary.kept,4);assert.equal(r.summary.total,1050);assert.equal(r.docs[0].template,'恒裕-吉利');assert.equal(r.docs[1].template,'海鑫源、别克荣威、福特');assert.ok(r.issues.some(i=>i.message.includes('疑似重复')));assert.equal(preview(r).lines.length,4);
});
test('read rejects corrupt files, oversized declared archives and unsupported data',()=>{
 assert.throws(()=>readDocuments([{name:'test.txt',base64:'YWJj'}]));
 assert.throws(()=>readDocuments([{name:'test.xlsx',base64:'YWJj'}]));
 assert.throws(()=>readDocuments([{name:'test.zip',base64:Buffer.from(zipSync({'bad.txt':new Uint8Array([1])})).toString('base64')}]))
 const z=Buffer.from(zipSync({'x':new Uint8Array([1])}));const central=z.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));z.writeUInt32LE(100*1024*1024,central+24);assert.throws(()=>safeUnzip(z));
});
test('all templates export numeric lines, text codes, totals, styles and print settings',async()=>{
 const models=['北京-勇士','东风','东风2082','猎豹','江铃','豪沃','依维柯'];
 const files=models.map((model,i)=>{const rows=source([['超长配件名称用于测试自动换行与打印区域适配',2,10.075,20.15],['漆及辅料',1,100,100]]);rows[1]=['车型：'+model];return file(rows,`${i}.xlsx`);});
 const r=prepareDocuments(readDocuments(files),{...defaultRules,mode:'fixed',fixedPercent:90},'s');
 const exported=unzipSync(await exportDocuments(r));assert.equal(Object.keys(exported).length,9);
 for(const [name,buffer] of Object.entries(exported)){
  const b=new ExcelJS.Workbook();await b.xlsx.load(buffer);if(name==='核对清单.xlsx')continue;
  for(const s of b.worksheets){assert.equal(s.pageSetup.fitToWidth,1);assert.ok(s.pageSetup.printArea);assert.ok(s.pageSetup.printTitlesRow);const cells=[];s.eachRow(row=>row.eachCell(c=>cells.push(c)));assert.ok(cells.some(c=>typeof c.value==='string'&&c.value.includes('内部编号：00A01')));assert.ok(cells.some(c=>c.value?.formula&&c.value.result>=0));assert.ok(cells.some(c=>c.font?.name));assert.ok(cells.some(c=>typeof c.value==='string'&&c.value.includes('金额大写：')));}
 }
 assert.equal(upperMoney(100100001.01),'壹亿零壹拾万零壹元零壹分');
});
test('role access rejects unprivileged/inactive and accepts secondary memberships',()=>{
 for(const role of ['employee','technician','warehouse','inspector','outsourcing'])assert.throws(()=>purchaseDocumentAccess({...user,role}),e=>e.status===403);
 assert.throws(()=>purchaseDocumentAccess({...user,active:false}),e=>e.status===403);purchaseDocumentAccess({...user,role:'technician',roles:['technician','manager']});
});
test('worker preview and export preserve results; concurrent same user rejected',async()=>{
 const input={files:[file(source())],rules:defaultRules};const pending=processPurchaseDocuments(user,input,'preview');
 await assert.rejects(processPurchaseDocuments(user,input,'preview'),e=>e.status===429);
 const result=await pending;assert.equal(result.summary.total,20);
 const out=await processPurchaseDocuments(user,input,'generate');assert.equal(out.name,'进货单.zip');assert.ok(Object.keys(unzipSync(Buffer.from(out.base64,'base64'))).some(n=>n==='核对清单.xlsx'));
});
test('labor line inside parts does not swallow following parts; ambiguous oils are flagged',()=>{
 const r=prepareDocuments(readDocuments([file(source([['工时费',1,100,100],['机油滤芯',1,20,20],['机油5W30',1,100,100]]))]),defaultRules,'s');
 assert.deepEqual(r.docs[0].kept.map(i=>i.name),['机油滤芯','机油5W30']);assert.equal(r.docs[0].excluded[0].reason,'服务项目');assert.ok(r.issues.some(i=>i.message.includes('机油5W30')));
});
test('zero-padded numeric codes use displayed text; broken header blocks export',()=>{
 const b=XLSX.utils.book_new(),s=XLSX.utils.aoa_to_sheet(source());s.A1={t:'s',v:'内部编号：'};s.B1={t:'n',v:123,z:'000000'};XLSX.utils.book_append_sheet(b,s,'单据');
 const docs=readDocuments([{name:'a.xlsx',base64:XLSX.write(b,{type:'buffer',bookType:'xlsx'}).toString('base64')}]);assert.equal(docs[0].code,'000123');
 const r=prepareDocuments(readDocuments([file([['内部编号：123'],['未知名称','数量','单价'],['配件',1,10]])]),defaultRules,'s');assert.equal(r.canGenerate,false);assert.ok(r.issues.some(i=>i.message.includes('无法定位')));
});
test('original-price mode never silently changes a one-cent source discrepancy',()=>{
 const r=prepareDocuments(readDocuments([file(source([['滤芯',1,20,20.01]]))]),{...defaultRules,overrides:[{name:'清洗剂',kind:'percent',value:90}]},'s');
 assert.equal(r.canGenerate,false);assert.ok(r.issues.some(i=>i.message.includes('原金额')));
});
