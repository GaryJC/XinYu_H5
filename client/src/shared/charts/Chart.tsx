import {useEffect,useRef} from 'react';
import {init,use,type ECElementEvent,type EChartsCoreOption} from 'echarts/core';
import {BarChart,LineChart,PieChart} from 'echarts/charts';
import {TitleComponent,GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,AriaComponent} from 'echarts/components';
import {CanvasRenderer} from 'echarts/renderers';
use([BarChart,LineChart,PieChart,TitleComponent,GridComponent,TooltipComponent,LegendComponent,DataZoomComponent,AriaComponent,CanvasRenderer]);

export function Chart({option,label,height=300,onClick}:{option:EChartsCoreOption;label:string;height?:number;onClick?:(event:ECElementEvent)=>void}){
  const host=useRef<HTMLDivElement>(null);
  const instance=useRef<ReturnType<typeof init>|null>(null);
  useEffect(()=>{
    if(!host.current)return;
    const chart=init(host.current);instance.current=chart;
    const resize=()=>chart.resize();
    // Older DingTalk WebViews may not provide ResizeObserver.
    const observer=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(resize);
    observer?.observe(host.current);window.addEventListener('resize',resize);
    return()=>{observer?.disconnect();window.removeEventListener('resize',resize);chart.dispose();instance.current=null;};
  },[]);
  useEffect(()=>{instance.current?.setOption({...option,animation:!window.matchMedia('(prefers-reduced-motion: reduce)').matches,aria:{enabled:true,description:label}},true);},[option,label]);
  useEffect(()=>{const chart=instance.current;if(!chart||!onClick)return;chart.on('click',onClick);return()=>{chart.off('click',onClick);};},[onClick]);
  return <div ref={host} role="img" aria-label={label} style={{height,width:'100%',minWidth:0}}/>;
}
