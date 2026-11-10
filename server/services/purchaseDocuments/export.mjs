import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { zipSync } from 'fflate';
const clone=v=>v===undefined?undefined:structuredClone(v);
const configs={
 '中天、丰田、本田':{h:4,n:3,name:2,u:3,q:4,p:5,a:6,cols:6,date:'E3'},
 '全航':{h:7,n:3,name:2,m:4,u:5,q:6,p:7,a:8,cols:9,date:'F3'},
 '海鑫源、别克荣威、福特':{h:4,n:1,name:2,u:4,q:5,p:6,a:7,cols:7,date:'F3'},
 '鑫启金现代起亚':{h:5,n:4,name:2,m:3,u:4,q:5,p:6,a:7,cols:7,date:'E3'},
 '源青华大众、奥迪':{h:4,n:2,name:2,u:3,q:4,p:5,a:6,cols:6,date:'E3'},
 '光启豪车':{h:5,n:1,name:2,m:3,u:4,q:5,p:6,a:7,cols:7,date:'A3'},
 '恒裕-吉利':{h:5,n:1,name:2,m:3,u:4,q:5,p:6,a:7,cols:8,date:'A3'},
 '漆料':{h:4,n:1,name:2,u:3,q:4,p:5,a:6,cols:6,date:'E3'}
};
export function upperMoney(value){
 const digits='零壹贰叁肆伍陆柒捌玖';let cents=Math.round(value*100),yuan=Math.floor(cents/100);
 function group(n){let s='',zero=false;for(let p=3;p>=0;p--){const d=Math.floor(n/10**p)%10;if(d){if(zero&&s)s+='零';s+=digits[d]+['','拾','佰','仟'][p];zero=false;}else if(s)zero=true;}return s;}
 let s='',units=['','万','亿'];for(let i=2;i>=0;i--){const part=Math.floor(yuan/10000**i)%10000;if(part){if(s&&part<1000)s+='零';s+=group(part)+units[i];}}
 s=(s||'零')+'元';const j=Math.floor(cents%100/10),f=cents%10;return !j&&!f?s+'整':s+(j?digits[j]+'角':f?'零':'')+(f?digits[f]+'分':'整');
}
const safeName=v=>String(v).replace(/[\\/*?:\[\]<>|\x00-\x1f]/g,'_');
function uniqueSheet(wb,name){const base=safeName(name).slice(0,31).replace(/^'+|'+$/g,'_')||'进货单';let n=base,i=1;while(wb.getWorksheet(n))n=base.slice(0,26)+'_'+i++;return n;}
function fill(wb,src,d,items,template){
 const c=configs[template],n=Math.max(items.length,c.n),map=r=>r<c.h?r:r<=c.h+c.n?r+1:r+n-c.n+1;
 const sheet=wb.addWorksheet(uniqueSheet(wb,`${d.sheet}_${d.code}`));
 sheet.properties=clone(src.properties);sheet.views=[{showGridLines:false}];
 for(let col=1;col<=c.cols;col++)sheet.getColumn(col).width=src.getColumn(col).width||10;
 function row(from,to,clear=false){
  sheet.getRow(to).height=src.getRow(from).height||22;
  for(let col=1;col<=c.cols;col++){
   const a=src.getCell(from,col),b=sheet.getCell(to,col);b.style=clone(a.style);if(!clear&&a.type!==ExcelJS.ValueType.Merge)b.value=clone(a.value);
  }
 }
 for(let r=1;r<=src.rowCount;r++){if(r>c.h&&r<=c.h+c.n)continue;row(r,map(r));}
 for(let i=0;i<n;i++)row(c.h+1,c.h+2+i,true);
 for(const merge of src.model.merges||[]){
  const [a,b]=merge.split(':').map(x=>x.match(/([A-Z]+)(\d+)/));const r1=+a[2],r2=+b[2];
  if(r1>c.h&&r1<=c.h+c.n){if(r1===c.h+1)for(let i=0;i<n;i++)sheet.mergeCells(`${a[1]}${c.h+2+i}:${b[1]}${c.h+2+i}`);continue;}
  sheet.mergeCells(`${a[1]}${map(r1)}:${b[1]}${map(r2)}`);
 }
 sheet.mergeCells(c.h,1,c.h,c.cols);const identity=sheet.getCell(c.h,1);identity.value=`内部编号：${d.code}    车型：${d.model}    车牌：${d.plate}`;identity.font={name:'宋体',size:11,bold:true};identity.alignment={wrapText:true,vertical:'middle'};sheet.getRow(c.h).height=34;
 for(let r=1;r<c.h;r++)for(let col=1;col<=c.cols;col++){
  const cell=sheet.getCell(r,col);if(cell.type===ExcelJS.ValueType.Merge)continue;
  if(cell.value instanceof Date)cell.value=null;
  if(typeof cell.value==='string')cell.value=cell.value.replace(/20\d{2}\s*[年.\-/]\s*\d{1,2}\s*[月.\-/]\s*\d{1,2}\s*日?/g,'');
 }
 const date=sheet.getCell(c.date);date.value=c.date==='A3'?String(date.value||'').replace(/(日期[:：]).*$/,'$1')+(d.date||''):template==='鑫启金现代起亚'?(d.date||null):(template==='全航'?'业务日期：':'日期：')+(d.date||'');
 if(template==='海鑫源、别克荣威、福特'){sheet.mergeCells(`B${c.h+1}:C${c.h+1}`);for(let i=0;i<n;i++)sheet.mergeCells(`B${c.h+2+i}:C${c.h+2+i}`);}
 sheet.getColumn(c.name).width=template==='全航'?18:Math.max(sheet.getColumn(c.name).width,26);
 if(c.m)sheet.getColumn(c.m).width=19;sheet.getColumn(c.a).width=Math.max(sheet.getColumn(c.a).width,15);
 for(let i=0;i<items.length;i++){
  const item=items[i],r=c.h+2+i;sheet.getCell(r,1).value=i+1;sheet.getCell(r,c.name).value=item.name+(item.spec?`（${item.spec}）`:'');
  if(c.m)sheet.getCell(r,c.m).value=d.model;sheet.getCell(r,c.u).value=item.unit||null;
  sheet.getCell(r,c.q).value=item.qty;sheet.getCell(r,c.p).value=item.newPrice;
  sheet.getCell(r,c.a).value={formula:`ROUND(${sheet.getCell(r,c.q).address}*${sheet.getCell(r,c.p).address},2)`,result:item.newAmount};
  for(const [col,value] of [[c.q,item.qty],[c.p,item.newPrice],[c.a,item.newAmount]]){const places=(String(value).split('.')[1]||'').length;sheet.getCell(r,col).numFmt=places?'0.'+'0'.repeat(Math.min(places,8)):'0';}
  sheet.getRow(r).height=item.name.length+(item.spec?.length||0)>12?44:30;
  for(let col=1;col<=c.cols;col++)sheet.getCell(r,col).alignment={...sheet.getCell(r,col).alignment,vertical:'middle',wrapText:true};
 }
 const footer=c.h+n+2,total=items.reduce((a,i)=>a+Math.round(i.newAmount*100),0)/100;
 const text=`金额大写：${upperMoney(total)}    合计金额：￥${total}`;
 sheet.getCell(footer,1).value=template==='全航'?`金额大写：${upperMoney(total)}`:text;
 if(template==='全航')sheet.getCell(footer,7).value=`合计：￥${total}`;
 sheet.getRow(footer).height=34;
 for(let r=footer;r<=sheet.rowCount;r++)for(let col=1;col<=c.cols;col++)sheet.getCell(r,col).alignment={...sheet.getCell(r,col).alignment,wrapText:true,vertical:'middle'};
 // Footer sentences in the supplied templates rely on overflow. Give them
 // their existing visual width before enabling wrap, without shrinking fonts.
 if(template==='光启豪车')for(const r of [9,10])sheet.mergeCells(map(r),1,map(r),c.cols);
 if(template==='鑫启金现代起亚')sheet.mergeCells(map(14),1,map(14),c.cols);
 if(template==='全航'){sheet.unMergeCells(`A${map(16)}:D${map(16)}`);sheet.mergeCells(map(16),1,map(16),c.cols);}
 for(let r=footer+1;r<=sheet.rowCount;r++){
  let height=sheet.getRow(r).height||22;
  sheet.getRow(r).eachCell(cell=>{if(cell.type!==ExcelJS.ValueType.Merge&&typeof cell.value==='string'&&cell.value.length>30)height=Math.max(height,Math.ceil(cell.value.replace(/\s+/g,' ').length/48)*18);});
  sheet.getRow(r).height=height;
 }
 sheet.pageSetup={...clone(src.pageSetup),paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:${String.fromCharCode(64+c.cols)}${sheet.rowCount}`,printTitlesRow:`1:${c.h+1}`};
 return sheet.name;
}
function table(wb,name,headers,rows){const s=wb.addWorksheet(name);s.addRow(headers);for(const row of rows)s.addRow(row);s.views=[{state:'frozen',ySplit:1}];s.columns.forEach(c=>{c.width=24;});s.getRow(1).font={bold:true};s.autoFilter={from:'A1',to:{row:Math.max(1,s.rowCount),column:headers.length}};}
export async function exportDocuments(result){
 if(!result.canGenerate)throw Error('请先处理核对列表中的错误，再生成');
 const source=new ExcelJS.Workbook();await source.xlsx.readFile(fileURLToPath(new URL('../../assets/purchase-documents/templates.xlsx',import.meta.url)));
 const paint=new ExcelJS.Workbook();await paint.xlsx.readFile(fileURLToPath(new URL('../../assets/purchase-documents/paint.xlsx',import.meta.url)));
 const books=new Map(),mapping=[],lines=[],files={};let sourceIndex=0;
 for(const file of [...new Set(result.docs.map(d=>d.file))]){
  sourceIndex++;
  const name=`${sourceIndex}_${safeName(file.split('/').pop().replace(/\.xlsx?$/i,'')).slice(0,100)}_进货单.xlsx`;
  for(const d of result.docs.filter(d=>d.file===file)){
   for(const [kind,items,template,outname] of [['普通',d.kept,d.template,name],['漆料',d.paint,'漆料','漆料_进货单.xlsx']]){
    if(!items.length)continue;
    if(!books.has(outname))books.set(outname,new ExcelJS.Workbook());
    const sn=fill(books.get(outname),template==='漆料'?paint.worksheets[0]:source.getWorksheet(template),d,items,template);
    mapping.push([d.file,d.sheet,d.code,d.model,d.date,kind,template,outname,sn,items.length]);
    for(const i of items)lines.push([d.file,d.sheet,i.row,d.code,i.name,i.qty,i.price,i.percent,i.newPrice,i.newAmount,outname,sn]);
   }
  }
 }
 const audit=new ExcelJS.Workbook();
 table(audit,'单据对应',['源文件','源工作表','内部编号','车型','日期','类型','模板','输出文件','输出工作表','配件行数'],mapping);
 table(audit,'逐项核对',['源文件','源工作表','源行号','内部编号','配件','数量','原单价','比例%','新单价','金额','输出文件','输出工作表'],lines);
 table(audit,'排除清单',['源文件','源工作表','源行号','配件','原单价','原因'],result.docs.flatMap(d=>d.excluded.map(i=>[d.file,d.sheet,i.row,i.name,i.price,i.reason])));
 table(audit,'待核对',['源文件','源工作表','内部编号','源行号','事项'],result.issues.map(i=>[i.file,i.sheet,i.code,i.row||'',i.message]));
 table(audit,'配置',['设置','值'],Object.entries(result.rules).flatMap(([k,v])=>Array.isArray(v)?v.map((item,i)=>[`${k} ${i+1}`,JSON.stringify(item)]):[[k,String(v)]]));
 books.set('核对清单.xlsx',audit);
 for(const [name,book] of books)files[name]=new Uint8Array(await book.xlsx.writeBuffer());
 return zipSync(files,{level:6});
}
