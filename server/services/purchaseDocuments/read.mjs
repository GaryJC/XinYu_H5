import XLSX from 'xlsx';
import { unzipSync } from 'fflate';
import { normalize } from './rules.mjs';
const MAX_EXPANDED=64*1024*1024;
export function safeUnzip(buffer){
 let size=0,count=0;
 return unzipSync(buffer,{filter:f=>{
  size+=f.originalSize;count++;
  if(size>MAX_EXPANDED||count>8000)throw Error('压缩包展开后过大，请分批上传');
  return true;
 }});
}
function filesFrom(input){
 if(!Array.isArray(input)||!input.length||input.length>20)throw Error('请选择1–20个Excel或ZIP文件');
 const files=[];let total=0;
 const decodeName=name=>{if(/[^\x00-\x7f]/.test(name)&&[...name].every(c=>c.charCodeAt(0)<=255)){try{return new TextDecoder('gbk',{fatal:true}).decode(Uint8Array.from(name,c=>c.charCodeAt(0)));}catch{}}return name;};
 for(const f of input){
  if(typeof f.name!=='string'||f.name.length>240||typeof f.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.base64))throw Error('上传文件无效');
  const b=Buffer.from(f.base64,'base64');total+=b.length;if(total>8*1024*1024)throw Error('文件合计不能超过8MB');
  if(/\.zip$/i.test(f.name)){
   const entries=safeUnzip(b);
   for(const [rawPath,data] of Object.entries(entries)){
    const path=decodeName(rawPath);
    if(path.startsWith('__MACOSX/')||path.split('/').some(p=>p.startsWith('.'))||path.endsWith('/'))continue;
    if(!/\.xlsx?$/i.test(path))throw Error(`ZIP中包含非Excel文件：${path}`);
    files.push({name:path,buffer:data});
   }
  }else if(/\.xlsx?$/i.test(f.name))files.push({name:f.name,buffer:b});
  else throw Error('仅支持.xls、.xlsx、.zip');
 }
 if(!files.length||files.length>100)throw Error('每次须包含1–100个Excel文件');
 if(new Set(files.map(f=>f.name)).size!==files.length)throw Error('存在同路径重名文件，请分别上传');
 return files;
}
const text=v=>String(v??'').trim();
const numeric=v=>typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'&&/^\s*\d+(?:\.\d+)?\s*$/.test(v)?Number(v):null;
export function readDocuments(input){
 const docs=[];let totalRows=0;
 for(const file of filesFrom(input)){
  if(/(?:进货单模[版板]|漆料模[版板])(?:\(\d+\))?\.xlsx?$/i.test(file.name)){docs.push({file:file.name,sheet:'',code:'',model:'',plate:'',date:'',items:[],issues:[],ignored:true});continue;}
  if(/\.xlsx$/i.test(file.name))safeUnzip(file.buffer);
  let book;try{book=XLSX.read(file.buffer,{type:'buffer',cellText:true,cellDates:false});}catch{throw Error(`无法读取：${file.name}`);}
  for(const name of book.SheetNames){
   if(docs.length>=500)throw Error('每批最多500张明细单');
   const ws=book.Sheets[name],range=XLSX.utils.decode_range(ws['!ref']||'A1');
   if(range.e.r>3000||range.e.c>100)throw Error(`${file.name}/${name}超出明细表大小限制`);
   const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:true}),display=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
   if(!raw.some(r=>r.some(v=>text(v))))continue;
   const d={file:file.name,sheet:name,code:'',model:'',plate:'',date:'',items:[],issues:[]};
   for(const row of display.slice(0,15))for(let c=0;c<row.length;c++){
    const v=text(row[c]);for(const [key,rx] of [['code',/^内部编[号码]\s*[:：]?\s*(.*)$/],['model',/^车型\s*[:：]?\s*(.*)$/],['plate',/^车牌(?:号)?\s*[:：]?\s*(.*)$/]]){
     const m=v.match(rx);if(m&&!d[key])d[key]=m[1]||text(row.slice(c+1).find(v=>text(v)));
    }
    const date=v.match(/(20\d{2})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})/);
    if(date&&!d.date){const iso=`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`;if(!Number.isNaN(Date.parse(iso))&&new Date(iso).toISOString().slice(0,10)===iso)d.date=iso;}
   }
   let found=false;
   for(let r=0;r<raw.length;r++){
    const h=raw[r].map(normalize),nc=h.findIndex(x=>['配件名称','材料名称'].includes(x));if(nc<0)continue;
    found=true;const qc=h.indexOf('数量'),pc=h.indexOf('单价'),ac=h.indexOf('金额'),uc=h.indexOf('单位'),sc=h.indexOf('规格');
    if(qc<0||pc<0){d.issues.push('配件区域缺少数量或单价表头');continue;}
    for(let rr=r+1;rr<raw.length;rr++){
     const row=raw[rr];if(row.some(v=>/^(?:(?:配件|材料|工时|维修|费用|价税|项目|金额|人民币|本页|小写|大写)费?\s*)?(?:合计|总计|小计)|^(?:维修项目|工时项目|金额大写)$/.test(text(v))))break;
     if(row.some(v=>['配件名称','材料名称'].includes(normalize(v))))break;
     const n=text(row[nc]);if(!n)continue;
     const item={row:rr+1,name:n,qty:numeric(row[qc]),price:numeric(row[pc]),amount:ac<0?null:numeric(row[ac]),unit:uc<0?'':text(row[uc]),spec:sc<0?'':text(row[sc])};
     if(!item.unit&&/^(个|只|副|套|根|条|瓶|桶|升|L|片|支|包|盒|对|米|公斤|kg)$/.test(item.spec)){item.unit=item.spec;item.spec='';}
     d.items.push(item);if(++totalRows>20000)throw Error('每批最多20000行配件');
    }
   }
   if(!found)d.issues.push('无法定位配件／材料名称表头');
   docs.push(d);
  }
 }
 if(!docs.length)throw Error('文件中没有有效工作表');
 return docs;
}
