import { hasAnyRole } from "../../../../shared/roles.mjs";
import { useState } from 'react';
import { Alert,Button,Card,Drawer,Input,Modal,Space,Table,Tabs,Tag } from 'antd';
import type { ProcurementSupplier,UserProfile } from '../../../../shared/types';
import { useProcurement } from './useProcurement';
import { procurementApi,dateTime,notificationLabel,statusLabels,publicLink } from './procurementApi';
import { SupplierForm,TenderForm } from './ProcurementForms';
import { ProcurementTenderDetail } from './ProcurementTenderDetail';
import { ProcurementAnalytics } from './ProcurementAnalytics';
import { ProcurementReportView } from './ProcurementReportView';
import './procurement.css';
export function ProcurementPage({user}:{user:UserProfile}) {
  const c=useProcurement();
  const [supplierEditor,setSupplierEditor]=useState<ProcurementSupplier|'new'>(),[createOpen,setCreateOpen]=useState(false),[tab,setTab]=useState('tenders');
  const initialReport=new URLSearchParams(location.search).has('procurementReport');
  const [reportVisible,setReportVisible]=useState(initialReport);
  if(!hasAnyRole(user, ['manager','warehouse']))return <Alert type="error" title="仅门店管理员和仓管可使用配件竞价"/>;
  return <section className="procurement" aria-label="配件竞价管理">
    <div className="procurement-heading"><div><h2>配件竞价</h2><span className="procurement-muted">本店仓管与管理员共同管理 · 最新刷新 {c.refreshAt||'加载中'}</span></div><Space><Button loading={c.busy} onClick={()=>void c.run(c.load)}>刷新</Button><Button type="primary" onClick={()=>setCreateOpen(true)}>新建配件询价</Button></Space></div>
    {c.error?<Alert role="alert" type="error" showIcon title={c.error}/>:null}
    <Tabs activeKey={tab} onChange={setTab} items={[
      {key:'tenders',label:'询价与实时报价',children:<Card><Table rowKey="id" dataSource={c.tenders} scroll={{x:700}} columns={[
        {title:'配件',render:(_,t)=><><strong>{t.data.partName}</strong><small>{t.data.specification} · {t.data.quantity}{t.data.unit}</small></>},
        {title:'状态',dataIndex:'status',render:s=><Tag color={s==='open'?'blue':s==='awarded'?'green':'default'}>{statusLabels[s as keyof typeof statusLabels]}</Tag>},
        {title:'响应进度',render:(_,t)=>`${t.invitations.filter(i=>i.quotes[0]?.termsVersion===t.termsVersion).length}/${t.invitations.length}`},
        {title:'报价截止',dataIndex:'deadline',render:dateTime},{title:'操作',render:(_,t)=><Button onClick={()=>void c.run(()=>c.openTender(t.id))}>查看报价</Button>},
      ]}/></Card>},
      {key:'suppliers',label:'供应商档案',children:<Card title="本门店供应商" extra={<Button onClick={()=>setSupplierEditor('new')}>新增供应商</Button>}><Table rowKey="id" dataSource={c.suppliers} scroll={{x:650}} columns={[
        {title:'供应商',dataIndex:'name'},{title:'联系人',dataIndex:'contactName'},{title:'手机号',dataIndex:'phone'},{title:'主营配件',dataIndex:'categories'},
        {title:'状态',dataIndex:'active',render:v=>v?'启用':'停用'},{title:'操作',render:(_,s)=><Button onClick={()=>setSupplierEditor(s)}>编辑</Button>},
      ]}/><p className="procurement-muted">外部访问采用专属链接、预留手机号及姓名或供应商名称核对，不使用短信。固定供应商编号贯穿报价和统计。</p></Card>},
      {key:'analytics',label:'分析与供应商报告',children:<ProcurementAnalytics controller={{...c,setReport:r=>{c.setReport(r);setReportVisible(!!r);}}}/>},
    ]}/>
    <Drawer size={760} title="新建单配件询价" open={createOpen} destroyOnHidden onClose={()=>setCreateOpen(false)}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<TenderForm suppliers={c.suppliers} busy={c.busy} onCancel={()=>setCreateOpen(false)} onSave={async body=>{await c.run(async()=>{const result=await procurementApi.create(body);c.setLinks(result.links);setCreateOpen(false);await c.load();await c.openTender(result.tender.id);});}}/></div></Drawer>
    <Drawer size={480} title={supplierEditor==='new'?'新增供应商':'编辑供应商'} open={!!supplierEditor} destroyOnHidden onClose={()=>setSupplierEditor(undefined)}>{c.error?<Alert type="error" title={c.error}/>:null}{supplierEditor?<SupplierForm key={supplierEditor==='new'?'new':supplierEditor.id} supplier={supplierEditor==='new'?undefined:supplierEditor} busy={c.busy} onCancel={()=>setSupplierEditor(undefined)} onSave={async body=>{await c.run(async()=>{await procurementApi.saveSupplier(body,supplierEditor==='new'?undefined:supplierEditor.id);setSupplierEditor(undefined);await c.load();});}}/>:null}</Drawer>
    <Drawer size="large" title="询价详情与实时报价" open={!!c.selectedId} onClose={c.closeDetail}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<ProcurementTenderDetail key={c.selectedId} controller={c}/></div></Drawer>
    <Drawer size="large" title="供应商表现报告 · 内部预览" open={!!c.report&&(reportVisible||initialReport)} onClose={()=>{setReportVisible(false);c.setReport(undefined);}}>
      {c.report?<div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<Space wrap><Button type="primary" loading={c.busy} onClick={()=>void c.run(async()=>{const result=await procurementApi.reportAction(c.report!.id,'publish');if(result.link)c.setLinks([result.link]);c.setReport(await procurementApi.report(c.report!.id));await c.load();})}>{c.report.publishedAt?'重发报告链接（旧链接失效）':'发布并生成分享链接'}</Button><Button danger loading={c.busy} onClick={()=>Modal.confirm({title:'撤销全部现有报告链接？',onOk:()=>c.run(async()=>{await procurementApi.reportAction(c.report!.id,'revoke');c.setReport(await procurementApi.report(c.report!.id));})})}>撤销报告链接</Button></Space>
        <ProcurementReportView report={c.report.snapshot}/>
        <Card title="钉钉通知状态"><Table rowKey="id" size="small" pagination={false} dataSource={c.report.notifications||[]} columns={[{title:'接收人',dataIndex:'recipientName'},{title:'状态',dataIndex:'status',render:notificationLabel},{title:'说明',dataIndex:'error'}]}/></Card>
        <Card title="访问及反馈记录"><Table rowKey="id" size="small" dataSource={c.report.activity||[]} columns={[{title:'时间',dataIndex:'at',render:dateTime},{title:'联系人',dataIndex:'actor'},{title:'记录',dataIndex:'action'},{title:'反馈',render:(_,a)=>String(a.detail.feedback||'—')}]}/><p className="procurement-muted">访问记录表示信息匹配后打开，无法证明是联系人本人操作。</p></Card>
      </div>:null}
    </Drawer>
    <Modal title="专属分享链接" open={c.links.length>0} onCancel={()=>c.setLinks([])} footer={<Button onClick={()=>c.setLinks([])}>完成</Button>}>
      <Alert type="info" title="请逐家发送对应链接" description="链接与供应商绑定。请及时复制保存，关闭后需重发链接，原链接将失效。"/>
      {c.links.map(l=><div className="procurement-link" key={l.token}><strong>{l.supplierName}</strong><Input aria-label={`${l.supplierName}专属链接`} readOnly value={publicLink(l.token)}/><small>有效期至 {dateTime(l.expiresAt)}</small><Button onClick={()=>{void navigator.clipboard.writeText(publicLink(l.token)).catch(()=>Modal.info({title:'请长按链接输入框复制',content:publicLink(l.token)}));}}>复制链接</Button></div>)}
    </Modal>
  </section>;
}
