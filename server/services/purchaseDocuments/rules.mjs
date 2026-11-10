import { createHash } from 'node:crypto';
export const templateNames=['光启豪车','恒裕-吉利','海鑫源、别克荣威、福特','源青华大众、奥迪','鑫启金现代起亚','全航','中天、丰田、本田'];
export const defaultModelRules=[
 {models:'北京-勇士,勇士,北京-BJ80,传祺,别克-GL8',template:'光启豪车'},
 {models:'餐车,C 餐车,东风,东风2082,东风210,东风尖头,东风-猛士',template:'恒裕-吉利'},
 {models:'丰田-巡洋舰,帕杰罗,长丰-猎豹,猎豹,猎豹V31,尼桑,日产-皮卡',template:'源青华大众、奥迪'},
 {models:'福特-新时代全顺,江淮-帅铃,江铃,江铃-皮卡,江铃-域虎,全顺',template:'鑫启金现代起亚'},
 {models:'豪沃,解放,陕汽,一汽',template:'全航'},
 {models:'依维柯,音响保障车,宇通',template:'中天、丰田、本田'}];
export const defaultRules={mode:'original',fixedPercent:90,minPercent:85,maxPercent:90,decimals:2,minOriginalPrice:10,excludeBattery:true,excludeTyre:true,excludeOil:true,splitPaint:true,splitHengyu:true,dateMode:'source',date:'',excludedNames:'',overrides:[],modelRules:defaultModelRules};
export const normalize=v=>String(v??'').replace(/\s+/g,'').trim();
export function validateRules(value){
 const r={...defaultRules,...value};
 if(!['original','fixed','range'].includes(r.mode)||![0,2].includes(r.decimals)||!['source','blank','fixed'].includes(r.dateMode))throw Error('价格或日期模式无效');
 for(const k of ['fixedPercent','minPercent','maxPercent'])if(!Number.isInteger(r[k])||r[k]<1||r[k]>200)throw Error('比例须为1–200之间的整数');
 if(r.minPercent>r.maxPercent)throw Error('浮动下限不能超过上限');
 if(!Number.isFinite(r.minOriginalPrice)||r.minOriginalPrice<0||r.minOriginalPrice>1000000)throw Error('最低原单价无效');
 for(const k of ['excludeBattery','excludeTyre','excludeOil','splitPaint','splitHengyu'])if(typeof r[k]!=='boolean')throw Error('筛选设置无效');
 if(r.dateMode==='fixed'&&(!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||new Date(r.date).toISOString().slice(0,10)!==r.date))throw Error('请填写有效日期');
 if(typeof r.excludedNames!=='string'||r.excludedNames.length>10000)throw Error('排除名称过长');
 if(!Array.isArray(r.modelRules)||r.modelRules.length>100||!Array.isArray(r.overrides)||r.overrides.length>500)throw Error('配置条数过多');
 const models=new Set(),parts=new Set();
 for(const rule of r.modelRules){
  if(!templateNames.includes(rule.template)||typeof rule.models!=='string'||rule.models.length>5000)throw Error('车型映射无效');
  for(const model of rule.models.split(/[,，\n]/).map(normalize).filter(Boolean)){if(models.has(model))throw Error(`车型重复配置：${model}`);models.add(model);}
 }
 for(const o of r.overrides){
  const name=normalize(o.name);if(!name||name.length>200||parts.has(name)||!['price','percent'].includes(o.kind)||!Number.isFinite(o.value)||o.value<0||o.value>(o.kind==='percent'?200:10000000))throw Error('配件固定价格／比例配置无效或重复');parts.add(name);
 }
 return r;
}
function fraction(value){
 const [coefficient,exp='0']=String(value).toLowerCase().split('e');
 const [whole,part='']=coefficient.split('.');const scale=part.length-Number(exp);
 return scale>=0?[BigInt(whole+part),10n**BigInt(scale)]:[BigInt(whole+part)*10n**BigInt(-scale),1n];
}
export function roundedProduct(values,places=2,divisor=1){
 let numerator=10n**BigInt(places),denominator=BigInt(divisor);
 for(const value of values){const [n,d]=fraction(value);numerator*=n;denominator*=d;}
 const rounded=(numerator*2n+denominator)/(denominator*2n);
 if(rounded>BigInt(Number.MAX_SAFE_INTEGER))throw Error('金额过大');
 return Number(rounded)/10**places;
}
export function rounded(value,places=2){return roundedProduct([value],places);}
export function priceFor(item,r,shopId){
 const key=normalize(item.name),override=r.overrides.find(x=>normalize(x.name)===key);
 let percent=100;
 if(override?.kind==='price')return {price:rounded(override.value,r.decimals),percent:null};
 if(override)percent=override.value;
 else if(r.mode==='fixed')percent=r.fixedPercent;
 else if(r.mode==='range')percent=r.minPercent+createHash('sha256').update(JSON.stringify([shopId,key,r.minPercent,r.maxPercent])).digest().readUInt32BE(0)%(r.maxPercent-r.minPercent+1);
 return {price: r.mode==='original'&&!override?item.price:roundedProduct([item.price,percent],r.decimals,100),percent};
}
const services=new Set(['工时','工时费','维修工时费','维修费','人工费','修复压缩机，换油封','修复发动机电脑、匹配编程','光刹车盘','光盘','四轮定位','定位','平衡轮胎','拖车救援','背车救援','校正倾角','校正喷油嘴','校正高压泵','清洗修复水箱','补胎','车飞轮平面','配钥匙']);
export function exclusion(item,r){
 const n=normalize(item.name);
 if(services.has(n))return '服务项目';
 if(r.excludeOil&&/^(?:柴)?机油(?:[（(].*?[）)])?$/.test(n))return '机油';
 if(r.excludeBattery&&['电瓶','装备仓电瓶','蓄电池'].includes(n))return '电瓶';
 if(r.excludeTyre&&n==='轮胎')return '轮胎';
 if(r.excludedNames.split(/[,，\n]/).map(normalize).includes(n))return '自定义排除';
 if(item.price<r.minOriginalPrice)return '原单价低于门槛';
 return '';
}
export const isPaint=name=>['漆及辅料','自喷漆','期及辅料'].includes(normalize(name));

export function classificationWarning(name){const n=normalize(name);if(/电瓶|蓄电池|轮胎|机油/.test(n)&&!/(滤|支架|卡子|螺丝|管|盖|传感器|油封|垫|开关|座|塞)/.test(n))return '名称可能涉及电瓶、轮胎或机油，当前保留；请核对并按需加入排除名称';if(/^(维修|修复|校正|更换|拆装|检测)/.test(n))return '疑似服务项目，当前保留；请核对并按需加入排除名称';return ''; }
