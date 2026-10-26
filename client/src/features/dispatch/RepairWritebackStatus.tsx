import {repairWritebackPresentation} from './repairWritebackPresentation';
import {useState} from 'react';
import {Alert,Button,Input,Modal,Space} from 'antd';
import type {DispatchController} from './useDispatchController';
import {dispatchApi} from './dispatchApi';
export function RepairWritebackStatus({controller:c,admin=false}:{controller:DispatchController;admin?:boolean}) {
 const [busy,setBusy]=useState(false),[resolveJob,setResolveJob]=useState<string>(),[reason,setReason]=useState('');
 const job=c.detail?.repairWriteback;
 const presentation=c.detail?repairWritebackPresentation(c.detail.task,job):undefined;
 if(!presentation)return null;
 async function retry(){if(!c.selectedId)return;setBusy(true);try{await dispatchApi.retryRepairWriteback(c.selectedId);await c.refreshDetail();}catch(e){c.setError(e instanceof Error?e.message:'重试失败');}finally{setBusy(false);}}
 async function resolve(){if(!c.selectedId||!resolveJob||!reason.trim())return;setBusy(true);try{await dispatchApi.resolveRepairWriteback(c.selectedId,{jobId:resolveJob,reason});setResolveJob(undefined);await c.refreshDetail();}catch(e){c.setError(e instanceof Error?e.message:'确认失败');}finally{setBusy(false);}}
 return <><Alert showIcon type={presentation.type} title={presentation.title} description={presentation.description} action={admin&&job?<Space wrap>{presentation.canRetry?<Button loading={busy} disabled={busy} onClick={()=>void retry()}>{job.simulated?'重新模拟':job.status==='synced'?'同步新增外单':'重试写回'}</Button>:null}{job.status==='failed'&&!job.simulated?<Button disabled={busy} onClick={()=>{setReason('');setResolveJob(job.id);}}>确认人工登记</Button>:null}</Space>:undefined}/>
 <Modal open={Boolean(resolveJob)} title="确认已在润丰人工登记" okText="确认已登记并解除阻塞" cancelText="取消" confirmLoading={busy} okButtonProps={{disabled:!reason.trim()||job?.id!==resolveJob||job?.status!=='failed'}} cancelButtonProps={{disabled:busy}} closable={!busy} mask={{closable:false}} onCancel={()=>{if(!busy)setResolveJob(undefined);}} onOk={()=>void resolve()}>
 <p>请先在润丰核对并登记此轮维修项目和维修人。确认后，该失败任务停止自动写入，后续轮次可继续同步。</p><p>车牌：{c.detail?.task.plate} · 任务 {resolveJob}</p>
 <Input.TextArea aria-label="人工登记说明" placeholder="填写人工登记情况和核对结果" maxLength={2000} rows={3} value={reason} onChange={e=>setReason(e.target.value)}/>{c.error?<Alert type="error" title={c.error}/>:null}
 </Modal></>;
}
