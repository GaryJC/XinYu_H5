import { useState, type ReactNode } from 'react';
import { Button, Drawer, Popover } from 'antd';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { ImageSourcePicker } from '../../shared/ui/ImageSourcePicker';
import type { PhotoResult } from './photoControls';

export function PreRepairPhotoMenu({ label, busy, mobile, adding = false, multiple = false, onSelect, onSelectMany, onRemove, guide, sourceLabel, removeLabel }: {
  label: string; busy: boolean; mobile: boolean; adding?: boolean; multiple?: boolean;
  onSelect?: (file: File) => Promise<PhotoResult>;
  onSelectMany?: (files: File[]) => Promise<PhotoResult>;
  onRemove?: () => void;
  guide?: ReactNode; sourceLabel?: string; removeLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const content = <div className="pre-repair-photo-menu">
    {onSelect && <ImageSourcePicker disabled={busy} label={sourceLabel || label} multiple={multiple}
      primaryActionLabel={adding ? '拍照上传' : '重新拍摄'} galleryActionLabel={multiple ? '相册多选' : adding ? '从相册选择' : '从相册更换'}
      onSelect={async file => { setOpen(false); await onSelect(file); }}
      onSelectMany={onSelectMany ? async files => { setOpen(false); await onSelectMany(files); } : undefined} />}
    {guide}
    {onRemove && <Button danger type="text" icon={<Trash2 size={16} />} aria-label={removeLabel} disabled={busy} onClick={() => { setOpen(false); onRemove(); }}>删除照片</Button>}
  </div>;
  const trigger = <Button type={adding ? 'default' : 'text'} icon={adding ? <Plus size={16} /> : <MoreHorizontal size={19} />}
    aria-label={adding ? `添加${label}` : `${label}操作`} disabled={busy} onClick={mobile ? () => setOpen(true) : undefined}>{adding ? '添加照片' : undefined}</Button>;
  return mobile ? <>
    {trigger}
    <Drawer title={adding ? `添加${label}` : label} placement="bottom" open={open && !busy} onClose={() => setOpen(false)} zIndex={1200}
      rootClassName="pre-repair-operation-drawer" styles={{ body: { padding: 16 } }} size="auto">
      {content}
    </Drawer>
  </> : <Popover content={content} trigger="click" placement="bottomRight" open={open && !busy} onOpenChange={setOpen}>{trigger}</Popover>;
}
