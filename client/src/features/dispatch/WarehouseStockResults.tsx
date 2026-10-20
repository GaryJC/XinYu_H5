import {Empty,Tag} from 'antd';
import type {RunfengStockSearchResult} from '../../../../shared/types';
import {CopyTextButton} from '../../shared/ui/CopyTextButton';
import {displayTime} from './dispatchLabels';
export function WarehouseStockResults({result}:{result:RunfengStockSearchResult}) {
  return <div><p className="warehouse-muted">原货号 {result.query} · 库存查询于 {displayTime(result.queriedAt)}</p>
    {!result.items.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="历史货号在当前配件档案中未找到，未匹配其他型号"/>:null}
    <div className="warehouse-stock-results">{result.items.map(part=><article key={part.code} className="warehouse-stock-result" aria-label={`润丰配件 ${part.code}`}>
      <div className="warehouse-stock-title"><strong>{part.name||'未填写品名'}</strong><Tag>{part.unit||'单位未填'}</Tag></div>
      <div className="warehouse-stock-code"><code>{part.code}</code><CopyTextButton key={part.code} text={part.code} label={`复制货号 ${part.code}`}/></div>
      <dl className="warehouse-stock-meta"><div><dt>规格</dt><dd>{part.specification||'未填写'}</dd></div>{part.manufacturer?<div><dt>厂家</dt><dd>{part.manufacturer}</dd></div>:null}{part.models?<div><dt>车型</dt><dd>{part.models}</dd></div>:null}</dl>
      {part.stocks.length?<ul className="warehouse-stock-locations">{part.stocks.map((stock,i)=><li key={i}><div><strong>{stock.departmentName||stock.departmentCode}（{stock.departmentCode}） / {stock.warehouse||'仓库未填'}</strong><span>货位：{stock.location||'未填写'}</span></div><b className={stock.quantity!==null&&stock.quantity>0?'has-stock':'no-stock'}>结存 {stock.quantity??'未知'} {part.unit}</b></li>)}</ul>:<p className="warehouse-muted">该历史型号未记录分仓结存</p>}
    </article>)}</div>
  </div>;
}
