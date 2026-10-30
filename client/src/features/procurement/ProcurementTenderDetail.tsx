import {procurementWinnerIds} from '../../../../shared/procurementWinners.mjs';
import {ProcurementPurchaseApproval} from './ProcurementPurchaseApproval';
import { ActionHistory } from "../../shared/ui/ActionHistory";
import { LoadingState } from "../../shared/ui/LoadingState";
import {ProcurementPhoto} from './ProcurementNameplatePhotos';
import { TenderForm } from "./ProcurementForms";
import { useState } from 'react';
import { Alert,Button,Card,Drawer,Grid,Input,Modal,Select,Space,Table,Tag } from 'antd';
import type { ProcurementInvitation,ProcurementTerms,ProcurementTender,UserProfile } from '../../../../shared/types';
import type { ProcurementController } from './useProcurement';
import { money,dateTime,publicLink,procurementAuditLabel,statusLabels } from './procurementApi';
export function ProcurementTermsView({terms,portal=false}:{terms:ProcurementTerms;portal?:boolean}) {
  return <><dl className="procurement-terms">{[
    ['配件',terms.partName],['车架号',terms.vin||'未记录'],['车辆型号',terms.vehicleModel||'未填写'],['规格',terms.specification||'未指定'],['品牌',terms.brand||'不限品牌'],['数量',`${terms.quantity} ${terms.unit}`],
    ['最晚交货',dateTime(terms.deliveryBy)],['发票及付款',terms.paymentTerms||'未指定'],...(terms.qualityRequirements?[['历史质量要求',terms.qualityRequirements]]:[]),
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{terms.nameplatePhotoIds?.length?<section><h3>铭牌号照片</h3><Space wrap>{terms.nameplatePhotoIds.map(id=><ProcurementPhoto key={id} id={id} portal={portal}/>)}</Space></section>:null}{terms.otherPhotoIds?.length?<section><h3>其他照片</h3><Space wrap>{terms.otherPhotoIds.map(id=><ProcurementPhoto key={id} id={id} portal={portal} label="其他照片"/>)}</Space></section>:null}{terms.imageUrls.length?<div className="procurement-images">{terms.imageUrls.map(u=><a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="配件参考图片" referrerPolicy="no-referrer"/></a>)}</div>:null}</>;
}
export function ProcurementTenderDetail({controller:c,user}:{controller:ProcurementController;user:UserProfile}) {
  const desktop=Grid.useBreakpoint().md;
  const [editing,setEditing]=useState<ProcurementTender>();
  const [reason,setReason]=useState(''),[winnerIds,setWinnerIds]=useState<string[]>(),[invalidating,setInvalidating]=useState<ProcurementInvitation>(),[invalidReason,setInvalidReason]=useState('');
  const d=c.detail;if(!d)return c.busy?<LoadingState label="正在加载询价详情…" />:null;
  const t=d.tender,final=['awarded','failed','cancelled'].includes(t.status);
  const valid=t.invitations.filter(i=>{const q=i.quotes[0];return q&&q.termsVersion===t.termsVersion&&!q.declined&&!i.invalidReason&&q.meetsRequirements&&Date.parse(q.deliveryAt!)<=Date.parse(t.data.deliveryBy);});
  const minimum=valid.length?Math.min(...valid.map(i=>i.quotes[0].totalFen!)):undefined;
  const ties=valid.filter(i=>i.quotes[0].totalFen===minimum);
  const selected=winnerIds??(ties.length===1?[ties[0].supplierId]:[]);
  const needsReason=selected.length>1||ties.length>1||selected[0]!==ties[0]?.supplierId;
  const invalidSelection=!selected.length||selected.some(id=>!valid.some(i=>i.supplierId===id));
  const responded=t.invitations.filter(i=>i.quotes[0]?.termsVersion===t.termsVersion).length;
  const invitationActions=(i:ProcurementInvitation)=><Space orientation="vertical">
        {!final&&i.quotes[0]&&!i.quotes[0].declined?<Button size="small" onClick={()=>{setInvalidating(i);setInvalidReason(i.invalidReason);}}>{i.invalidReason?'查看 / 恢复报价资格':'标记报价不符合要求'}</Button>:null}</Space>;
  return <div className="procurement">
    <div className="procurement-detail-hero"><Tag color={t.status==='open'?'blue':t.status==='awarded'?'green':'default'}>{statusLabels[t.status]}</Tag><strong>{t.data.partName}</strong><p>报价截止：{dateTime(t.deadline)} · 已响应 {responded}/{t.invitations.length} 家</p></div>
    {!final?<Button onClick={()=>setEditing(t)}>编辑询价信息 / 截止时间</Button>:null}
    <Card title="统一邀请链接">
    {d.sharedLink?<Space orientation="vertical" style={{width:'100%'}}><Input aria-label="当前统一邀请链接" readOnly value={publicLink(d.sharedLink.token)}/><small>有效期至 {dateTime(d.sharedLink.expiresAt)}</small><Button onClick={()=>{const url=publicLink(d.sharedLink!.token);void (navigator.clipboard?.writeText(url)??Promise.reject()).catch(()=>Modal.info({zIndex:1600,title:'请长按链接输入框复制',content:url}));}}>复制当前链接</Button><p>可随时回来复制，复制不会使已发送的链接失效。</p></Space>:<p>{d.hasActiveSharedLink?'旧链接仍有效，但无法恢复显示。需要重新生成一次并发送给供应商，之后可随时在这里复制。':'暂无有效统一链接，请生成后分享。'}</p>}
    <Space wrap><Button disabled={c.busy||t.status==='cancelled'} onClick={()=>Modal.confirm({zIndex:1500,title:'生成本次询价的统一链接？',content:'同一链接可发给所有受邀供应商，各家核验身份后只能查看自己的报价。重新生成会使旧的统一链接及其登录会话失效。',okText:'生成统一链接',onOk:()=>c.action({action:'share-link'})})}>{d.hasActiveSharedLink?'重新生成并作废旧链接':'生成统一邀请链接'}</Button><Button disabled={c.busy||t.status==='cancelled'||!d.hasActiveSharedLink} onClick={()=>Modal.confirm({zIndex:1500,title:'停用本次询价的统一链接？',content:'所有通过该统一链接登录的供应商会话也将失效，报价记录保留。',onOk:()=>c.action({action:'revoke-shared-link'})})}>停用统一链接</Button></Space></Card>
    <ProcurementTermsView terms={t.data}/>
    {t.status==='open'&&responded===t.invitations.length?<Alert type="success" title="所有受邀供应商均已报价或明确放弃"/>:null}
    {!final?<Alert type="info" showIcon title={`${t.status==='open'?'当前':'最终'}最低有效报价：${money(minimum)}`} description="按人民币含税含运费总价比较；报价中价格仅供参考，结束收集后确认中标。"/>:null}
    {desktop?<Table<ProcurementInvitation> rowKey="id" dataSource={t.invitations} pagination={false} scroll={{x:950}} columns={[
      {title:'供应商',dataIndex:'supplierName',render:(name,i)=><><strong>{name}</strong>{procurementWinnerIds(t).includes(i.supplierId)?<Tag color="green">中标</Tag>:null}</>},
      {title:'最终报价',render:(_,i)=>{const q=i.quotes[0];return !q?'未报价':q.declined?'主动放弃':<><strong>{money(q.totalFen)}</strong><small>单价 {money(q.unitPriceFen)} / 运费 {money(q.freightFen)}</small></>;}},
      {title:'交期 / 有效性',render:(_,i)=>{const q=i.quotes[0];return !q||q.declined?'—':<>{dateTime(q.deliveryAt)}<small>{q.termsVersion!==t.termsVersion?'采购要求已变更，需重新确认报价':i.invalidReason||(!q.meetsRequirements?'未确认满足要求':Date.parse(q.deliveryAt!)>Date.parse(t.data.deliveryBy)?'交期不符':'有效报价')}</small><small>{q.note}</small></>;}},
      {title:'提交时间',render:(_,i)=>dateTime(i.quotes[0]?.submittedAt)},
      {title:'操作',render:(_,i)=>invitationActions(i)},
    ]} expandable={{expandedRowRender:i=><ActionHistory items={i.quotes.map(q=>({key:q.id,title:q.declined?'放弃报价':`提交报价 · ${money(q.totalFen)}`,actor:i.supplierName,time:dateTime(q.submittedAt),detail:q.note?<p>{q.note}</p>:undefined}))}/>,rowExpandable:i=>i.quotes.length>0}}/>:<div className="procurement-records">{t.invitations.map(i=>{const q=i.quotes[0],eligible=valid.some(v=>v.id===i.id);return <article className="procurement-record procurement-quote" key={i.id}>
      <div className="procurement-record-title"><strong>{i.supplierName}</strong>{procurementWinnerIds(t).includes(i.supplierId)?<Tag color="green">中标</Tag>:<Tag color={eligible?'blue':'default'}>{!q?'待报价':q.termsVersion!==t.termsVersion?'待重新确认':q.declined?'已放弃':eligible?'有效报价':'不参与比价'}</Tag>}</div>
      <div className="procurement-quote-price">{!q?'尚未报价':q.declined?'主动放弃':money(q.totalFen)}</div>
      {q&&!q.declined?<><p>含税单价 {money(q.unitPriceFen)} · 运费 {money(q.freightFen)}</p><dl className="procurement-quote-facts"><div><dt>承诺交货</dt><dd>{dateTime(q.deliveryAt)}</dd></div><div><dt>提交时间</dt><dd>{dateTime(q.submittedAt)}</dd></div></dl>{!eligible?<Alert type="warning" showIcon title={q.termsVersion!==t.termsVersion?'采购要求已变更，请供应商重新报价':i.invalidReason||(!q.meetsRequirements?'未确认满足要求':'交期不符合要求')}/>:null}{q.note?<p>{q.note}</p>:null}</>:null}
      <div className="procurement-quote-actions">{invitationActions(i)}</div>
      {i.quotes.length?<details className="procurement-quote-history"><summary>报价记录（{i.quotes.length}）</summary><ActionHistory items={i.quotes.map(q=>({key:q.id,title:q.declined?'主动放弃':`提交报价 · ${money(q.totalFen)}`,actor:i.supplierName,time:dateTime(q.submittedAt),detail:q.note?<p>{q.note}</p>:undefined}))}/></details>:null}
    </article>;})}</div>}
    {!final?<Card title="完成报价与结标"><Space orientation="vertical" style={{width:'100%'}}>
      <Input.TextArea aria-label="结标或取消原因" placeholder="选择多家、非最低价或并列报价时请填写定标原因；取消询价也需填写原因" maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/>
      {t.status==='closed'&&valid.length?<><Select mode="multiple" aria-label="选择中标供应商（可多选）" placeholder="选择一家或多家中标供应商" style={{width:'100%'}} value={selected} onChange={setWinnerIds} options={valid.map(i=>({value:i.supplierId,label:`${i.supplierName} · ${money(i.quotes[0].totalFen)}${i.quotes[0].totalFen===minimum?'（最低价推荐）':''}`}))}/><p>多家中标只记录入选结果，各家实际采购数量在线下确定。</p></>:null}
      <Space wrap>{t.status==='open'?<Button type="primary" loading={c.busy} onClick={()=>Modal.confirm({title:'提前结束本次报价？',content:`还有 ${t.invitations.length-responded} 家未响应。结束后供应商不能再提交或修改报价，可接着确认中标。`,onOk:()=>c.action({action:'close'})})}>提前结束报价</Button>:null}
        {t.status==='closed'?<Button type="primary" disabled={!!valid.length&&(invalidSelection||(needsReason&&!reason.trim()))} loading={c.busy} onClick={()=>Modal.confirm({zIndex:1500,title:valid.length?'确认所选供应商中标？':'没有有效报价，确认流标？',content:valid.filter(i=>selected.includes(i.supplierId)).map(i=>i.supplierName).join('、'),onOk:()=>c.action({action:'settle',winnerIds:selected,reason})})}>{valid.length?'确认中标':'确认流标'}</Button>:null}
        <Button danger disabled={!reason.trim()} loading={c.busy} onClick={()=>Modal.confirm({title:'取消本次询价？',content:reason,onOk:()=>c.action({action:'cancel',reason})})}>取消询价</Button>
      </Space>
    </Space></Card>:<Alert type={t.status==='awarded'?'success':'info'} title={statusLabels[t.status]} description={t.status==='awarded'?`中标：${t.invitations.filter(i=>procurementWinnerIds(t).includes(i.supplierId)).map(i=>i.supplierName).join('、')}。${t.reason||'按最低有效报价确认'}${procurementWinnerIds(t).length>1?'；实际采购数量线下确定。':''}`:t.reason}/>}
    <ProcurementPurchaseApproval key={`${t.id}-${t.purchaseApproval?.submittedAt||'new'}`} tender={t} user={user} controller={c}/>
    <ActionHistory title="操作记录" items={d.audit.map(a=>({key:a.id,title:procurementAuditLabel(a.action),actor:a.actor,time:dateTime(a.at),detail:a.detail.reason?<p>{String(a.detail.reason)}</p>:undefined}))}/>
    <Drawer className="procurement-drawer" title="编辑询价信息与截止时间" size={760} open={!!editing} destroyOnHidden onClose={()=>setEditing(undefined)}>
      {editing?<div className="procurement">{c.error?<Alert type="error" title={c.error}/>:null}<TenderForm key={`${editing.id}-${editing.version}`} tender={editing} suppliers={c.suppliers} busy={c.busy} onCancel={()=>setEditing(undefined)} onSave={async body=>{Modal.confirm({title:'确认保存询价修改？',content:`只修改截止时间，原报价继续有效；修改采购要求，原报价需由供应商重新确认。${editing.status==='closed'?'本次报价已停止，保存后将重新开放报价。':''}`,onOk:async()=>{const saved=await c.action({...body,action:'update',expectedVersion:editing.version,reopen:editing.status==='closed'});if(saved)setEditing(undefined);}});}}/></div>:null}
    </Drawer>
    <Modal title={`报价是否符合要求：${invalidating?.supplierName||''}`} open={!!invalidating} onCancel={()=>setInvalidating(undefined)} footer={<Space><Button loading={c.busy} disabled={c.busy} onClick={()=>{void c.action({action:'invalidate',invitationId:invalidating?.id,reason:''}).then(r=>{if(r)setInvalidating(undefined);});}}>恢复报价资格</Button><Button type="primary" disabled={!invalidReason.trim()} loading={c.busy} onClick={()=>{void c.action({action:'invalidate',invitationId:invalidating?.id,reason:invalidReason}).then(r=>{if(r)setInvalidating(undefined);});}}>确认不参与比价</Button></Space>}>
      <p>例如规格不符、无法按约供货时，将这份报价排除在中标候选之外，必须填写原因。报价及修改记录仍保留，也可以恢复资格。</p><Input.TextArea aria-label="报价无效原因" value={invalidReason} onChange={e=>setInvalidReason(e.target.value)} maxLength={1000}/>
    </Modal>
  </div>;
}
