import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input } from 'antd';
import { PencilLine } from 'lucide-react';
import type { UserProfile } from '../../../../shared/types';
import { canEditDispatchDue } from '../../../../shared/dispatchDuePolicy.mjs';
import { FormDialog } from '../../shared/ui/BusinessForm';
import type { DispatchController } from './useDispatchController';
import { displayTime, localDateTime } from './dispatchLabels';

export function TaskDueDateEditor({ controller: c, user, blocked = false }: { controller: DispatchController; user: UserProfile; blocked?: boolean }) {
  const [editing, setEditing] = useState<{ orderId: string; version: number; initial: string }>();
  const [value, setValue] = useState('');
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const task = c.detail?.task;
  if (!task) return null;
  const allowed = canEditDispatchDue(task,user);
  const stale = Boolean(editing && (editing.orderId !== task.orderId || editing.version !== task.version));
  function begin() {
    if (!task || !allowed || c.busy || blocked) return;
    const initial = localDateTime(task.dueAt);
    setEditing({ orderId: task.orderId, version: task.version, initial }); setValue(initial); setFailed(false);
  }
  async function save() {
    if (!editing || !allowed || stale || c.busy || blocked || !value || value === editing.initial) return;
    const date = new Date(`${value}:00+08:00`);
    if (!Number.isFinite(date.getTime()) || localDateTime(date.toISOString()) !== value) return;
    const dueAt = date.toISOString();
    if (await c.act({ action: 'update-due', dueAt })) {
      if (mounted.current) setEditing(undefined);
    } else if (mounted.current) setFailed(true);
  }
  return <>
    <span className="task-due-display"><span>{displayTime(task.dueAt)}</span>
    {allowed && <Button type="link" size="small" icon={<PencilLine size={14} />} aria-label="编辑预计完工时间" disabled={c.busy || blocked} onClick={begin}>编辑</Button>}</span>
    <FormDialog title="修改预计完工时间" open={Boolean(editing)} onCancel={() => { if (!c.busy) setEditing(undefined); }} onOk={() => void save()} okText="保存" cancelText="取消"
      confirmLoading={c.busy} okButtonProps={{ disabled: !allowed || stale || blocked || !value || value === editing?.initial }} cancelButtonProps={{ disabled: c.busy }} closable={!c.busy} mask={{ closable: !c.busy }}>
      <p>按北京时间填写。保存后会同步更新任务列表和超期状态。</p>
      <label className="task-due-field"><span>预计完工时间</span><Input aria-label="预计完工时间" type="datetime-local" disabled={c.busy || !allowed} value={value} onChange={event => setValue(event.target.value)} /></label>
      {!allowed && <Alert type="warning" showIcon title="当前任务或账号已不允许修改预计完工时间" />}
      {stale && <Alert type="warning" showIcon title="任务已更新，请重新载入后修改" action={<Button disabled={c.busy} onClick={begin}>重新载入</Button>} />}
      {failed && c.error && <Alert type="error" showIcon title={c.error} />}
    </FormDialog>
  </>;
}
