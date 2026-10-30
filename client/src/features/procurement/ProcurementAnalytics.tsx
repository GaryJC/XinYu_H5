import { useEffect, useState } from 'react';
import { Button,Card,Form,Grid,Input,Select,Space,Table } from 'antd';
import type { ProcurementMetric } from '../../../../shared/types';
import type { ProcurementController } from './useProcurement';
import { procurementApi,money,localDateTime } from './procurementApi';
export function ProcurementAnalytics({controller:c}:{controller:ProcurementController}) {
  const desktop=Grid.useBreakpoint().md;
  useEffect(()=>{void c.run(c.loadAnalytics);},[c.run,c.loadAnalytics]);
  const [from,setFrom]=useState(localDateTime(new Date(Date.now()-30*86400000))),[to,setTo]=useState(localDateTime(new Date()));
  const [supplierId,setSupplierId]=useState<string>(),[note,setNote]=useState(''),[category,setCategory]=useState<string>();
  const a=c.analysis;
  const validRange=Number.isFinite(Date.parse(from))&&Number.isFinite(Date.parse(to))&&Date.parse(from)<Date.parse(to);
  const range=()=>({from:new Date(from).toISOString(),to:new Date(to).toISOString()});
  return <div className="procurement">
    <Card title="统计周期"><Form layout="vertical"><div className="procurement-form-grid"><Form.Item label="开始时间（含）"><input aria-label="统计开始时间" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/></Form.Item><Form.Item label="结束时间（不含）"><input aria-label="统计结束时间" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/></Form.Item></div>
      <Form.Item label="配件类别（内部分析）"><Select allowClear placeholder="全部配件类别" value={category} onChange={setCategory} options={[...new Set(c.tenders.map(t=>t.data.category).filter(Boolean))].map(v=>({value:v,label:v}))}/></Form.Item><Space wrap><Button onClick={()=>{setFrom(localDateTime(new Date(new Date().getFullYear(),0,1)));setTo(localDateTime(new Date()));}}>今年以来</Button><Button onClick={()=>{setFrom(localDateTime(new Date(Date.now()-365*86400000)));setTo(localDateTime(new Date()));}}>最近一年</Button><Button type="primary" disabled={!validRange} loading={c.busy} onClick={()=>void c.run(async()=>c.setAnalysis(await procurementApi.analytics(range().from,range().to,category)))}>查询分析</Button></Space>
    </Form></Card>
    {a?<><div className="procurement-grid">{[['已结束收集',a.total],['已中标',a.awarded],['已流标',a.failed],['待结标',a.pending],['单家中标报价金额',money(a.awardAmountFen)],['流标率',a.awarded+a.failed?`${(a.failed/(a.awarded+a.failed)*100).toFixed(1)}%`:'暂无数据']].map(([label,value])=><div className="procurement-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <Card title="中标次数与供应商表现"><Select aria-label="筛选供应商" allowClear placeholder="全部供应商" value={supplierId} onChange={setSupplierId} style={{minWidth:200,marginBottom:16}} options={c.suppliers.map(s=>({value:s.id,label:s.name}))}/>
        {desktop?<Table<ProcurementMetric> rowKey="supplierId" dataSource={a.suppliers.filter(s=>!supplierId||s.supplierId===supplierId)} expandable={{expandedRowRender:s=><Table rowKey="id" size="small" pagination={{pageSize:5}} dataSource={c.tenders.filter(t=>t.closedAt&&t.closedAt>=a.from&&t.closedAt<a.to&&(!category||t.data.category===category)&&['closed','awarded','failed'].includes(t.status)&&t.invitations.some(i=>i.supplierId===s.supplierId))} columns={[{title:'配件',render:(_,t)=>t.data.partName},{title:'本供应商最终报价',render:(_,t)=>{const q=t.invitations.find(i=>i.supplierId===s.supplierId)?.quotes[0];return !q?'未报价':q.declined?'主动放弃':money(q.totalFen);}},{title:'结果',render:(_,t)=>t.status==='closed'?'待结标':t.status==='failed'?'整场流标':t.winnerId===s.supplierId?'已中标':'未中标'},{title:'详情',render:(_,t)=><Button size="small" onClick={()=>void c.run(()=>c.openTender(t.id))}>查看询价</Button>}]}/>}} scroll={{x:1600}} columns={[
          {title:'供应商',dataIndex:'supplierName',fixed:'left',width:160},
          ...([['受邀','invited'],['报价','quoted'],['有效','valid'],['中标','awarded'],['未中标','lost'],['未报价','missed'],['放弃','declined'],['无效','invalid'],['待结标','pending'],['参与流标','participatedFailed']] as const).map(([title,key])=>({title,dataIndex:key,sorter:(x:ProcurementMetric,y:ProcurementMetric)=>x[key]-y[key]})),
          {title:'响应率',dataIndex:'responseRate',render:v=>v===null?'—':`${v}%`},{title:'中标率',dataIndex:'winRate',render:v=>v===null?'—':`${v}%`},
          {title:'相对价格指数',dataIndex:'priceIndex',render:(v,s)=><>{v??'—'}<small>{s.priceSamples}场{s.priceSamples<5?' · 样本较少':''}</small></>,sorter:(x,y)=>(x.priceIndex??Infinity)-(y.priceIndex??Infinity)},
          {title:'单家中标报价金额',dataIndex:'awardAmountFen',render:money,sorter:(x,y)=>x.awardAmountFen-y.awardAmountFen},
          {title:'因价格未中标',dataIndex:'priceLost'},{title:'对应询价中标规模',dataIndex:'opportunityFen',render:money},
        ]}/>:<div className="procurement-records">{a.suppliers.filter(s=>!supplierId||s.supplierId===supplierId).map(s=><article key={s.supplierId} className="procurement-record"><div className="procurement-record-title"><strong>{s.supplierName}</strong><span>中标 {s.awarded} 次</span></div><div className="procurement-record-metrics">{[['受邀 / 报价',`${s.invited} / ${s.quoted}`],['有效 / 未报价',`${s.valid} / ${s.missed}`],['响应率',s.responseRate===null?'—':`${s.responseRate}%`],['中标率',s.winRate===null?'—':`${s.winRate}%`],['单家中标报价金额',money(s.awardAmountFen)],['相对价格指数',s.priceIndex??'—']].map(([label,value])=><span key={label}>{label}<strong>{value}</strong></span>)}</div><details className="procurement-quote-history"><summary>更多统计</summary><p>未中标 {s.lost} · 放弃 {s.declined} · 无效 {s.invalid} · 待结标 {s.pending} · 参与流标 {s.participatedFailed}</p><p>因价格未中标 {s.priceLost} 次 · 对应询价中标规模 {money(s.opportunityFen)}</p><p>价格样本 {s.priceSamples} 场</p></details></article>)}</div>}<p className="procurement-muted">相对价格指数=自己的有效总价÷同场有效报价中位数×100，再取各场指数中位数；100代表同场中位水平。只纳入至少两家有效报价的已结标询价。多家中标计入各家中标次数，但数量线下确定，不计入中标报价金额；手动定标不推断未中标原因。机会金额不代表降价后一定能获得的收入。</p>
      </Card>
      <Card title="月度询价趋势"><div className="procurement-chart" role="img" aria-label="各月询价次数">{a.months.map(m=><div className="procurement-chart-column" key={m.month}><span>{m.total}</span><div className="procurement-chart-bar" style={{height:`${m.total/Math.max(1,...a.months.map(x=>x.total))*120}px`}}/><span>{m.month}</span></div>)}</div><Table rowKey="month" dataSource={a.months} pagination={false} columns={[{title:'月份',dataIndex:'month'},{title:'结束收集',dataIndex:'total'},{title:'中标',dataIndex:'awarded'},{title:'流标',dataIndex:'failed'}]}/></Card>
    </>:<p className="procurement-muted">选择统计周期后查询。按报价收集结束时间归属期间，取消询价不纳入统计。</p>}
    <Card title="生成供应商表现报告"><Form layout="vertical" onFinish={()=>void c.run(async()=>{const r=await procurementApi.createReport({supplierId:supplierId!,...range(),note});c.setReport(r);await c.load();},'报告预览已生成')}>
      <Form.Item label="报告供应商" required><Select aria-label="报告供应商" placeholder="选择供应商" value={supplierId} onChange={setSupplierId} options={c.suppliers.map(s=>({value:s.id,label:s.name}))}/></Form.Item>
      <Form.Item label="合作建议"><Input.TextArea value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3}/></Form.Item>
      <Button type="primary" htmlType="submit" disabled={!supplierId||!validRange} loading={c.busy}>生成预览</Button><p className="procurement-muted">使用上方统计周期，先生成固定快照；预览确认后发布分享链接。</p>
    </Form></Card>
    <Card title="历史报告"><Table rowKey="id" dataSource={c.reports} columns={[{title:'供应商',render:(_,r)=>r.snapshot.supplierName},{title:'状态',render:(_,r)=>r.publishedAt?'已发布':'待发布预览'},{title:'操作',render:(_,r)=><Button onClick={()=>void c.run(async()=>c.setReport(await procurementApi.report(r.id)))}>查看报告</Button>}]} /></Card>
  </div>;
}
