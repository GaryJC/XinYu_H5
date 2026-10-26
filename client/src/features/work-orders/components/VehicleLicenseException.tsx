import {useState} from 'react';
import {Alert,Radio,Form,Input} from 'antd';
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
export function VehicleLicenseAvailability({disabled,missing=false,hasPhoto=false,onConfirm}:{disabled:boolean;missing?:boolean;hasPhoto?:boolean;onConfirm:(reason:string)=>Promise<true|string>}) {
  const [unavailable,setUnavailable]=useState(missing&&!hasPhoto);
  const [open,setOpen]=useState(false),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function confirm() {
    if(!reason.trim()){setError('请填写本次无法提供行驶证的说明');return;}
    setBusy(true);setError('');
    try {const result=await onConfirm(reason.trim());if(result===true){setUnavailable(true);setOpen(false);}else setError(result);}
    catch(e){setError(e instanceof Error?e.message:'备案失败，请重试');}
    finally{setBusy(false);}
  }
  return <><Form.Item label="本次能否提供行驶证">
    <Radio.Group aria-label="本次能否提供行驶证" disabled={disabled||busy} value={hasPhoto?false:unavailable} onChange={event=>{
      if(event.target.value){if(missing)setUnavailable(true);else{setError('');setOpen(true);}}
      else setUnavailable(false);
    }}>
      <Radio value={false}>可提供</Radio><Radio value={true} disabled={hasPhoto}>本次无法提供行驶证</Radio>
    </Radio.Group>
  </Form.Item>
    <FormDialog open={open} title="本次跳过行驶证上传" okText="备案并跳过本次上传" onOk={()=>void confirm()} onCancel={()=>{if(!busy)setOpen(false);}} confirmLoading={busy} closable={!busy} cancelButtonProps={{disabled:busy}} mask={{closable:false}}>
      <Alert type="info" showIcon title="仅对本次委托单和当前车辆有效" description="行驶证为必填资料。本次确实无法提供时，必须填写理由；备案后可继续签字，后续可在委托单详情补传。提交会保存委托单并通知本店管理员，无须等待审批。" style={{marginBottom:16}}/>
      <Form layout="vertical"><Form.Item label="无法提供行驶证的说明" required validateStatus={error?'error':undefined} help={error}><Input.TextArea aria-label="无法提供行驶证的说明" value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} showCount rows={4} placeholder="例如：客户遗失行驶证，暂时无法提供，已告知补办要求。" disabled={busy}/></Form.Item></Form>
    </FormDialog>
  </>;
}
