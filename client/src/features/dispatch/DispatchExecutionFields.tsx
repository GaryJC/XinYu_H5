import { Input, InputNumber, Select } from 'antd';
import type { DispatchExecution } from '../../../../shared/types';
import { localDateTime } from './dispatchLabels';
export const executionLabels = { internal: '店内维修', field: '外修（员工外派）', outsourced: '外包' };
export const executionTextFields = {
  serviceUnit: '服务单位', serviceAddress: '施工地址', serviceContact: '联系人及电话', contractor: '承包方'
} as const;
export const executionTimeFields = {
  departureAt: '出发时间', expectedReturnAt: '预计返回时间', returnedAt: '实际返回时间', handedOverAt: '交车时间', receivedAt: '收车时间'
} as const;
export function DispatchExecutionFields({value,onChange,allowModeChange=true,disabled=false}:{value:DispatchExecution;onChange:(value:DispatchExecution)=>void;allowModeChange?:boolean;disabled?:boolean}) {
  const mode=value.executionMode||'internal';
  const patch=(change:Partial<DispatchExecution>)=>onChange({...value,...change});
  const textKeys: Array<keyof typeof executionTextFields> = mode==='field'?['serviceUnit','serviceAddress','serviceContact']:mode==='outsourced'?['contractor','serviceAddress','serviceContact']:[];
  const timeKeys: Array<keyof typeof executionTimeFields> = mode==='field'?['departureAt','expectedReturnAt','returnedAt']:mode==='outsourced'&&value.outsourcingMode==='offsite'?['handedOverAt','receivedAt']:[];
  return <>
    <label>执行方式<Select aria-label="执行方式" disabled={disabled||!allowModeChange} value={mode} onChange={executionMode=>onChange({executionMode,...(executionMode==='outsourced'?{outsourcingMode:'onsite' as const}:{})})} options={Object.entries(executionLabels).map(([value,label])=>({value,label}))}/></label>
    {mode==='outsourced'?<label>外包施工方式<Select aria-label="外包施工方式" disabled={disabled||!allowModeChange} value={value.outsourcingMode||'onsite'} onChange={outsourcingMode=>patch({outsourcingMode,handedOverAt:undefined,receivedAt:undefined})} options={[{value:'onsite',label:'承包方到店施工'},{value:'offsite',label:'车辆外送整包维修'}]}/></label>:null}
    {textKeys.map(key=><label key={key}>{executionTextFields[key]}{['serviceUnit','serviceAddress'].includes(key)&&mode==='field'||key==='contractor'?'（必填）':''}<Input aria-label={executionTextFields[key]} disabled={disabled||key==='contractor'&&!allowModeChange} value={value[key]||''} maxLength={2000} onChange={e=>patch({[key]:e.target.value})}/></label>)}
    {mode==='outsourced'?<label>约定费用（元）<InputNumber disabled={disabled} aria-label="约定费用" min={0} max={999999999} precision={2} value={value.agreedFee} onChange={fee=>patch({agreedFee:fee})}/></label>:null}
    {timeKeys.map(key=><label key={key}>{executionTimeFields[key]}（上海时间）<Input disabled={disabled} aria-label={executionTimeFields[key]} type="datetime-local" value={localDateTime(value[key])} onChange={e=>patch({[key]:e.target.value?new Date(`${e.target.value}:00+08:00`).toISOString():''})}/></label>)}
  </>;
}
