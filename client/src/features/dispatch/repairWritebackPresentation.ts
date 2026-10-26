import type {DispatchTask,RepairWriteback} from '../../../../shared/types';
type Presentation={type:'success'|'error'|'warning'|'info';title:string;description?:string;canRetry:boolean};
function basePresentation(task:Pick<DispatchTask,'repairRound'|'stage'|'rejectedItemIds'>,job?:RepairWriteback):Presentation|undefined {
 const currentRound=task.repairRound||0,jobRound=job?.repairRound||0;
 const historical=Boolean(job&&jobRound!==currentRound);
 // Failed historical work can block later writebacks, so keep it visible with its actual round.
 if(historical&&job&&['failed','pending'].includes(job.status))return {
  type:'warning',title:`${jobRound?`返工第 ${jobRound} 轮`:'原维修轮次'}的润丰写回${job.status==='failed'?'失败':'尚未完成'}`,
  description:job.error||'这是历史轮次的同步任务，与本轮检验结果分开记录。',canRetry:job.status==='failed'
 };
 if(task.stage!=='维修完成'&&task.rejectedItemIds?.length)return {
  type:'info',title:task.stage==='待检验'?'返工已提交，全部复检通过后才写入润丰':'本轮有退回项目，全部检验通过后才写入润丰',canRetry:false
 };
 // A past success is not evidence that this round has passed inspection or been written.
 if(!job||historical||job.status==='synced'&&task.stage!=='维修完成')return;
 const title=job.status==='manual'?(job.error?.startsWith('管理员 ')?'润丰写回已确认人工登记':'外包任务 · 润丰需人工登记'):job.status==='synced'?'本轮维修项目已写入润丰':job.status==='failed'?'本轮润丰写回失败':job.enabled?'本轮维修项目待写入润丰':'本轮维修项目待写入润丰 · 直写尚未启用';
 return {type:job.status==='synced'?'success':job.status==='failed'?'error':'info',title,description:job.error||undefined,canRetry:['failed','synced'].includes(job.status)};
}

export function repairWritebackPresentation(task:Pick<DispatchTask,'repairRound'|'stage'|'rejectedItemIds'>,job?:RepairWriteback):Presentation|undefined {
 const result=basePresentation(task,job);
 if(!result||!job?.simulated)return result;
 return {...result,title:job.status==='synced'&&result.type==='success'?'本轮维修项目模拟写回成功':`测试模拟 · ${result.title}`,
  description:['测试模拟，未写入正式润丰。',result.description].filter(Boolean).join(' ')};
}
