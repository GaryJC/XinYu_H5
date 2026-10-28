import {useState} from 'react';
import {Button,Checkbox,Tag} from 'antd';
import type {PartsRequirement} from '../../../../shared/types';
import {AuthenticatedImage} from '../../shared/ui/AuthenticatedImage';

export function PhotoPartsPreparation({parts,disabled,onConfirm}:{parts:PartsRequirement;disabled:boolean;onConfirm:()=>Promise<void>}) {
 const [confirmed,setConfirmed]=useState(false);
 const prepared=Boolean(parts.preparedAt||parts.issuedAt);
 return <div className="parts-preparation-item">
  <div className="repair-photo-grid">{parts.photoIds.map(id=><AuthenticatedImage key={id} fileId={id} alt="手写配件清单" width="100%" height={120}/>)}</div>
  {prepared?<Tag color="green">照片清单已备齐</Tag>:<>
   <Checkbox checked={confirmed} disabled={disabled} onChange={e=>setConfirmed(e.target.checked)}>已核对本申请全部照片，清单内配件均已备齐</Checkbox>
   <Button type="primary" disabled={disabled||!confirmed} onClick={()=>void onConfirm()}>确认本份照片清单备齐并通知</Button>
  </>}
 </div>;
}
