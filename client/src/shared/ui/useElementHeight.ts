import {useEffect,useState} from 'react';

export function useElementHeight(element:HTMLElement|null) {
  const [height,setHeight]=useState(0);
  useEffect(()=>{
    if(!element){setHeight(0);return;}
    const measure=()=>setHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const resize=typeof ResizeObserver==='undefined'?undefined:new ResizeObserver(measure);
    resize?.observe(element);
    // Older DingTalk WebViews still need to track buttons being added or removed.
    const mutations=resize?undefined:new MutationObserver(measure);
    mutations?.observe(element,{childList:true,subtree:true});
    window.addEventListener('resize',measure);
    return ()=>{resize?.disconnect();mutations?.disconnect();window.removeEventListener('resize',measure);};
  },[element]);
  return height;
}
