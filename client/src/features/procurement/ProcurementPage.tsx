import { ActionHistory } from "../../shared/ui/ActionHistory";
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { SupplierList,TenderList } from './ProcurementLists';
import { hasAnyRole } from "../../../../shared/roles.mjs";
import { useState } from 'react';
import { Alert,Button,Card,Drawer,Input,Modal,Space,Tabs } from 'antd';
import type { ProcurementSupplier,UserProfile } from '../../../../shared/types';
import { useProcurement } from './useProcurement';
import { procurementApi,dateTime,notificationLabel,procurementAuditLabel,statusLabels,publicLink } from './procurementApi';
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
    <div className="procurement-heading"><div><h2>配件竞价</h2><span className="procurement-muted">本店仓管与管理员共同管理 · 最新刷新 {c.refreshAt||'加载中'}</span></div><Space><Button icon={<ReloadOutlined/>} loading={c.busy} onClick={()=>void c.run(c.load)}>刷新</Button><Button type="primary" icon={<PlusOutlined/>} disabled={c.busy} onClick={()=>setCreateOpen(true)}>新建配件询价</Button></Space></div>
    {c.error?<Alert role="alert" type="error" showIcon title={c.error}/>:null}
    <Tabs activeKey={tab} onChange={setTab} items={[
      {key:'tenders',label:'询价记录',children:<Card className="procurement-list-card"><TenderList items={c.tenders} busy={c.busy} onOpen={id=>void c.run(()=>c.openTender(id))}/></Card>},
      {key:'suppliers',label:'供应商',children:<Card className="procurement-list-card" title="供应商档案" extra={<Button type="primary" icon={<PlusOutlined/>} onClick={()=>setSupplierEditor('new')}>新增供应商</Button>}><SupplierList items={c.suppliers} busy={c.busy} onEdit={setSupplierEditor}/><p className="procurement-access-note">供应商通过专属链接和预留信息查看询价，仅能看到自己的报价。</p></Card>},
      {key:'analytics',label:'分析报告',children:<ProcurementAnalytics controller={{...c,setReport:r=>{c.setReport(r);setReportVisible(!!r);}}}/>},
    ]}/>
    <Drawer className="procurement-drawer" size={760} title="新建配件询价" open={createOpen} destroyOnHidden onClose={()=>setCreateOpen(false)}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<TenderForm suppliers={c.suppliers} busy={c.busy} onCancel={()=>setCreateOpen(false)} onSave={async body=>{await c.run(async()=>{const result=await procurementApi.create(body);c.setLinks(result.links);setCreateOpen(false);await c.load();await c.openTender(result.tender.id);},'配件询价已创建');}}/></div></Drawer>
    <Drawer className="procurement-drawer" size={480} title={supplierEditor==='new'?'新增供应商':'编辑供应商'} open={!!supplierEditor} destroyOnHidden onClose={()=>setSupplierEditor(undefined)}>{c.error?<Alert type="error" title={c.error}/>:null}{supplierEditor?<SupplierForm key={supplierEditor==='new'?'new':supplierEditor.id} supplier={supplierEditor==='new'?undefined:supplierEditor} busy={c.busy} onCancel={()=>setSupplierEditor(undefined)} onSave={async body=>{await c.run(async()=>{await procurementApi.saveSupplier(body,supplierEditor==='new'?undefined:supplierEditor.id);setSupplierEditor(undefined);await c.load();},'供应商信息已保存');}}/>:null}</Drawer>
    <Drawer className="procurement-drawer" size="large" title="询价详情与实时报价" open={!!c.selectedId} onClose={c.closeDetail}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<ProcurementTenderDetail key={c.selectedId} controller={c}/></div></Drawer>
    <Drawer size="large" title="供应商表现报告 · 内部预览" open={!!c.report&&(reportVisible||initialReport)} onClose={()=>{setReportVisible(false);c.setReport(undefined);}}>
      {c.report?<div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<Space wrap><Button type="primary" loading={c.busy} onClick={()=>void c.run(async()=>{const result=await procurementApi.reportAction(c.report!.id,'publish');if(result.link)c.setLinks([result.link]);c.setReport(await procurementApi.report(c.report!.id));await c.load();},'报告已发布，分享链接已生成')}>{c.report.publishedAt?'重发报告链接（旧链接失效）':'发布并生成分享链接'}</Button><Button danger loading={c.busy} onClick={()=>Modal.confirm({title:'撤销全部现有报告链接？',onOk:()=>c.run(async()=>{await procurementApi.reportAction(c.report!.id,'revoke');c.setReport(await procurementApi.report(c.report!.id));},'报告链接已撤销')})}>撤销报告链接</Button></Space>
        <ProcurementReportView report={c.report.snapshot}/>
        <ActionHistory title="钉钉通知状态" items={(c.report.notifications||[]).map(n=>({key:n.id,title:notificationLabel(n.status),actor:n.recipientName,detail:n.error?<p>{n.error}</p>:undefined}))}/>
        <ActionHistory title="访问及反馈记录" items={(c.report.activity||[]).map(a=>({key:a.id,title:procurementAuditLabel(a.action),actor:a.actor,time:dateTime(a.at),detail:a.detail.feedback?<p>{String(a.detail.feedback)}</p>:undefined}))}><p>访问记录表示信息匹配后打开，无法证明是联系人本人操作。</p></ActionHistory>
      </div>:null}
    </Drawer>
    <Modal title="专属分享链接" open={c.links.length>0} onCancel={()=>c.setLinks([])} footer={<Button onClick={()=>c.setLinks([])}>完成</Button>}>
      <Alert type="info" title="请逐家发送对应链接" description="链接与供应商绑定。请及时复制保存，关闭后需重发链接，原链接将失效。"/>
      {c.links.map(l=><div className="procurement-link" key={l.token}><strong>{l.supplierName}</strong><Input aria-label={`${l.supplierName}专属链接`} readOnly value={publicLink(l.token)}/><small>有效期至 {dateTime(l.expiresAt)}</small><Button onClick={()=>{void navigator.clipboard.writeText(publicLink(l.token)).catch(()=>Modal.info({title:'请长按链接输入框复制',content:publicLink(l.token)}));}}>复制链接</Button></div>)}
    </Modal>
  </section>;
}
