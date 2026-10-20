import { useState } from 'react';
import { Button } from 'antd';

// Older DingTalk WebViews and HTTP pages may not expose the Clipboard API.
export function CopyTextButton({text,label}:{text:string;label:string}) {
  const [status,setStatus]=useState<'idle'|'copied'|'failed'>('idle');
  async function copy() {
    let copied=false;
    try{if(navigator.clipboard){await navigator.clipboard.writeText(text);copied=true;}}catch{/* Try the WebView fallback below. */}
    if(!copied){
      const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;
      const input=document.createElement('textarea');input.value=text;input.readOnly=true;
      input.style.cssText='position:fixed;top:0;left:0;opacity:0;pointer-events:none';document.body.appendChild(input);
      try{input.select();input.setSelectionRange(0,input.value.length);copied=document.execCommand('copy');}catch{copied=false;}finally{input.remove();focused?.focus({preventScroll:true});}
    }
    setStatus(copied?'copied':'failed');
  }
  return <Button size="small" aria-label={label} onClick={()=>void copy()}>{status==='copied'?'已复制':status==='failed'?'复制失败，请重试':'复制'}</Button>;
}
