import {AuthenticatedImage,AuthenticatedImagePreviewGroup} from '../../shared/ui/AuthenticatedImage';
export function PartsReferencePhotos({ids}:{ids?:string[]}){
 if(!ids?.length)return null;
 return <section aria-label="配件照片" className="parts-reference-photos"><h4>配件照片 · {ids.length} 张</h4><AuthenticatedImagePreviewGroup fileIds={ids}><div className="repair-photo-grid">{ids.map((id,index)=><AuthenticatedImage key={id} fileId={id} alt={`配件照片 ${index+1}`} width="100%" height={120}/>)}</div></AuthenticatedImagePreviewGroup></section>;
}
