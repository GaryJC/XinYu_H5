import {unzipSync} from 'fflate';
import {HttpError} from '../http/HttpError.mjs';
import {insuranceInput} from './vehicleInsurance.mjs';
export async function parseInsuranceWorkbook(base64) {
 if(typeof base64!=='string'||base64.length>4*1024*1024||!base64)throw new HttpError(400,'请上传不超过 3 MB 的 Excel');
 const XLSX=await import('xlsx');let workbook;
 try{const buffer=Buffer.from(base64,'base64');let size=0,entries=0;unzipSync(buffer,{filter:f=>{size+=f.originalSize;if(size>16*1024*1024||++entries>500)throw new Error('workbook too large');return false;}});workbook=XLSX.read(buffer,{type:'buffer',sheetRows:502});}catch{throw new HttpError(400,'Excel 无法读取');}
 const result=[],seen=new Set();
 const columns=['原车号','新车牌号','车型','登记及年审时间','保险终保时间','车辆状况','车辆使用部门','产权归属','投保付款单位','承保公司'];
 for(const name of workbook.SheetNames){
 if(workbook.Sheets[name]['!fullref']&&XLSX.utils.decode_range(workbook.Sheets[name]['!fullref']).e.r>=502)throw new HttpError(400,'表格超过 500 行，请分批导入');
 const rows=XLSX.utils.sheet_to_json(workbook.Sheets[name],{header:1,defval:'',raw:false});
 const head=rows.findIndex(row=>columns.every(c=>row.includes(c)));if(head<0)continue;
 for(let i=head+1;i<rows.length;i++){
 const row=rows[i];if(row.every(v=>!String(v).trim()))continue;
 if(result.length>=500)throw new HttpError(400,'单次最多导入 500 辆车');
 const get=key=>String(row[rows[head].indexOf(key)]??'').trim();
 const plate=get('新车牌号').replace(/\s/g,'').toUpperCase();
 if(!plate||seen.has(plate))throw new HttpError(400,`${name} 第 ${i+1} 行车牌为空或重复`);seen.add(plate);
 const dates=[...get('保险终保时间').matchAll(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
 if(dates.length!==2)throw new HttpError(400,`${plate} 保险时间须为起止日期，如 2026.9.3-2027.9.2`);
 const insuranceDetails=Object.fromEntries(['originalPlate','registrationNote','condition','department','owner','payer','insurer'].map((key,j)=>[key,get(['原车号','登记及年审时间','车辆状况','车辆使用部门','产权归属','投保付款单位','承保公司'][j])]));
 result.push({plate,model:get('车型'),...insuranceInput({insuranceStart:dates[0],insuranceEnd:dates[1],insuranceDetails})});
 }}
 if(!result.length)throw new HttpError(400,'未找到公司车辆保险承保明细，请使用原表列名');return result;
}
