import { useRef } from 'react';
import { Alert, Modal, Spin } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import { useDispatchController } from './useDispatchController';
import { DispatchActionDialog } from './DispatchActionDialog';
import './dispatch.css';

export function QuickDispatchDialog({orderId,user,onClose}:{orderId:string;user:UserProfile;onClose:()=>void}) {
  const controller=useDispatchController(user,'派工台',orderId);
  const task=controller.detail?.task;
  const ready=useRef(false);
  if(task && !controller.loading) ready.current=true;
  if (!task || !ready.current || task.stage!=='待派工' || task.needsReview) return <Modal open title="派工" footer={null} onCancel={onClose}>
    {controller.error ? <Alert type="error" title={controller.error}/> : !task || !ready.current ? <Spin/> : <Alert type="warning" title={task.needsReview?'该历史任务需要管理员先核对归属':'该订单已派工或状态已变化，请关闭窗口刷新后查看。'}/>}
  </Modal>;
  return <DispatchActionDialog action="assign" task={task} controller={controller} onClose={onClose}/>;
}
