import {useState} from 'react';
import type {UserProfile} from '../../../../shared/types';
import {canEditDispatchTechnicians,requiredDispatchTechnicians} from '../../../../shared/dispatchTechniciansPolicy.mjs';
import type {DispatchController} from './useDispatchController';

export function useTaskTechniciansEditor(c:DispatchController,user:UserProfile,blocked:boolean) {
  const task=c.detail!.task;
  const [version,setVersion]=useState<number>();
  const [ids,setIds]=useState<string[]>([]);
  const [failed,setFailed]=useState(false);
  const allowed=canEditDispatchTechnicians(task,user);
  const required=requiredDispatchTechnicians(task);
  const current=task.technicianIds??(task.technicianId?[task.technicianId]:[]);
  const selected=new Set([...current,...required]);
  const options=new Map(c.people.technicians.filter(p=>p.active||selected.has(p.id)).map(p=>[p.id,{value:p.id,label:`${p.name}${p.active?'':'（停用）'}`,disabled:required.includes(p.id)}]));
  for(const id of selected)if(!options.has(id))options.set(id,{value:id,label:task.items.find(i=>i.responsibleId===id)?.responsibleName||id,disabled:required.includes(id)});
  const stale=version!==undefined&&task.version!==version;
  function begin(){setIds([...selected]);setVersion(task.version);setFailed(false);}
  const changed=ids.length!==current.length||ids.some((id,index)=>id!==current[index]);
  const valid=allowed&&!stale&&!blocked&&ids.length>0&&required.every(id=>ids.includes(id))&&changed;
  async function save(){
    if(!valid||c.busy)return;
    if(await c.act({action:'update-technicians',technicianIds:ids}))setVersion(undefined);
    else setFailed(true);
  }
  return {task,allowed,open:version!==undefined,stale,valid,failed,ids,options:[...options.values()],begin,save,
    change:(values:string[])=>setIds([...new Set([...values,...required])]),close:()=>{if(!c.busy)setVersion(undefined);}};
}
