import { LoadingState } from "../../shared/ui/LoadingState";
import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import './company-vehicles.css';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Space, Tag } from 'antd';
import type { CompanyVehicle, CompanyVehicleInput } from '../../../../shared/types';
import { useCompanyVehicles } from './useCompanyVehicles';

export function CompanyVehiclesPage() {
  const feedback = useActionFeedback();
  const state = useCompanyVehicles();
  const [editor, setEditor] = useState<CompanyVehicle | 'new'>();
  const [form] = Form.useForm<CompanyVehicleInput>();
  function edit(vehicle: CompanyVehicle | 'new') {
    form.setFieldsValue(vehicle === 'new' ? { plate: '', brand: '', model: '', active: true } : vehicle);
    setEditor(vehicle);
  }
  return <section className="company-vehicles-page" aria-label="公司车辆管理">
    <header className="company-vehicles-heading"><div><h2>公司车辆管理</h2><p>维护公司车辆档案，管理车辆启用状态。</p></div><Space wrap><Button type="primary" disabled={state.busy} onClick={() => edit('new')}>录入车辆</Button><Button loading={state.loading} disabled={state.busy} onClick={() => void state.refresh()}>刷新车辆</Button></Space></header>
    {state.error && <Alert type="error" showIcon title={state.error} />}
    {!state.busy && !state.vehicles.length && <Empty description="暂无公司车辆，请录入" />}
    {state.loading && <LoadingState label="正在加载公司车辆…" />}
    <div className="company-vehicle-grid">{state.vehicles.map(car => <Card key={car.id} title={car.plate} extra={<Tag color={car.active ? 'green' : 'default'}>{car.active ? '启用' : '停用'}</Tag>}>
      <p>{car.brand} {car.model}</p><Space wrap>
        <Button disabled={state.busy} onClick={() => edit(car)}>编辑车辆</Button>
        <Button disabled={state.busy} onClick={() => Modal.confirm({ title: `${car.active ? '停用' : '启用'} ${car.plate}？`, content: car.active ? '停用后不能新申请或新出车，已出车仍可还车。' : '启用后可选择这辆车申请出车。', onOk: async () => { if (!await state.save({ ...car, active: !car.active }, car.id)) throw new Error('保存失败'); } })}>{car.active ? '停用' : '启用'}</Button>
      </Space>
    </Card>)}</div>
    <Modal className="company-vehicle-modal" centered open={Boolean(editor)} title={editor === 'new' ? '录入公司车辆' : '编辑公司车辆'} onCancel={() => !state.busy && setEditor(undefined)} onOk={() => form.submit()} confirmLoading={state.busy} okText="保存车辆" cancelText="取消">
      {state.error && <Alert type="error" title={state.error} />}
      <Form form={form} layout="vertical" onFinishFailed={() => feedback.warning("请完善必填信息后再提交")} onFinish={async values => { if (await state.save({ ...values, active: editor === 'new' ? true : editor?.active ?? true }, editor && editor !== 'new' ? editor.id : undefined)) setEditor(undefined); }}>
        <Form.Item label="车牌号" name="plate" rules={[{ required: true, whitespace: true, message: '请填写车牌号' }]}><Input maxLength={30} /></Form.Item>
        <Form.Item label="品牌" name="brand" rules={[{ required: true, whitespace: true, message: '请填写品牌' }]}><Input maxLength={50} /></Form.Item>
        <Form.Item label="车型" name="model" rules={[{ required: true, whitespace: true, message: '请填写车型' }]}><Input maxLength={100} /></Form.Item>
      </Form>
    </Modal>
  </section>;
}
