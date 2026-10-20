import { Alert,Card,Table } from 'antd';
import type { ProcurementReport } from '../../../../shared/types';
import { money,dateTime } from './procurementApi';
export function ProcurementReportView({report}:{report:ProcurementReport}) {
  const m=report.metrics,b=report.benchmark;
  return <div className="procurement">
    <div><h2>{report.supplierName} · 报价表现报告</h2><p className="procurement-muted">{dateTime(report.from)} — {dateTime(report.to)}（不含结束时刻）<br/>生成时间：{dateTime(report.generatedAt)}</p></div>
    <section className="procurement-grid" aria-label="合作概况">{[
      ['受邀次数',m.invited],['报价次数',m.quoted],['中标次数',m.awarded],['中标金额',money(m.awardAmountFen)],
      ['报价响应率',m.responseRate===null?'暂无数据':`${m.responseRate}%（${m.quoted}/${m.invited}）`],
      ['中标率',m.winRate===null?'暂无数据':`${m.winRate}%`],['未报价',m.missed],['主动放弃',m.declined],
    ].map(([label,value])=><div className="procurement-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
    <Card title="报价竞争力">
      {b.gapBand?<><h2>{b.gapBand}</h2><p>在满足匿名比较条件的 {b.samples} 场询价中，以各场报价相对其他供应商有效报价中位数的差距，再取中位数。</p>
        <div className="procurement-grid">{[['低于同行超过5%',b.below],['与同行相差±5%以内',b.near],['高于同行超过5%',b.above]].map(([label,n])=><div className="procurement-stat" key={label}><span>{label}</span><strong>{n} 场</strong></div>)}</div></>
        :<Alert type="info" showIcon title="同行样本不足" description="每场至少3家其他有效报价，每个展示分组至少5场、涉及5家不同同行后才展示价格差距。"/>}
      <p className="procurement-muted">只比较已产生中标结果且条件一致的最终有效报价。不公开同行身份、单次报价、最低价或精确差值。差距为5个百分点区间。</p>
    </Card>
    <Card title="未中标与响应情况"><Table pagination={false} rowKey="label" dataSource={[
      {label:'有效报价但未中标',value:m.lost},{label:'其中因价格高于中标价',value:m.priceLost},{label:'其中并列最低价未选中',value:m.lost-m.priceLost},{label:'报价未满足采购要求',value:m.invalid},
      {label:'参与的流标询价',value:m.participatedFailed},{label:'等待结标的受邀询价',value:m.pending},
    ]} columns={[{title:'指标',dataIndex:'label'},{title:'次数',dataIndex:'value'}]}/><p className="procurement-muted">流标是整场询价没有产生中标者，不等于供应商未中标。中标率按已结标询价中的有效报价次数计算。</p></Card>
    <Card title="配件类别竞争力">{report.categories.length?<Table rowKey="category" pagination={false} dataSource={report.categories} columns={[{title:'配件类别',dataIndex:'category'},{title:'可比较场次',dataIndex:'samples'},{title:'价格水平',dataIndex:'gapBand'}]}/>:<p>暂无满足匿名样本门槛的配件类别。</p>}</Card>
    <Card title="季度变化"><Table rowKey="quarter" pagination={false} dataSource={report.quarters} scroll={{x:500}} columns={[{title:'季度',dataIndex:'quarter'},{title:'报价',dataIndex:'quoted'},{title:'中标',dataIndex:'awarded'},{title:'价格差距',dataIndex:'gapBand',render:v=>v||'同行样本不足'}]}/></Card>
    {report.note?<div className="procurement-report-note"><strong>合作建议</strong><p>{report.note}</p></div>:null}
    <p className="procurement-muted">统计按报价收集结束时间归属期间，取消询价不纳入表现。报价采用人民币含税含运费总价。中标金额为报价金额，未代表实际付款或采购支出。报告为固定历史快照。</p>
  </div>;
}
