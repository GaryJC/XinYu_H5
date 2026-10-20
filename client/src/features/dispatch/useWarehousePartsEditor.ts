import {useState} from 'react';
import type {PartsRequirement} from '../../../../shared/types';
import type {DispatchController} from './useDispatchController';

export function useWarehousePartsEditor(c:DispatchController) {
  const saved=c.detail!.task.partsRequirement;
  const [initialVersion]=useState(c.detail!.task.version);
  const [items,setItems]=useState<PartsRequirement['items']>(()=>(saved?.items||[]).map(item=>({...item})));
  const [none,setNone]=useState(saved?.mode==='none'),[error,setError]=useState('');
  function update(index:number,patch:Partial<PartsRequirement['items'][number]>) {setItems(rows=>rows.map((r,i)=>i===index?{...r,...patch}:r));}
  function add(){setNone(false);setItems(rows=>[...rows,{name:'',quantity:1,unit:'个'}]);}
  function remove(index:number){setItems(rows=>rows.filter((_,i)=>i!==index));}
  async function save() {
    if(c.detail!.task.version!==initialVersion){setError('配件需求已更新，请关闭后重新打开编辑');return false;}
    if(!none&&(!items.length||items.some(i=>!i.name.trim()||!i.unit.trim()||!Number.isFinite(i.quantity)||i.quantity<=0))){setError('请填写配件名称、有效数量和单位；全部删除时请选择无需配件');return false;}
    setError('');return c.act({action:'edit-parts',partsRequirement:{mode:none?'none':'list',items:none?[]:items,photoIds:[]}});
  }
  return{items,none,setNone,error,update,add,remove,save};
}
