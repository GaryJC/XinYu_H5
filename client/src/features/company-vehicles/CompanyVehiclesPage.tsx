import { Pencil } from 'lucide-react';
import {insuranceState} from '../../../../shared/vehicleInsurance.mjs';
import { LoadingState } from "../../shared/ui/LoadingState";
import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import './company-vehicles.css';
import { useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Space, Tag, Upload } from 'antd';
import type { CompanyVehicle, CompanyVehicleInput } from '../../../../shared/types';
import { useCompanyVehicles } from './useCompanyVehicles';

export function CompanyVehiclesPage() {
  const feedback = useActionFeedback();
  const state = useCompanyVehicles();
  const [editor, setEditor] = useState<CompanyVehicle | 'new'>();
  const [form] = Form.useForm<CompanyVehicleInput>();
  function edit(vehicle: CompanyVehicle | 'new') {
    form.resetFields();
    form.setFieldsValue(vehicle === 'new' ? { plate: '', brand: '', model: '', active: true, insuranceStart:'', insuranceEnd:'',insuranceDetails:{} } : vehicle);
    setEditor(vehicle);
  }
  return <section className="company-vehicles-page" aria-label="公司车辆管理">
    <header className="company-vehicles-heading"><div><h2>公司车辆管理</h2></div><Space wrap><Upload accept=".xlsx" showUploadList={false} disabled={state.busy} beforeUpload={file=>{void state.previewImport(file);return false;}}><Button disabled={state.busy}>导入保险 Excel</Button></Upload><Button type="primary" disabled={state.busy} onClick={() => edit('new')}>录入车辆</Button><Button loading={state.loading} disabled={state.busy} onClick={() => void state.refresh()}>刷新车辆</Button></Space></header>
    <Input.Search aria-label="搜索公司车辆" placeholder="搜索车牌 / 品牌 / 车型" allowClear value={state.search} onChange={event => state.setSearch(event.target.value)} />
    {state.error && <Alert type="error" showIcon title={state.error} />}
    {!state.busy && !state.vehicles.length && <Empty description="暂无公司车辆，请录入" />}
    {!state.busy && state.vehicles.length > 0 && !state.filteredVehicles.length && <Empty description="没有符合条件的车辆"><Button onClick={() => state.setSearch('')}>清空搜索</Button></Empty>}
    {state.loading && <LoadingState label="正在加载公司车辆…" />}
    <div className="company-vehicle-grid">{state.filteredVehicles.map(car => <Card key={car.id} title={car.plate} extra={<Tag color={car.active ? 'green' : 'default'}>{car.active ? '启用' : '停用'}</Tag>}>
      <p>{car.brand} {car.model}</p>
      <div className="company-vehicle-insurance"><Tag color={insuranceState(car)==='保险有效'?'green':'red'}>{insuranceState(car)}</Tag><span>{car.insuranceStart||'未录入'} 至 {car.insuranceEnd||'未录入'}</span>{car.insuranceDetails?.insurer && <span>{car.insuranceDetails.insurer}</span>}</div><Space wrap>
        <Button icon={<Pencil size={16} aria-hidden="true" />} disabled={state.busy} onClick={() => edit(car)}>编辑车辆</Button>
        <Button danger={car.active} disabled={state.busy} onClick={() => Modal.confirm({ title: `${car.active ? '停用' : '启用'} ${car.plate}？`, content: car.active ? '停用后不能新申请或新出车，已出车仍可还车。' : '启用后可选择这辆车申请出车。', onOk: async () => { if (!await state.save({ ...car, active: !car.active }, car.id)) throw new Error('保存失败'); } })}>{car.active ? '停用' : '启用'}</Button>
      </Space>
    </Card>)}</div>
    <Modal open={Boolean(state.importData)} title="确认导入车辆及保险" okText="确认更新" cancelText="取消" confirmLoading={state.busy} onCancel={()=>!state.busy&&state.cancelImport()} onOk={()=>void state.confirmImport()}>
      <p>按新车牌号更新或新增；表外车辆保留，已有车辆启停状态不变。</p>
      {state.error&&<Alert type="error" title={state.error} />}
      <div className="insurance-import-preview">{state.importData?.rows.map(row=><Card size="small" key={row.plate}><strong>{row.plate} · {row.model}</strong><p>{row.insuranceStart} 至 {row.insuranceEnd}</p><p>{row.insuranceDetails.insurer} · {row.insuranceDetails.department}</p></Card>)}</div>
    </Modal>
    <Modal className="company-vehicle-modal" centered open={Boolean(editor)} title={editor === 'new' ? '录入公司车辆' : '编辑公司车辆'} onCancel={() => !state.busy && setEditor(undefined)} onOk={() => form.submit()} confirmLoading={state.busy} okText="保存车辆" cancelText="取消">
      {state.error && <Alert type="error" title={state.error} />}
      <Form form={form} layout="vertical" onFinishFailed={() => feedback.warning("请完善必填信息后再提交")} onFinish={async values => { if (await state.save({ ...values, active: editor === 'new' ? true : editor?.active ?? true }, editor && editor !== 'new' ? editor.id : undefined)) setEditor(undefined); }}>
        <Form.Item label="车牌号" name="plate" rules={[{ required: true, whitespace: true, message: '请填写车牌号' }]}><Input maxLength={30} /></Form.Item>
        <Form.Item label="品牌" name="brand" rules={[{ required: true, whitespace: true, message: '请填写品牌' }]}><Input maxLength={50} /></Form.Item>
        <Form.Item label="车型" name="model" rules={[{ required: true, whitespace: true, message: '请填写车型' }]}><Input maxLength={100} /></Form.Item>
        <Form.Item label="保险生效日" name="insuranceStart" rules={[{required:true,message:'请填写保险生效日'}]}><Input type="date" /></Form.Item>
        <Form.Item label="保险到期日（含当天）" name="insuranceEnd" rules={[{required:true,message:'请填写保险到期日'}]}><Input type="date" /></Form.Item>
        {([['insurer','承保公司'],['originalPlate','原车号'],['registrationNote','登记及年审时间'],['condition','车辆状况'],['department','使用部门'],['owner','产权归属'],['payer','投保付款单位']] as const).map(([key,label])=><Form.Item key={key} label={label} name={['insuranceDetails',key]}><Input maxLength={500}/></Form.Item>)}
      </Form>
    </Modal>
  </section>;
}
