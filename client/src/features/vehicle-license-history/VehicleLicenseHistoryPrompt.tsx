import {Alert,Button,Image,Modal,Spin} from 'antd';
import type {VehicleLicenseHistoryController} from './useVehicleLicenseHistory';
export function VehicleLicenseHistoryPrompt({controller:c}:{controller:VehicleLicenseHistoryController}) {
 return <>
  {!c.candidate&&c.error?<Alert type="warning" showIcon title={c.error} action={<Button onClick={c.retry}>重新查询行驶证</Button>}/>:null}
  <Modal open={Boolean(c.candidate)} title="这辆车之前上传过行驶证，是否复用？" closable={false} mask={{closable:false}} confirmLoading={c.busy} cancelButtonProps={{disabled:c.busy}} okText="复用历史行驶证" cancelText={c.hasCurrent?'使用本次上传':'重新上传'} onOk={()=>void c.reuse()} onCancel={c.keepCurrent}>
   <p>{c.candidate?.plate} · VIN：{c.candidate?.vin}</p>
   {c.preview?<Image src={c.preview} alt="历史行驶证，点击查看大图" style={{maxHeight:260,objectFit:'contain'}}/>:<Spin/>}
   <p>点击照片查看大图。本单只保留一张当前行驶证；保存本单后，所选照片将作为以后优先复用的版本，历史委托单照片不变。</p>
   {c.error?<Alert type="error" showIcon title={c.error}/>:null}
  </Modal>
 </>;
}
