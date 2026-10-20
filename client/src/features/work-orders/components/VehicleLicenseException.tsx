import {useState} from 'react';
import {Alert,Button,Form,Input} from 'antd';
import {FormDialog} from '../../../shared/ui/BusinessForm';
import type {VehicleLicenseException} from '../../../../../shared/types';
export function VehicleLicenseExceptionNotice({exception,current=true}:{exception:VehicleLicenseException;current?:boolean}) {
  return <Alert showIcon type="warning" title={current?'本次委托已办理行驶证缺失备案':'行驶证缺失备案对应原车辆，当前车辆仍需上传或重新备案'} description={<div style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>
    <p style={{margin:'0 0 6px'}}>说明：{exception.reason}</p>
    <span>{exception.reportedName} · {new Date(exception.reportedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}</span>
    <div>车牌：{exception.vehiclePlate} · VIN：{exception.vehicleVin}</div>
    <div>{exception.notificationStatus==='sent'?'已通知全部门店管理员':exception.notificationStatus==='queued'?'管理员通知已入队':exception.notificationStatus==='failed'?'管理员通知失败':exception.notificationStatus==='unknown'?'管理员通知结果待核对':'管理员通知待处理'}{exception.notificationError?`：${exception.notificationError}`:''}</div>
  </div>}/>;
}
export function VehicleLicenseExceptionButton({disabled,onConfirm}:{disabled:boolean;onConfirm:(reason:string)=>Promise<boolean>}) {
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function confirm() {
    if(!reason.trim()){setError('请填写本次无法提供行驶证的说明');return;}
    setBusy(true);setError('');
    try {if(await onConfirm(reason.trim()))setOpen(false);else setError('备案未完成，请检查表单提示后重试');}
    catch(e){setError(e instanceof Error?e.message:'备案失败，请重试');}
    finally{setBusy(false);}
  }
  return <><Button style={{marginTop:12}} disabled={disabled} onClick={()=>{setError('');setOpen(true);}}>本次无法提供行驶证</Button>
    <FormDialog open={open} title="本次跳过行驶证上传" okText="备案并跳过本次上传" onOk={()=>void confirm()} onCancel={()=>{if(!busy)setOpen(false);}} confirmLoading={busy} closable={!busy} cancelButtonProps={{disabled:busy}} mask={{closable:false}}>
      <Alert type="info" showIcon title="仅对本次委托单和当前车辆有效" description="新车仍应提供行驶证。确实无法提供时，请说明原因；提交后会保存草稿并通知本店所有门店管理员，不需要等待审批。" style={{marginBottom:16}}/>
      <Form layout="vertical"><Form.Item label="无法提供行驶证的说明" required validateStatus={error?'error':undefined} help={error}><Input.TextArea aria-label="无法提供行驶证的说明" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} showCount rows={4} placeholder="例如：客户遗失行驶证，暂时无法提供，已告知补办要求。" disabled={busy}/></Form.Item></Form>
    </FormDialog>
  </>;
}
