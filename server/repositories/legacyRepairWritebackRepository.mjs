import {executeSqlServerQuery,executeSqlServerTransaction} from '../database/sqlServerPool.mjs';
import {validateWritebackSnapshot,writebackHash,writebackDispatchAllowlist} from '../domain/repairWriteback.mjs';
export const LEGACY_REPAIR_HEADERS = `select reid,dh,RTRIM(wd) as wd,RTRIM(ch) as plate,RTRIM(bm) as department,
 RTRIM(del) as deleted,RTRIM(jsrq) as settled,RTRIM(shbz) as approved,xmfy,xmfy0,fyhj,cbhj
 from dbo.qxwxb with (updlock,holdlock) where RTRIM(pgd)=@dispatch_no`;
export const LEGACY_REPAIR_DOWNSTREAM = `select
 (select count(*) from dbo.qxpgmxb with (holdlock) where RTRIM(pgd)=@dispatch_no) as assignments,
 (select count(*) from dbo.cljgb with (holdlock) where RTRIM(pgd)=@dispatch_no) as completions,
 (select count(*) from dbo.skxcb with (holdlock) where RTRIM(pgd)=@dispatch_no) as payments,
 (select count(*) from dbo.qxthb with (holdlock) where RTRIM(pgd)=@dispatch_no) as returns`;
export function assertLegacyRepairHeaders(rows,snapshot,{checkMutable=true}={}) {
 if(!snapshot.departmentCode?.trim())throw new Error('缺少润丰部门编码，请管理员核对');
 if(rows.length<1||rows.length>2||rows.filter(r=>r.wd==='').length!==1||rows.filter(r=>r.wd==='1').length>1||rows.some(r=>!['','1'].includes(r.wd)))throw new Error('派工号内单缺失或内外单重复，禁止替换维修项目');
 if(rows.some(r=>r.plate!==snapshot.plate||r.department!==snapshot.departmentCode||Number(r.dh)!==snapshot.documentNo))throw new Error('润丰派工号对应的车辆、部门或内部单号不一致');
 if(!rows.some(r=>Number(r.reid)===snapshot.legacyReid))throw new Error('润丰主记录编号不一致');
 if(checkMutable&&rows.some(r=>r.deleted==='1'||r.settled||r.approved==='1'))throw new Error('润丰单据已删除、结算或审核，禁止替换项目');
}
export async function replaceLegacyRepairItems(snapshot,{executeTransaction=executeSqlServerTransaction,source=process.env.RUNFENG_REPAIR_WRITEBACK_SOURCE,allowedDispatchNos=writebackDispatchAllowlist()}={}) {
 validateWritebackSnapshot(snapshot);
 if(allowedDispatchNos&&!allowedDispatchNos.includes(snapshot.dispatchNo))throw new Error('当前派工号未在润丰直写测试白名单中');
 if(!source||!/^[a-zA-Z0-9_-]{1,60}$/.test(source))throw new Error('请配置唯一 RUNFENG_REPAIR_WRITEBACK_SOURCE');
 if(!/^[A-Za-z][0-9]+$/.test(snapshot.dispatchNo)||snapshot.dispatchNo.length>20)throw new Error('润丰派工号无效');
 const key=`${source}:${snapshot.eventId}`,hash=writebackHash(snapshot);
 return executeTransaction(async execute=>{
  const dispatch=(req,sql)=>req.input('dispatch_no',sql.VarChar(20),snapshot.dispatchNo);
  const receipt=(req,sql)=>req.input('event_key',sql.VarChar(150),key);
  // Serialize on the header rows before checking the durable receipt.
  const {recordset:headers}=await execute(LEGACY_REPAIR_HEADERS,dispatch);
  // Keep compatibility with receipts created when both documents were mandatory.
  assertLegacyRepairHeaders(headers||[],snapshot,{checkMutable:false});
  const previous=await execute('select payload_hash from dbo.h5_repair_writeback_receipts with (updlock,holdlock) where event_key=@event_key',receipt);
  if(previous.recordset?.[0]) {
   if(previous.recordset[0].payload_hash.trim()!==hash)throw new Error('润丰写回幂等键对应内容不一致');
   return {duplicate:true};
  }
  const pending=[];
  for(const header of headers||[]) {
   const documentKey=`${key}:${header.wd===''?'internal':'external'}`;
   const existing=await execute('select payload_hash from dbo.h5_repair_writeback_receipts with (updlock,holdlock) where event_key=@event_key',(req,sql)=>req.input('event_key',sql.VarChar(150),documentKey));
   if(existing.recordset?.[0]) {
    if(existing.recordset[0].payload_hash.trim()!==hash)throw new Error('润丰写回幂等键对应内容不一致');
   } else pending.push({...header,documentKey});
  }
  if(headers?.length&&!pending.length)return {duplicate:true};
  assertLegacyRepairHeaders(headers||[],snapshot);
  const downstream=await execute(LEGACY_REPAIR_DOWNSTREAM,dispatch);
  if(Object.values(downstream.recordset?.[0]||{}).some(n=>Number(n)>0))throw new Error('润丰已有派工明细、竣工、收款或退回记录，请人工核对后处理');
  // Validate every string before any delete, using the legacy database code page.
  for(const item of snapshot.items) {
   const worker=`${item.employeeCode.trim()} ${item.employeeName.trim()}`;
   await execute(`if DATALENGTH(CONVERT(varchar(8000),@name))>100 or CONVERT(nvarchar(200),CONVERT(varchar(8000),@name))<>@name
      or DATALENGTH(CONVERT(varchar(8000),@worker))>100 or CONVERT(nvarchar(200),CONVERT(varchar(8000),@worker))<>@worker
      raiserror(N'维修项目或负责人超出润丰字段长度或包含不支持字符',16,1)`,(req,sql)=>{req.input('name',sql.NVarChar(200),item.name);req.input('worker',sql.NVarChar(200),worker);});
  }
  for(const header of pending) {
   const target=(req,sql)=>{req.input('wd',sql.Char(1),header.wd);req.input('dh',sql.Int,Number(header.dh));};
   const totals=await execute(`select isnull(sum(je),0) as amount,isnull(sum(cb),0) as cost from dbo.qxwxmxb with (updlock,holdlock) where wd=@wd and dh=@dh and lb=N'项目'`,target);
   const amount=Number(totals.recordset?.[0]?.amount||0),cost=Number(totals.recordset?.[0]?.cost||0);
   // Unknown legacy pricing adjustments must not be silently recalculated.
   if(Number(header.xmfy||0)!==amount||![0,amount].includes(Number(header.xmfy0||0)))throw new Error('润丰项目费用合计含人工调整，请核对后再替换');
   await execute(`delete from dbo.qxwxmxb where wd=@wd and dh=@dh and lb=N'项目'`,target);
   for(const [index,item] of snapshot.items.entries())await execute(`insert into dbo.qxwxmxb(wd,dh,lb,hh,wxr,Xh)
    values(@wd,@dh,N'项目',CONVERT(varchar(100),@name),CONVERT(varchar(100),@worker),@xh)`,(req,sql)=>{
     target(req,sql);req.input('name',sql.NVarChar(200),item.name);req.input('worker',sql.NVarChar(200),header.wd===''?`${item.employeeCode.trim()} ${item.employeeName.trim()}`:'');req.input('xh',sql.SmallInt,index+1);
    });
   await execute(`update dbo.qxwxb set xmfy=0,xmfy0=0,fyhj=isnull(fyhj,0)-@amount,cbhj=isnull(cbhj,0)-@cost where reid=@reid`,(req,sql)=>{
    req.input('amount',sql.Decimal(18,4),amount);req.input('cost',sql.Decimal(18,4),cost);req.input('reid',sql.Int,Number(header.reid));
   });
   await execute(`insert into dbo.h5_repair_writeback_receipts(event_key,payload_hash,dispatch_no) values(@event_key,@hash,@dispatch_no)`,(req,sql)=>{
    req.input('event_key',sql.VarChar(150),header.documentKey);dispatch(req,sql);req.input('hash',sql.Char(64),hash);
   });
  }
  return {duplicate:false};
 });
}

// Read-only preflight uses the target database's real code page before inspection commits.
export async function validateLegacyRepairStrings(snapshot,{execute=executeSqlServerQuery}={}) {
 validateWritebackSnapshot(snapshot);
 const values=snapshot.items.flatMap(item=>[item.name,`${item.employeeCode.trim()} ${item.employeeName.trim()}`]);
 const query=values.map((_,i)=>`if DATALENGTH(CONVERT(varchar(8000),@v${i}))>100 or CONVERT(nvarchar(200),CONVERT(varchar(8000),@v${i}))<>@v${i} raiserror(N'维修项目或负责人超出润丰字段长度或包含不支持字符，请修改后重新检验',16,1)`).join('\n');
 await execute(query,(request,sql)=>values.forEach((value,i)=>request.input(`v${i}`,sql.NVarChar(200),value)));
}
