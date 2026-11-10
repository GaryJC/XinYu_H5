import { ListPagination } from '../../shared/ui/ListPagination';
import { ActionHistory } from "../../shared/ui/ActionHistory";
import { LoadingState } from "../../shared/ui/LoadingState";
import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useState } from 'react';
import { Alert, Button, Card, Drawer, Empty, Form, Input, Modal, Select, Tag } from 'antd';
import { CarFront, ClipboardCheck, Clock3, CircleAlert } from 'lucide-react';
import { hasRole } from '../../../../shared/roles.mjs';
import type { UserProfile, VehicleTripStage } from '../../../../shared/types';
import { AuthenticatedImage } from '../../shared/ui/AuthenticatedImage';
import { useVehicleTrips } from './useVehicleTrips';
import { TripCameraInput } from './TripCameraInput';
import './vehicle-trips.css';

const time = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—';
const actions: Record<string, string> = { create: '提交申请', approve: '批准申请', reject: '驳回', cancel: '取消申请', depart: '确认出车', return: '提交还车', 'approve-return': '收车审核通过', 'reject-return': '收车审核退回' };
export function VehicleTripsPage({ user, initialScope = "all" }: { user: UserProfile; initialScope?:string }) {
  const feedback = useActionFeedback();
  const state = useVehicleTrips(initialScope);
  const [form] = Form.useForm();
  const {scope,setScope}=state;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectForm] = Form.useForm<{ reason: string }>();
  const rejectReason = Form.useWatch('reason', rejectForm) || '';
  const [excluded, setExcluded] = useState<string[]>([]);
  const manager = hasRole(user, 'manager');
  const detail = state.detail;
  const mine = detail?.applicantId === user.id;
  const stage = detail && ['待审批', '待出车'].includes(detail.status) ? 'departure' : detail?.status === '用车中' ? 'return' : undefined;
  const photoIds = detail?.attachments.filter(a => a.stage === stage && (stage !== 'return' || a.returnRound === detail.returnRound) && !excluded.includes(a.fileId)).map(a => a.fileId) || [];
  const hasApplicationPhotos = detail?.attachments.some(a => a.stage === 'departure' && a.confirmed);
  function open(id: string) { setRejectOpen(false); rejectForm.resetFields(); setExcluded([]); state.select(id); }
  function photos(phase: VehicleTripStage, title: string, returnRound?: number) {
    const items = detail?.attachments.filter(a => a.stage === phase && (returnRound === undefined || a.returnRound === returnRound)) || [];
    return items.length ? <section className="trip-section"><h3>{title}</h3><div className="trip-photos">{items.map(a => <div key={a.fileId}>
      <AuthenticatedImage fileId={a.fileId} alt={title} width={140} height={100} />
      {!a.confirmed && mine && stage === phase && <Button size="small" disabled={state.busy} onClick={() => setExcluded(current => current.includes(a.fileId) ? current.filter(id => id !== a.fileId) : [...current, a.fileId])}>{excluded.includes(a.fileId) ? '重新选用' : '不使用此照片'}</Button>}
    </div>)}</div></section> : null;
  }
  return <section className="trip-page" aria-label="出车申请">
    <header className="trip-page-heading"><div><h2>出车申请</h2></div><Button loading={state.pending === 'list'} disabled={state.busy} onClick={() => void state.refresh()}>刷新申请</Button></header>
    {state.error && <Alert type="error" showIcon title={state.error} />}
    <Card className="trip-create-card" title={<span className="trip-section-heading"><CarFront size={20} />申请用车</span>}>
      <p>驾驶员：{user.name}</p>
      <Form name="vehicle-trip-create" form={form} layout="vertical" disabled={state.busy} onFinishFailed={() => feedback.warning("请选择车辆并填写用车事由")} onFinish={async values => { if (await state.create(values)) form.resetFields(); }}>
        <Form.Item label="公司车辆" name="vehicleId" rules={[{ required: true, message: '请选择车辆' }]}>
          <Select showSearch optionFilterProp="label" placeholder="请选择公司车辆" options={state.vehicles.map(car => ({ value: car.id, label: `${car.plate} · ${car.brand} ${car.model}` }))} />
        </Form.Item>
        {!state.busy && !state.vehicles.length && <Alert type="info" title="暂无可用车辆，请联系管理员录入或启用车辆" />}
        <Form.Item label="用车事由" name="reason" rules={[{ required: true, whitespace: true, message: '请填写用车事由' }]}><Input.TextArea rows={3} maxLength={500} showCount /></Form.Item>
        <Form.Item label="备注（选填）" name="note"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
        <Form.Item label="公里数照片" required>
          <TripCameraInput label="拍摄申请用车公里数" busy={state.pending === 'prepare-photo'} disabled={state.busy || state.departurePhotos.length >= 9} onCapture={file => void state.addDeparturePhoto(file)} />
          {!!state.departurePhotos.length && <div className="trip-photos trip-application-photos">{state.departurePhotos.map((photo, index) => <div key={index}>
            <img src={photo} alt={`公里数照片 ${index + 1}`} width={140} height={100} />
            <Button size="small" disabled={state.busy} aria-label={`移除第 ${index + 1} 张公里数照片`} onClick={() => state.removeDeparturePhoto(index)}>移除照片</Button>
          </div>)}</div>}
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={state.pending === 'create'} disabled={state.busy || !state.vehicles.length}>提交出车申请</Button>
      </Form>
    </Card>
    <div className="trip-list-heading"><div><h3>{manager ? '本店申请记录' : '我的申请记录'}</h3><span className="trip-muted">共 {state.list.total} 条申请</span></div>
      <Select aria-label="筛选出车申请" value={scope} onChange={setScope} style={{ width: 140 }} options={[{ value: 'all', label: '全部记录' }, { value: 'mine', label: '我的申请' }, { value: 'pending', label: '待审批' }, { value: 'using', label: '用车中' }]} />
    </div>
    {!state.busy && !state.trips.length && <Empty description="暂无出车申请" />}
    {state.pending === 'list' && <LoadingState label="正在加载出车申请…" />}
    <div className="trip-card-grid">{state.trips.map(t => <Card className="trip-record-card" role="button" tabIndex={state.busy ? -1 : 0} aria-label={`查看申请：${t.vehicle.plate}，${t.applicantName}，${t.status}`} aria-disabled={state.busy}
      onClick={() => { if (!state.busy) open(t.id); }} onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!state.busy) open(t.id); }
      }} key={t.id} title={t.vehicle.plate} extra={<Tag color={['待审批', '待收车审核'].includes(t.status) ? 'orange' : t.status === '用车中' ? 'blue' : t.status === '已还车' ? 'green' : 'default'}>{t.status}</Tag>}>
      <p className="trip-muted">{t.vehicle.brand} {t.vehicle.model} · {t.applicantName}</p><p className="trip-record-reason">{t.reason}</p>
      <div className="trip-record-footer"><span><Clock3 size={14} />{time(t.createdAt)}</span></div>
    </Card>)}</div>
    <ListPagination mobile={state.mobile} page={state.list.page} total={state.list.total} loaded={state.trips.length} loading={state.busy} onPage={state.list.setPage} onMore={state.list.loadMore}/>
    <Drawer className="trip-detail" title="出车申请详情" open={Boolean(state.selectedId)} size="large" onClose={() => !state.busy && state.select()}>
      {state.error && <Alert type="error" showIcon title={state.error} />}
      {state.pending === 'detail' && <LoadingState label="正在加载申请详情…" />}
      {detail && <>
        <div className="trip-vehicle-summary">
          <div className="trip-vehicle-icon"><CarFront size={26} /></div>
          <div><span className="trip-eyebrow">出车申请</span><h2>{detail.vehicle.plate}</h2><p>{detail.vehicle.brand} {detail.vehicle.model}</p></div>
          <Tag color={['待审批', '待收车审核'].includes(detail.status) ? 'orange' : detail.status === '用车中' ? 'blue' : detail.status === '已还车' ? 'green' : 'default'}>{detail.status}</Tag>
        </div>
        <section className="trip-section"><h3 className="trip-section-heading"><ClipboardCheck size={18} />申请信息</h3>
          <dl className="trip-info-grid">
            <div><dt>驾驶员</dt><dd>{detail.applicantName}</dd></div><div><dt>申请时间</dt><dd>{time(detail.createdAt)}</dd></div>
            <div className="trip-info-wide"><dt>用车事由</dt><dd>{detail.reason}</dd></div>
            {detail.note && <div className="trip-info-wide"><dt>备注</dt><dd>{detail.note}</dd></div>}
          </dl>
        </section>
        <section className="trip-section"><h3 className="trip-section-heading"><Clock3 size={18} />行程与收车</h3>
          <dl className="trip-info-grid">
            <div><dt>出车时间</dt><dd>{detail.departureAt ? time(detail.departureAt) : '尚未出车'}</dd></div>
            <div><dt>还车提交时间</dt><dd>{detail.returnAt ? time(detail.returnAt) : '尚未还车'}</dd></div>
            <div className="trip-info-wide"><dt>出车审批</dt><dd>{detail.approvedName ? `${detail.approvedName} · ${time(detail.approvedAt)}` : detail.status === '待审批' ? '等待管理员审批' : '—'}</dd></div>

          </dl>
        </section>
        {detail.rejectionReason && <Alert type="warning" title={`驳回原因：${detail.rejectionReason}`} />}
        {detail.returnRejectionReason && <Alert className="trip-return-feedback" type="warning" showIcon title={`收车退回：${detail.returnRejectionReason}`} />}
        {photos('departure', detail.departureEvidence === 'license' ? '申请行驶证照片' : '申请公里数照片')}{photos('return', '本次收车公里数照片', detail.returnRound)}
        {[...new Set(detail.attachments.filter(a => a.stage === 'return' && a.confirmed && a.returnRound < detail.returnRound).map(a => a.returnRound))].map(round => <div key={round}>{photos('return', `第 ${round} 次还车照片（已退回）`, round)}</div>)}
        {manager && !mine && detail.status === '待审批' && <section className="trip-section trip-approval">
          <h3 className="trip-section-heading"><ClipboardCheck size={18} />出车审批</h3>
          <div className="trip-approval-actions">
            <Button type="primary" loading={state.pending === 'approve'} disabled={state.busy} onClick={() => void state.act('approve')}>批准并出车</Button>
            <Button danger disabled={state.busy} onClick={() => { rejectForm.resetFields(); setRejectOpen(true); }}>驳回申请</Button>
          </div>
        </section>}
        {mine && manager && detail.status === '待审批' && <Alert type="info" title="请等待另一名门店管理员审批出车" />}
        {mine && stage && (detail.status !== '待审批' || !hasApplicationPhotos) && <section className="trip-section">
          <h3>{detail.status === '待审批' ? '补充申请照片' : stage === 'departure' ? '出车登记' : '还车登记'}</h3>
          {(stage === 'return' || !hasApplicationPhotos) && <div className="trip-capture-section">
            <TripCameraInput license={stage === 'departure' && detail.departureEvidence === 'license'} label={stage === 'departure' ? '上传申请照片' : '上传收车公里数照片'} busy={state.pending === 'upload'} disabled={state.busy || photoIds.length >= 9} onCapture={file => void state.upload(file, stage)} />
            <p>已选 {photoIds.length} 张照片（最多 9 张）</p>
          </div>}
          {detail.status !== '待审批' && <Button type="primary" loading={state.pending === 'depart' || state.pending === 'return'} disabled={state.busy || !photoIds.length} onClick={() => void state.act(stage === 'departure' ? 'depart' : 'return', { fileIds: photoIds })}>{stage === 'departure' ? '确认出车' : '确认还车'}</Button>}
        </section>}
        {mine && ['待审批', '待出车'].includes(detail.status) && <Button danger loading={state.pending === 'cancel'} disabled={state.busy} onClick={() => void state.act('cancel')}>取消申请</Button>}
        <ActionHistory title="操作记录" items={detail.history.map((entry,index)=>({key:index,title:actions[entry.action]||entry.action,actor:entry.actorName,time:time(entry.at)}))}/>
      </>}
    </Drawer>
    <Modal className="trip-reject-modal" centered width={480} title={<span className="trip-reject-title"><span><CircleAlert size={22} /></span>驳回申请</span>} open={rejectOpen && Boolean(detail) && detail?.status === '待审批'}
      okText="确认驳回" cancelText="取消" okButtonProps={{ danger: true }} confirmLoading={state.pending === 'reject'}
      onOk={() => rejectForm.submit()} onCancel={() => { if (!state.busy) setRejectOpen(false); }}>
      <p className="trip-reject-description">请填写驳回原因。</p>
      <div className="trip-reject-context"><span>{detail?.vehicle.plate}</span><span>申请人 · {detail?.applicantName}</span></div>
      {state.error && <Alert type="error" showIcon title={state.error} />}
      <Form name="vehicle-trip-reject" form={rejectForm} layout="vertical" disabled={state.busy} onFinishFailed={() => feedback.warning("请填写驳回原因")} onFinish={async ({ reason }) => {
        if (await state.act('reject', { reason: reason.trim() })) { setRejectOpen(false); rejectForm.resetFields(); }
      }}>
        <Form.Item label="驳回原因" name="reason" rules={[{ required: true, whitespace: true, message: '请填写驳回原因' }]}>
          <Input.TextArea aria-label="驳回原因" placeholder="例如：公里数照片不清晰，请重新拍摄后申请" rows={4} maxLength={500} />
        </Form.Item>
        <div className="trip-reject-count"><span>原因将保存在申请记录中</span><span>{rejectReason.length} / 500</span></div>
      </Form>
    </Modal>
  </section>;
}
