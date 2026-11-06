import { useDetailScrollLock } from '../../shared/ui/useDetailScrollLock';
import { useState } from 'react';
import { Alert, Drawer, Grid } from 'antd';
import type { UserProfile } from '../../../../shared/types';
import { LoadingState } from '../../shared/ui/LoadingState';
import { useDispatchController } from './useDispatchController';
import { TechnicianTaskDetail } from './TechnicianTaskDetail';
import './dispatch.css';
import './technician-repair.css';

export function TechnicianProjectDetail({ user, orderId, onClose }: { user: UserProfile; orderId: string; onClose: () => void }) {
  const controller = useDispatchController(user, '我的维修', orderId);
  useDetailScrollLock(true);
  const mobile = !Grid.useBreakpoint().md;
  const [photoBlocked, setPhotoBlocked] = useState(false);
  const blocked = controller.busy || photoBlocked;
  return <Drawer className="repair-task-drawer technician-task-drawer" title={controller.detail ? `${controller.detail.task.plate} · 我的维修` : '维修任务'} open size={mobile ? '100%' : 640} closable={!blocked} mask={{closable:!blocked}} onClose={() => { if (!blocked) onClose(); }} destroyOnHidden>
    {controller.detail ? <TechnicianTaskDetail controller={controller} user={user} onPhotoBlocked={setPhotoBlocked} /> : controller.detailLoading ? <LoadingState label="正在加载维修任务…" /> : controller.error ? <Alert type="error" title={controller.error} /> : null}
  </Drawer>;
}
