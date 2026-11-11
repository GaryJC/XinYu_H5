import {RefreshButton} from '../../shared/ui/RefreshButton';
import { CopyTextButton } from "../../shared/ui/CopyTextButton";
import { NotificationRecords } from '../notifications/NotificationRecords';
import { ActionHistory } from "../../shared/ui/ActionHistory";
import { PlusOutlined } from '@ant-design/icons';
import { SupplierList,TenderList } from './ProcurementLists';
import { hasAnyRole } from "../../../../shared/roles.mjs";
import { useState } from 'react';
import { Alert,Button,Card,Drawer,Input,Modal,Space,Tabs } from 'antd';
import type { ProcurementSupplier,UserProfile } from '../../../../shared/types';
import { useProcurement } from './useProcurement';
import { dateTime,procurementAuditLabel,publicLink } from './procurementApi';
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
    <div className="procurement-heading"><div><h2>配件竞价</h2><span className="procurement-muted">更新于 {c.refreshAt||'加载中'}</span></div><Space><RefreshButton loading={c.busy} onClick={()=>void c.run(c.load)} label="刷新"/><Button type="primary" icon={<PlusOutlined/>} disabled={c.busy} onClick={()=>setCreateOpen(true)}>新建配件询价</Button></Space></div>
    {c.error?<Alert role="alert" type="error" showIcon title={c.error}/>:null}
    <Tabs activeKey={tab} onChange={setTab} items={[
      {key:'tenders',label:'询价记录',children:<Card className="procurement-list-card"><TenderList controller={c} onOpen={id=>void c.run(()=>c.openTender(id))}/></Card>},
      {key:'suppliers',label:'供应商',children:<Card className="procurement-list-card" title="供应商档案" extra={<Button type="primary" icon={<PlusOutlined/>} onClick={()=>setSupplierEditor('new')}>新增供应商</Button>}><SupplierList items={c.suppliers} busy={c.busy} onEdit={setSupplierEditor}/><p className="procurement-access-note">供应商通过专属链接和预留信息查看询价，仅能看到自己的报价。</p></Card>},
      {key:'analytics',label:'分析报告',children:<ProcurementAnalytics controller={{...c,setReport:r=>{c.setReport(r);setReportVisible(!!r);}}}/>},
    ]}/>
    <Drawer className="procurement-drawer" size={760} title="新建配件询价" open={createOpen} destroyOnHidden onClose={()=>setCreateOpen(false)}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<TenderForm suppliers={c.suppliers} busy={c.busy} onCancel={()=>setCreateOpen(false)} onSave={body=>c.createTender(body,()=>setCreateOpen(false))}/></div></Drawer>
    <Drawer className="procurement-drawer" size={480} title={supplierEditor==='new'?'新增供应商':'编辑供应商'} open={!!supplierEditor} destroyOnHidden onClose={()=>setSupplierEditor(undefined)}>{c.error?<Alert type="error" title={c.error}/>:null}{supplierEditor?<SupplierForm key={supplierEditor==='new'?'new':supplierEditor.id} supplier={supplierEditor==='new'?undefined:supplierEditor} busy={c.busy} onCancel={()=>setSupplierEditor(undefined)} onSave={body=>c.saveSupplier(body,supplierEditor==='new'?undefined:supplierEditor.id,()=>setSupplierEditor(undefined))}/>:null}</Drawer>
    <Drawer className="procurement-drawer" size="large" title="询价详情与实时报价" open={!!c.selectedId} onClose={c.closeDetail}><div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<ProcurementTenderDetail key={c.selectedId} controller={c} user={user}/></div></Drawer>
    <Drawer size="large" title="供应商表现报告 · 内部预览" open={!!c.report&&(reportVisible||initialReport)} onClose={()=>{setReportVisible(false);c.setReport(undefined);}}>
      {c.report?<div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<Space wrap><Button type="primary" loading={c.busy} onClick={()=>void c.publishReport()}>{c.report.publishedAt?'重发报告链接（旧链接失效）':'发布并生成分享链接'}</Button><Button danger loading={c.busy} onClick={()=>Modal.confirm({title:'撤销全部现有报告链接？',onOk:c.revokeReport})}>撤销报告链接</Button></Space>
        <ProcurementReportView report={c.report.snapshot}/>
        <NotificationRecords key={c.report.id} source="procurement" resourceId={c.report.id}/>
        <ActionHistory title="访问及反馈记录" items={(c.report.activity||[]).map(a=>({key:a.id,title:procurementAuditLabel(a.action),actor:a.actor,time:dateTime(a.at),detail:a.detail.feedback?<p>{String(a.detail.feedback)}</p>:undefined}))}><p>访问记录表示信息匹配后打开，无法证明是联系人本人操作。</p></ActionHistory>
      </div>:null}
    </Drawer>
    <Modal zIndex={1500} title="分享链接" open={c.links.length>0} onCancel={()=>c.setLinks([])} footer={<Button onClick={()=>c.setLinks([])}>完成</Button>}>
      <Alert type="info" title={c.links[0]?.supplierName==='本次询价全部受邀供应商'?'同一链接可群发给本次受邀供应商':'请发送给对应供应商'} description="供应商需填写预留手机号和姓名或供应商名称核验身份。请复制保存链接。"/>
      {c.links.map(l=><div className="procurement-link" key={l.token}><strong>{l.supplierName}</strong><Input aria-label={`${l.supplierName}专属链接`} readOnly value={publicLink(l.token)}/><small>有效期至 {dateTime(l.expiresAt)}</small><CopyTextButton text={publicLink(l.token)} label="复制链接" /></div>)}
    </Modal>
  </section>;
}
