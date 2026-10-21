import {Alert,Button,Card,Empty,Input,Spin,Tag} from 'antd';
import type {PartsRequirement} from '../../../../shared/types';
import {CopyTextButton} from '../../shared/ui/CopyTextButton';
import {useWarehouseVehicleHistory} from './useWarehouseVehicleHistory';
import {WarehouseStockResults} from './WarehouseStockResults';
import './warehouse-stock.css';

export function WarehouseStockSearch({orderId,requirement}:{orderId:string;requirement?:PartsRequirement}) {
  const c=useWarehouseVehicleHistory(orderId,requirement?.mode==='list'?requirement.items[0]?.name||'':'');
  return <Card size="small" title="本车历史用料" className="warehouse-stock" extra={<Button size="small" loading={c.loading} disabled={c.stockLoading} onClick={c.reload}>刷新历史</Button>}>
    {c.loading?<div className="warehouse-stock-loading" role="status"><Spin/> 正在按车牌查询维修历史…</div>:null}
    {c.error?<Alert type="error" showIcon title={c.error} action={<Button size="small" onClick={c.reload}>重试</Button>}/>:null}
    {c.history?.status==='no_history'?<Alert type="info" showIcon title="本车暂无历史维修记录，已跳过仓库匹配" description="新车先按当前配件需求备料，无需完成历史型号匹配。"/>:null}
    {c.history?.status==='no_parts'?<Alert type="info" showIcon title="本车历史维修暂无可参考的用料明细，已跳过仓库匹配"/>:null}
    {c.history?.status==='found'?<>
      <p className="warehouse-muted">车牌 {c.history.plate} · 同名配件仅显示最近一次维修实际登记的型号。先核对上次所用规格，再按原货号查库存。</p>
      {requirement?.mode==='list'?<div className="warehouse-stock-demands" aria-label="按所需配件筛选历史"><Button size="small" type={!c.filter?'primary':'default'} onClick={()=>c.setFilter('')}>全部最新型号</Button>{requirement.items.map((item,i)=><Button key={i} size="small" type={c.filter===item.name?'primary':'default'} onClick={()=>c.setFilter(item.name)}>{item.name}</Button>)}</div>:null}
      <Input aria-label="筛选本车历史配件" placeholder="筛选本车历史名称、货号或规格" allowClear value={c.filter} maxLength={100} onChange={e=>c.setFilter(e.target.value)}/>
      {!c.items.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本车历史没有对应的用料型号，可查看全部最新型号；不自动改用其他车辆型号"/>:null}
      <div className="warehouse-stock-results warehouse-vehicle-history">{c.items.map((part,index)=><article key={index} className="warehouse-stock-result" aria-label={`历史用料 ${part.name} ${part.specification}`}>
        <div className="warehouse-stock-title"><strong>{part.name||'未填写品名'}</strong><Tag>{part.unit||'单位未填'}</Tag></div>
        <dl className="warehouse-stock-meta"><div><dt>上次规格</dt><dd><strong>{part.specification||'未记录'}</strong></dd></div>{part.manufacturer?<div><dt>厂家</dt><dd>{part.manufacturer}</dd></div>:null}<div><dt>上次用量</dt><dd>{part.quantity} {part.unit}</dd></div><div><dt>维修日期</dt><dd>{part.lastUsedAt||'未记录'}</dd></div><div><dt>历史派工号</dt><dd>{part.dispatchNo||'未记录'}</dd></div></dl>
        <div className="warehouse-stock-code"><code>{part.code||'历史未记录货号'}</code>{part.code?<CopyTextButton key={part.code} text={part.code} label={`复制历史货号 ${part.code}`}/>:null}</div>
        {part.code?<Button block disabled={c.stockLoading} onClick={()=>void c.lookup(part)}>按此历史货号查库存</Button>:null}
        {c.selected===part?<section className="warehouse-history-stock" aria-label="历史型号库存"><h4>该历史型号的当前库存</h4>{c.stockLoading?<div role="status"><Spin/> 正在查询原货号库存…</div>:null}{c.stockError?<Alert type="error" title={c.stockError} action={<Button size="small" onClick={()=>void c.lookup(part)}>重试</Button>}/>:null}{c.stock?<WarehouseStockResults result={c.stock}/>:null}</section>:null}
      </article>)}</div>
      {c.history.hasMore?<Alert type="info" title="展示最近 50 次维修、最多 500 条用料中的 60 个最新用料型号。"/>:null}

    </>:null}
  </Card>;
}
