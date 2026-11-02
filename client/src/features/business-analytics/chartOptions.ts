import type {EChartsCoreOption} from 'echarts/core';
import type {AnalyticsCount,BusinessAnalytics} from '../../../../shared/types';
export const palette=['#4279d9','#2ba69a','#e7b35a','#a18ad2','#e3807b','#7b9bad','#7dbe99'];
const base={color:palette,textStyle:{fontFamily:'system-ui, sans-serif',color:'#66768c',fontSize:11},tooltip:{trigger:'axis',confine:true,renderMode:'richText'},grid:{left:12,right:18,top:46,bottom:12,containLabel:true},legend:{top:0,icon:'roundRect',itemWidth:12,itemHeight:7,textStyle:{color:'#66768c',fontSize:11}},yAxis:{type:'value',minInterval:1,splitLine:{lineStyle:{color:'#edf1f7',type:'dashed'}},axisLabel:{color:'#8a97a8'}}};
const category=(data:string[])=>({type:'category',data,axisLine:{lineStyle:{color:'#e5ebf2'}},axisTick:{show:false},axisLabel:{color:'#8a97a8',fontSize:10,hideOverlap:true}});
export function trendOption(data:BusinessAnalytics,compare:boolean):EChartsCoreOption{
  const series=compare?[
    {name:'本期新建',type:'line',data:data.daily.map(d=>d.created),itemStyle:{color:palette[0]},areaStyle:{opacity:0.08}},
    {name:'上期新建（日期平移对照）',type:'line',data:data.daily.map(d=>d.previous),lineStyle:{type:'dashed'},itemStyle:{color:'#aab8ca'}}
  ]:[{name:'新建委托单',type:'bar',data:data.daily.map(d=>d.created),barMaxWidth:18,itemStyle:{borderRadius:[3,3,0,0]}},
    {name:'首次完工单',type:'line',data:data.daily.map(d=>d.completed),itemStyle:{color:palette[1]}}];
  return {...base,legend:{...base.legend,data:series.map(s=>s.name)},xAxis:category(data.daily.map(d=>d.date.slice(5))),series:series.map(s=>({...s,symbol:'circle',symbolSize:5,showSymbol:data.range.days<=30})),
    ...(data.range.days>90?{dataZoom:[{type:'inside'},{type:'slider',height:16,bottom:0}],grid:{...base.grid,bottom:40}}:{})};
}
export function monthOption(data:BusinessAnalytics):EChartsCoreOption{
  return {...base,grid:{...base.grid,top:20},xAxis:category(data.monthly.map(d=>d.month.slice(2)+(d.partial?'*':''))),series:[{name:'新建委托单',type:'bar',barMaxWidth:28,data:data.monthly.map(d=>({value:d.value,itemStyle:{color:d.partial?'#bad0f3':palette[0],borderRadius:[4,4,0,0]}}))}]};
}
export function donutOption(rows:AnalyticsCount[]):EChartsCoreOption{
  return {color:palette,title:{text:String(rows.reduce((sum,r)=>sum+r.value,0)),subtext:'总量',left:'center',top:'32%',textStyle:{fontSize:28,color:'#253750',fontWeight:600},subtextStyle:{fontSize:11,color:'#8a97a8'}},tooltip:{trigger:'item',confine:true,renderMode:'richText',formatter:'{b}: {c}（{d}%）'},legend:{bottom:0,type:'scroll',textStyle:{fontSize:11,color:'#66768c'}},series:[{type:'pie',radius:['48%','70%'],center:['50%','43%'],avoidLabelOverlap:true,itemStyle:{borderRadius:5,borderColor:'#fff',borderWidth:3},label:{show:false},emphasis:{label:{show:true,fontSize:14,fontWeight:'bold',formatter:'{b}\n{c}'}},data:rows}]};
}
export function barOption(rows:AnalyticsCount[],horizontal=false,color=palette[0]):EChartsCoreOption{
  return {...base,grid:{...base.grid,top:15},xAxis:horizontal?base.yAxis:category(rows.map(r=>r.name)),yAxis:horizontal?{...category(rows.map(r=>r.name)),inverse:true,axisLabel:{fontSize:11,width:95,overflow:'truncate'}}:base.yAxis,
    series:[{name:'数量',type:'bar',barMaxWidth:26,label:{show:true,position:horizontal?'right':'top',color:'#50657b'},itemStyle:{color,borderRadius:horizontal?[0,4,4,0]:[4,4,0,0]},data:rows.map(r=>r.value)}]};
}
