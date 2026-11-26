import type {EChartsCoreOption} from 'echarts/core';
import type {AnalyticsCount, BusinessAnalytics} from '../../../../shared/types';

const palette = ['#285bc2', '#315e73', '#829bd2', '#568d91', '#a499bb', '#93a9b6', '#b8c7e8'];
const ink = '#172e47';
const muted = '#50657b';
const font = 'system-ui, -apple-system, sans-serif';
const grid = {left:4, right:12, top:28, bottom:4, outerBoundsMode:'same', outerBoundsContain:'axisLabel'};
const base = {
  color:palette,
  textStyle:{fontFamily:font, color:ink, fontSize:12},
  tooltip:{trigger:'axis', confine:true, renderMode:'richText', axisPointer:{lineStyle:{color:'#91a7c0', type:'dashed'}}},
  grid,
  legend:{top:0, left:0, itemGap:18, itemWidth:16, itemHeight:8, textStyle:{color:muted, fontSize:12}},
  yAxis:{type:'value', minInterval:1, splitNumber:4, axisLabel:{color:muted, fontSize:11}, splitLine:{lineStyle:{color:'#dfe7f0', type:'dashed'}}}
};
function category(data:string[]) {
  return {type:'category', data, axisLine:{lineStyle:{color:'#ccd8e5'}}, axisTick:{show:false},
    axisLabel:{color:muted, fontSize:11, hideOverlap:true, margin:10}};
}

export function trendOption(data:BusinessAnalytics, compare:boolean):EChartsCoreOption {
  const line = {type:'line', symbol:'circle', symbolSize:6, showSymbol:data.range.days<=14, lineStyle:{width:3}};
  const series = compare ? [
    {...line, name:'本期新建', data:data.daily.map(d=>d.created), itemStyle:{color:palette[0]}, areaStyle:{opacity:.06}},
    {...line, name:'上月新建', data:data.daily.map(d=>d.previous), lineStyle:{type:'dashed', width:2}, itemStyle:{color:'#627b90'}}
  ] : [
    {type:'bar', name:'新建委托单', data:data.daily.map(d=>d.created), barMaxWidth:22, itemStyle:{color:'#4d78cf', borderRadius:[3,3,0,0]}},
    {...line, name:'首次完工单', data:data.daily.map(d=>d.completed), itemStyle:{color:ink}}
  ];
  return {...base, grid:{...grid, top:42}, legend:{...base.legend, data:series.map(s=>s.name)},
    xAxis:category(data.daily.map(d=>d.date.slice(5))), series};
}

export function monthOption(data:BusinessAnalytics):EChartsCoreOption {
  return {...base, xAxis:category(data.monthly.map(d=>d.month.slice(2)+(d.partial?'*':''))),
    series:[{type:'bar', name:'新建委托单', barMaxWidth:28, itemStyle:{borderRadius:[3,3,0,0]},
      data:data.monthly.map(d=>({value:d.value, itemStyle:{color:d.partial?'#849ed5':palette[0]}}))}]};
}

export function donutOption(rows:AnalyticsCount[]):EChartsCoreOption {
  return {
    color:palette,
    title:{text:String(rows.reduce((sum,r)=>sum+r.value,0)), subtext:'总量', left:'center', top:'31%',
      textStyle:{fontSize:27, color:ink, fontWeight:650}, subtextStyle:{fontSize:12, color:muted}},
    tooltip:{trigger:'item', confine:true, renderMode:'richText', formatter:'{b}  {c}（{d}%）'},
    legend:{...base.legend, left:'center', top:undefined, bottom:0, type:'scroll'},
    series:[{type:'pie', radius:['49%','69%'], center:['50%','43%'], itemStyle:{borderColor:'#fff', borderWidth:3},
      label:{show:false}, data:rows}]
  };
}

export function barOption(rows:AnalyticsCount[], horizontal=false, color=palette[0]):EChartsCoreOption {
  const categories = category(rows.map(r=>r.name));
  return {...base, legend:{show:false}, grid:{...grid, top:horizontal?4:22, right:horizontal?32:10},
    xAxis:horizontal ? base.yAxis : categories,
    yAxis:horizontal ? {...categories, inverse:true, axisLine:{show:false},
      axisLabel:{...categories.axisLabel, width:90, overflow:'truncate', interval:0}} : base.yAxis,
    series:[{type:'bar', name:'数量', barMaxWidth:horizontal?12:32,
      itemStyle:{color, borderRadius:horizontal?[0,2,2,0]:[3,3,0,0]},
      label:{show:true, position:horizontal?'right':'top', color:ink, fontSize:12, fontWeight:600},
      data:rows.map(r=>r.value)}]
  };
}
