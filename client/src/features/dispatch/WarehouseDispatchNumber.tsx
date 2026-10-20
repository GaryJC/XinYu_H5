import {CopyTextButton} from '../../shared/ui/CopyTextButton';
export function WarehouseDispatchNumber({value}:{value?:string}) {
  const number=value?.trim();
  return <div className="warehouse-dispatch-number" aria-label="派工号"><div><span>派工号</span><strong>{number||'待润丰回填'}</strong></div>{number?<CopyTextButton key={number} text={number} label={`复制派工号 ${number}`}/>:null}</div>;
}
