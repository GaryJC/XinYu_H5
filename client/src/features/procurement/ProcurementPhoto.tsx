import {useEffect,useState} from 'react';
import {Image} from 'antd';
import {requestBlob} from '../../shared/api/httpClient';
export function ProcurementPhoto({id,portal=false,label="铭牌号照片"}:{id:string;portal?:boolean;label?:string}) {
 const [src,setSrc]=useState('');
 useEffect(()=>{if(portal)return;let active=true,url='';void requestBlob(`/api/procurement/photos/${encodeURIComponent(id)}`).then(blob=>{url=URL.createObjectURL(blob);if(active)setSrc(url);else URL.revokeObjectURL(url);}).catch(()=>{});return()=>{active=false;if(url)URL.revokeObjectURL(url);};},[id,portal]);
 return <Image src={portal?`/api/supplier-portal/photos/${encodeURIComponent(id)}`:src||undefined} alt={label} width={120} height={100} style={{objectFit:'contain'}}/>;
}
