import { Alert,Button,Card,Checkbox,Empty,Input,Select,Spin,Tag } from 'antd';
import type { PartsRequirement } from '../../../../shared/types';
import { CopyTextButton } from '../../shared/ui/CopyTextButton';
import { displayTime } from './dispatchLabels';
import { useWarehouseStockSearch } from './useWarehouseStockSearch';
import './warehouse-stock.css';

export function WarehouseStockSearch({orderId,requirement}:{orderId:string;requirement?:PartsRequirement}) {
  const c=useWarehouseStockSearch(orderId);
  return <Card size="small" title="润丰仓库检索" className="warehouse-stock">
    <p className="warehouse-muted">按申请名称查找润丰货号、规格及分仓结存，核对后在润丰办理出库。多个关键词用空格分隔，如“机油 5W30”。</p>
    {requirement?.mode==='list'?<div className="warehouse-stock-demands" aria-label="按申请配件检索">{requirement.items.map((item,i)=><Button key={i} size="small" disabled={c.loading} onClick={()=>void c.search(item.name)}>查 {item.name} · {item.quantity}{item.unit}</Button>)}</div>:null}
    {requirement?.mode==='photo'?<p>请对照手写清单输入配件名称或规格检索。</p>:null}
    <form aria-label="润丰配件检索" onSubmit={e=>{e.preventDefault();void c.search();}}>
      <Input aria-label="润丰配件关键词" placeholder="名称 / 货号 / 规格 / 拼音码" maxLength={80} value={c.query} disabled={c.loading} onChange={e=>c.setQuery(e.target.value)}/>
      <Select aria-label="润丰仓库筛选" placeholder="全部部门与仓库" allowClear showSearch optionFilterProp="label" value={c.warehouseId} onChange={c.changeWarehouse} disabled={c.loading||c.optionsLoading} loading={c.optionsLoading} options={c.warehouses.map(w=>({value:w.id,label:`${w.departmentName||w.departmentCode}（${w.departmentCode}） / ${w.name}`}))}/>
      <div className="warehouse-stock-toolbar"><Checkbox checked={c.inStockOnly} disabled={c.loading} onChange={e=>c.changeInStock(e.target.checked)}>仅看有结存的配件</Checkbox><Button htmlType="submit" type="primary" loading={c.loading}>检索润丰</Button></div>
    </form>
    {c.optionsError?<Alert type="warning" showIcon title={c.optionsError} action={<Button size="small" onClick={c.retryOptions}>重试仓库列表</Button>}/>:null}
    {c.error?<Alert type="error" showIcon title={c.error}/>:null}
    {c.loading?<div className="warehouse-stock-loading" role="status"><Spin/> 正在查询润丰…</div>:null}
    {c.result?<>
      <p className="warehouse-muted">“{c.result.query}” · {c.result.items.length} 个配件 · 查询于 {displayTime(c.result.queriedAt)}</p>
      {!c.result.items.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={c.inStockOnly?'未找到有结存的配件，可取消库存筛选或缩短关键词':'未找到配件，可调整名称、规格或货号'}/>:null}
      <div className="warehouse-stock-results">{c.result.items.map(part=><article key={part.code} className="warehouse-stock-result" aria-label={`润丰配件 ${part.code}`}>
        <div className="warehouse-stock-title"><strong>{part.name||'未填写品名'}</strong><Tag>{part.unit||'单位未填'}</Tag></div>
        <div className="warehouse-stock-code"><code>{part.code}</code><CopyTextButton key={part.code} text={part.code} label={`复制货号 ${part.code}`}/></div>
        <dl className="warehouse-stock-meta">
          <div><dt>规格</dt><dd>{part.specification||'未填写'}</dd></div>
          {part.manufacturer?<div><dt>厂家</dt><dd>{part.manufacturer}</dd></div>:null}
          {part.models?<div><dt>车型</dt><dd>{part.models}</dd></div>:null}
          {part.referenceCode?<div><dt>参考编号</dt><dd>{part.referenceCode}</dd></div>:null}
        </dl>
        {part.stocks.length?<ul className="warehouse-stock-locations">{part.stocks.map((stock,i)=><li key={i}><div><strong>{stock.departmentName||stock.departmentCode}（{stock.departmentCode}） / {stock.warehouse||'仓库未填'}</strong><span>货位：{stock.location||'未填写'}</span></div><b className={stock.quantity!==null&&stock.quantity>0?'has-stock':'no-stock'}>结存 {stock.quantity??'未知'} {part.unit}</b></li>)}</ul>:<p className="warehouse-muted">所选范围内未记录分仓结存</p>}
      </article>)}</div>
      {c.result.hasMore?<Alert type="info" title="仅显示前 30 个配件，请增加规格、车型等关键词或选择仓库缩小范围。"/>:null}
      <p className="warehouse-muted">结存为查询时润丰记录，未预留配件。请按规格、车型和单位核对适用性，实际数量以润丰出库时为准。</p>
    </>:null}
  </Card>;
}
