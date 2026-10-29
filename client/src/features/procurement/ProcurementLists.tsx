import { useState } from 'react';
import { Button, Empty, Grid, Input, Pagination, Table, Tag } from 'antd';
import { ArrowRightOutlined, ClockCircleOutlined, EditOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import type { ProcurementSupplier, ProcurementTender } from '../../../../shared/types';
import { LoadingState } from '../../shared/ui/LoadingState';
import { dateTime, statusLabels } from './procurementApi';

export function TenderList({items,busy,onOpen}:{items:ProcurementTender[];busy:boolean;onOpen:(id:string)=>void}) {
  const desktop=Grid.useBreakpoint().md;
  const [query,setQuery]=useState(''),[page,setPage]=useState(1);
  const rows=items.filter(t=>`${t.data.partName} ${t.data.specification} ${t.data.vehicleModel}`.toLowerCase().includes(query.trim().toLowerCase()));
  const response=(t:ProcurementTender)=>`${t.invitations.filter(i=>i.quotes[0]?.termsVersion===t.termsVersion).length} / ${t.invitations.length}`;
  const status=(t:ProcurementTender)=><><Tag color={t.status==='open'?'blue':t.status==='awarded'?'green':'default'}>{statusLabels[t.status]}</Tag>{t.purchaseApproval?<Tag color={t.purchaseApproval.status==='pending'?'orange':t.purchaseApproval.status==='approved'?'green':'red'}>{{pending:'采购待审批',approved:'采购已批准',rejected:'采购已驳回'}[t.purchaseApproval.status]}</Tag>:null}</>;
  return <><div className="procurement-list-toolbar"><div><h3>询价记录</h3><span className="procurement-muted">共 {rows.length} 条 · 点击查看报价进度</span></div><Input.Search allowClear aria-label="搜索询价" placeholder="搜索配件、规格或车型" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></div>
    {desktop?<Table loading={busy} rowKey="id" dataSource={rows} scroll={{x:700}} columns={[
      {title:'配件',render:(_,t)=><><strong>{t.data.partName}</strong><small>{t.data.specification||'未指定规格'} · 数量 {t.data.quantity}</small></>},
      {title:'状态',render:(_,t)=>status(t)},{title:'已响应 / 受邀',render:(_,t)=>response(t)},
      {title:'报价截止',dataIndex:'deadline',render:dateTime},{title:'操作',render:(_,t)=><Button type="link" onClick={()=>onOpen(t.id)}>查看报价 <ArrowRightOutlined/></Button>},
    ]}/>:busy&&!items.length?<LoadingState label="正在加载询价…"/>:rows.length?<><div className="procurement-records">{rows.slice((page-1)*10,page*10).map(t=><button type="button" className="procurement-record procurement-record-button" key={t.id} onClick={()=>onOpen(t.id)} aria-label={`查看询价：${t.data.partName}`}>
      <div className="procurement-record-title"><strong>{t.data.partName}</strong>{status(t)}</div><p>{t.data.specification||'未指定规格'} · 数量 {t.data.quantity}</p>
      <div className="procurement-record-metrics"><span>供应商响应<strong>{response(t)}</strong></span><span>车型<strong>{t.data.vehicleModel||'未填写'}</strong></span></div>
      <footer><span><ClockCircleOutlined/> {t.deadline?dateTime(t.deadline):'未设置截止时间'}</span><ArrowRightOutlined/></footer>
    </button>)}</div><Pagination simple current={page} pageSize={10} total={rows.length} onChange={setPage} hideOnSinglePage/></>:<Empty description={query?'没有匹配的询价':'暂无询价，点击上方按钮发起'}/>}</>;
}

export function SupplierList({items,busy,onEdit}:{items:ProcurementSupplier[];busy:boolean;onEdit:(supplier:ProcurementSupplier)=>void}) {
  const desktop=Grid.useBreakpoint().md;
  const [query,setQuery]=useState(''),[page,setPage]=useState(1);
  const rows=items.filter(s=>`${s.name} ${s.contactName} ${s.phone} ${s.categories}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <><div className="procurement-list-toolbar"><span className="procurement-muted">{items.filter(s=>s.active).length} 家启用 · {items.length} 家供应商</span><Input.Search allowClear aria-label="搜索供应商" placeholder="搜索名称、联系人或手机号" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></div>
    {desktop?<Table loading={busy} rowKey="id" dataSource={rows} scroll={{x:650}} columns={[
      {title:'供应商',dataIndex:'name'},{title:'联系人',dataIndex:'contactName'},{title:'手机号',dataIndex:'phone'},{title:'主营配件',dataIndex:'categories'},
      {title:'状态',dataIndex:'active',render:v=><Tag color={v?'green':'default'}>{v?'启用':'停用'}</Tag>},{title:'操作',render:(_,s)=><Button icon={<EditOutlined/>} onClick={()=>onEdit(s)}>编辑</Button>},
    ]}/>:busy&&!items.length?<LoadingState label="正在加载供应商…"/>:rows.length?<><div className="procurement-records">{rows.slice((page-1)*10,page*10).map(s=><article className="procurement-record" key={s.id}>
      <div className="procurement-record-title"><strong>{s.name}</strong><Tag color={s.active?'green':'default'}>{s.active?'启用':'停用'}</Tag></div>
      <div className="procurement-contact"><span><UserOutlined/> {s.contactName}</span><a href={`tel:${s.phone}`}><PhoneOutlined/> {s.phone}</a></div>
      <p>主营配件：{s.categories||'未填写'}</p><footer><span className="procurement-muted">供应商档案</span><Button icon={<EditOutlined/>} onClick={()=>onEdit(s)}>编辑</Button></footer>
    </article>)}</div><Pagination simple current={page} pageSize={10} total={rows.length} onChange={setPage} hideOnSinglePage/></>:<Empty description={query?'没有匹配的供应商':'暂无供应商，请先新增'}/>}</>;
}
