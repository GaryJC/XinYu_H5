import {useMemo,useCallback} from 'react';
import {Empty} from 'antd';
import type {ECElementEvent} from 'echarts/core';
import type {OperationsWorker,WorkloadState} from '../../../../shared/types';
import {Chart} from '../../shared/charts/Chart';
import './worker-load-chart.css';
import { workloadLabels } from "./workloadLabels";
const states=['working','waiting','paused','inspection'] as const;
const colors=['#4279d9','#2ba69a','#e7b35a','#a18ad2'];
type Props={hideTitle?:boolean;workers:OperationsWorker[];selected?:{workerId?:string;state?:WorkloadState};onSelect?:(workerId:string,state:WorkloadState)=>void};
export function WorkerLoadChart({workers,selected,onSelect,hideTitle=false}:Props){
  const top=useMemo(()=>workers.slice(0,12),[workers]);
  const option=useMemo(()=>({
    color:colors,
    textStyle:{fontFamily:'system-ui, sans-serif',color:'#66768c',fontSize:11},
    tooltip:{trigger:'axis',confine:true,renderMode:'richText'},
    grid:{left:0,right:18,top:46,bottom:12,containLabel:true},
    legend:{top:0,icon:'roundRect',itemWidth:12,itemHeight:7,textStyle:{color:'#66768c',fontSize:11}},
    xAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{color:'#edf1f7',type:'dashed'}}},
    yAxis:{type:'category',inverse:true,data:top.map(w=>w.name),axisTick:{show:false},axisLine:{show:false},axisLabel:{fontSize:11,width:100,overflow:'truncate'}},
    series:states.map((state,i)=>({id:state,name:workloadLabels[state],type:'bar',stack:'projects',barMaxWidth:20,
      data:top.map(w=>({value:w.counts[state],workerId:w.id,state,itemStyle:{color:colors[i],opacity:!selected?.state||selected.workerId===w.id&&(selected.state===state||selected.state==='unfinished')?1:0.28}}))}))
  }),[top,selected?.workerId,selected?.state]);
  const click=useCallback((event:ECElementEvent)=>{
    const point=event.data as {workerId?:string;state?:WorkloadState}|undefined;
    if(event.componentType==='series'&&point?.workerId&&point.state&&states.includes(point.state as typeof states[number]))onSelect?.(point.workerId,point.state);
  },[onSelect]);
  return <div className="worker-load-chart"><header>{!hideTitle&&<h3>维修工在手项目分布</h3>}<p>{onSelect?'点击柱状图色块，筛选下方对应工单。图中按项目数统计，工单列表按单去重。':'按本人未完成项目堆叠，显示负荷最多的 12 人；各阶段互斥，0 项不代表在岗空闲。'}</p></header>
    {!workers.length?<Empty description="暂无维修工记录"/>:<Chart option={option} label="维修工在手项目分布：维修中、未开工、暂停、待检验" onClick={onSelect?click:undefined} height={Math.max(280,top.length*40+80)}/>}
    <details className="worker-load-data"><summary>{onSelect?'查看数据 / 点击筛选':'查看图表数据'}</summary><div className="worker-load-data-scroll"><table><thead><tr><th>维修工</th>{states.map(state=><th key={state}>{workloadLabels[state]}</th>)}</tr></thead><tbody>{workers.map(w=><tr key={w.id}><th>{onSelect?<button onClick={()=>onSelect(w.id,'unfinished')} aria-label={`${w.name}，全部未完成 ${w.counts.unfinished} 项`}>{w.name}</button>:w.name}</th>{states.map(state=><td key={state}>{onSelect?<button aria-pressed={selected?.workerId===w.id&&selected.state===state} aria-label={`${w.name}，${workloadLabels[state]} ${w.counts[state]} 项`} onClick={()=>onSelect(w.id,state)}>{w.counts[state]}</button>:w.counts[state]}</td>)}</tr>)}</tbody></table></div></details>
    {onSelect&&<p className="worker-load-note">图表显示负荷最多的 12 人；其他人员和数量为 0 的状态也可在数据表中点击筛选。</p>}
  </div>;
}
