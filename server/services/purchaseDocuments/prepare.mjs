import { validateRules,normalize,priceFor,exclusion,isPaint,roundedProduct,classificationWarning } from './rules.mjs';
export function prepareDocuments(docs,inputRules,shopId){
 const rules=validateRules(inputRules),issues=[],rates=new Map(),seen=new Map(),modelMap=new Map(),counts={};let hengyu=0;
 for(const rule of rules.modelRules)for(const m of rule.models.split(/[,，\n]/).map(normalize).filter(Boolean))modelMap.set(m,rule.template);
 const add=(d,message,severity='error',row)=>issues.push({file:d.file,sheet:d.sheet,code:d.code,message,severity,row});
 const prepared=docs.map((d,index)=>{
  for(const issue of d.issues)add(d,issue);
  if(d.ignored){add(d,'模板文件已跳过，不作为明细处理','warning');return {...d,id:String(index),template:'',kept:[],paint:[],excluded:[],total:0};}
  for(const key of ['code','model','plate'])if(d[key].length>200)add(d,`${key}内容过长，请核对表头识别结果`);
  const out={...d,id:String(index),template:modelMap.get(normalize(d.model))||'',kept:[],excluded:[],paint:[],total:0,date:rules.dateMode==='blank'?'':rules.dateMode==='fixed'?rules.date:d.date};
  const signature=JSON.stringify([d.code,d.model,d.plate,d.items]);
  if(seen.has(signature))add(d,`疑似重复单据（保留）：${seen.get(signature)}`,'warning');else seen.set(signature,`${d.file}/${d.sheet}`);
  for(const item of d.items){
   if(item.name.length>500||item.spec.length>500){add(d,'配件名称或规格超过500字，请检查源单','error',item.row);continue;}
   if(item.qty===null||item.qty<=0||item.qty>1000000||item.price===null||item.price<0||item.price>10000000){add(d,`${item.name}：数量或单价异常`,'error',item.row);continue;}
   const reason=exclusion(item,rules);
   if(reason){out.excluded.push({...item,reason});continue;}
   const classification=classificationWarning(item.name);if(classification)add(d,`${item.name}：${classification}`,'warning',item.row);
   const {price,percent}=priceFor(item,rules,shopId);
   const amount=roundedProduct([price,item.qty]);
   if(!Number.isSafeInteger(Math.round(amount*100))||amount>10000000000){add(d,`${item.name}：金额超出支持范围`,'error',item.row);continue;}
   if(rules.mode==='original'&&!rules.overrides.some(o=>normalize(o.name)===normalize(item.name))&&item.amount!==null&&roundedProduct([item.amount])!==amount)add(d,`${item.name}：原金额与数量×单价不一致`,'error',item.row);
   if(normalize(item.name)==='电池')add(d,'“电池”类型不明确，当前保留；如需排除请添加自定义排除名称','warning',item.row);
   if(normalize(item.name)==='期及辅料')add(d,'“期及辅料”疑似笔误，按原名列入漆料','warning',item.row);
   const v={...item,newPrice:price,newAmount:amount,percent};
   (rules.splitPaint&&isPaint(item.name)?out.paint:out.kept).push(v);
   rates.set(normalize(item.name),{name:item.name,percent,price:percent===null?price:null});
  }
  if(out.kept.length||out.paint.length){if(!d.code)add(d,'缺少内部编号，请修正源文件后重新上传');}
  if((out.kept.length||out.paint.length)&&out.template==='恒裕-吉利'&&rules.splitHengyu&&hengyu++%2===1)out.template='海鑫源、别克荣威、福特';
  if(out.kept.length){
   if(!out.template)add(d,`车型“${d.model||'空白'}”尚未配置模板`);
   counts[out.template]=(counts[out.template]||0)+1;
  }
  if(out.paint.length)counts['漆料']=(counts['漆料']||0)+1;
  if(!out.kept.length&&!out.paint.length)add(d,'筛选后无配件，不生成空单','warning');
  out.total=[...out.kept,...out.paint].reduce((a,i)=>a+Math.round(i.newAmount*100),0)/100;
  return out;
 });
 return {rules,docs:prepared,summary:{documents:prepared.filter(d=>!d.ignored).length,generated:prepared.reduce((n,d)=>n+Number(!!d.kept.length)+Number(!!d.paint.length),0),kept:prepared.reduce((n,d)=>n+d.kept.length+d.paint.length,0),excluded:prepared.reduce((n,d)=>n+d.excluded.length,0),total:prepared.reduce((n,d)=>n+Math.round(d.total*100),0)/100,templates:counts},issues,rates:[...rates.values()],canGenerate:!issues.some(i=>i.severity==='error')&&prepared.some(d=>d.kept.length||d.paint.length)};
}
export function preview(result){return {...result,lines:result.docs.flatMap(d=>[...d.kept,...d.paint].map(i=>({file:d.file,sheet:d.sheet,row:i.row,code:d.code,name:i.name,qty:i.qty,price:i.price,newPrice:i.newPrice,amount:i.newAmount}))),docs:result.docs.map(d=>({id:d.id,file:d.file,sheet:d.sheet,code:d.code,model:d.model,plate:d.plate,date:d.date,template:d.template,kept:d.kept.length,paint:d.paint.length,excluded:d.excluded.length,total:d.total})),rules:undefined};}
