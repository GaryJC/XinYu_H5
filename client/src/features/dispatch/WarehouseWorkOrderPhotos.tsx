import {Empty} from 'antd';
import type {WorkOrder} from '../../../../shared/types';
import {collectOrderPhotoAlbums} from '../../../../shared/orderPhotoAlbums.mjs';
import {AuthenticatedImage,AuthenticatedImagePreviewGroup} from '../../shared/ui/AuthenticatedImage';

export function WarehouseWorkOrderPhotos({order}:{order:WorkOrder}) {
 const photos=collectOrderPhotoAlbums(order).reception;
 return <section aria-label="接车时照片"><h3>接车时照片 · {photos.length} 张</h3><p>点击照片查看原图</p>
  {photos.length?<AuthenticatedImagePreviewGroup fileIds={photos.map(file=>file.id)}><div className="repair-photo-grid">{photos.map(file=><AuthenticatedImage key={file.id} fileId={file.id} alt={`接车时：${file.originalName}`} width="100%" height={150}/>)}</div></AuthenticatedImagePreviewGroup>:<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无接车时照片"/>}
 </section>;
}
