import { useDetailScrollLock } from '../../shared/ui/useDetailScrollLock';
import { useRef } from 'react';
import { Alert, Button, Spin } from 'antd';
import { FormDialog } from '../../shared/ui/BusinessForm';
import type { UserProfile } from '../../../../shared/types';
import { useDispatchController } from './useDispatchController';
import { DispatchActionDialog } from './DispatchActionDialog';
import './dispatch.css';

export function QuickDispatchDialog({orderId,user,onClose}:{orderId:string;user:UserProfile;onClose:()=>void}) {
  const controller=useDispatchController(user,'派工台',orderId,undefined,'detail');
  useDetailScrollLock(true);
  const task=controller.detail?.task;
  const ready=useRef(false);
  if(task && !controller.loading && !controller.error) ready.current=true;
  if (!task || !ready.current || task.stage!=='待派工' || task.needsReview) return <FormDialog open title="派工" footer={null} onCancel={onClose}>
    {controller.error ? <Alert type="error" title={controller.error} action={<Button onClick={()=>void Promise.all([controller.refresh(),controller.refreshDetail()])}>重试</Button>}/> : !task || !ready.current ? <Spin/> : <Alert type="warning" title={task.needsReview?'该历史任务需要管理员先核对归属':'该订单已派工或状态已变化，请关闭窗口刷新后查看。'}/>}
  </FormDialog>;
  return <DispatchActionDialog action="assign" task={task} controller={controller} onClose={onClose}/>;
}
