import { useState } from 'react';
import './copy-text-button.css';
import { Button } from 'antd';
import { Check, Copy, CircleAlert } from 'lucide-react';
import { copyText } from '../browser/copyText';

// Older DingTalk WebViews and HTTP pages may not expose the Clipboard API.
export function CopyTextButton({text,label}:{text:string;label:string}) {
  const [status,setStatus]=useState<'idle'|'copied'|'failed'>('idle');
  async function copy() {
    const copied=await copyText(text);
    setStatus(copied?'copied':'failed');
  }
  const feedback = status === 'copied' ? '已复制' : status === 'failed' ? '复制失败，请重试' : '';
  const Icon = status === 'copied' ? Check : status === 'failed' ? CircleAlert : Copy;
  return <><Button type="link" className="copy-icon-button" size="small" aria-label={label} title={feedback || label} icon={<Icon size={17} aria-hidden="true" />} onClick={()=>void copy()}/><span role="status" style={{position:'absolute',width:1,height:1,padding:0,overflow:'hidden',clip:'rect(0,0,0,0)',whiteSpace:'nowrap'}}>{feedback}</span></>;

}

export function CopyActionButton({label,onClick,disabled}:{label:string;onClick:()=>void;disabled?:boolean}) {
  return <Button type="link" className="copy-icon-button" size="small" aria-label={label} title={label} disabled={disabled} icon={<Copy size={17} aria-hidden="true" />} onClick={onClick}/>;
}
