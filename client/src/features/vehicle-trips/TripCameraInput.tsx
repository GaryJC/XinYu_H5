import { Camera } from 'lucide-react';

export function TripCameraInput({ label, busy, disabled, onCapture, license = false }: {
  label: string; license?: boolean; busy?: boolean; disabled?: boolean; onCapture: (file: File) => void;
}) {
  return <label className="trip-upload" aria-busy={busy} aria-disabled={disabled}>
    {!license && <span className="trip-mileage-example"><img src="/photo-guides/mileage-illustrated.jpg" alt="仪表盘总公里数拍摄示例" /><span>拍摄示例 · 非上传照片</span></span>}
    <span className="trip-upload-action"><Camera size={20} /><strong>{busy ? '正在处理照片…' : '拍照上传'}</strong></span>
    <span>{license ? "拍清行驶证上的车牌号及车辆信息" : "点亮仪表盘，拍清总公里数和单位"}</span>
    <input aria-label={label} type="file" accept="image/*" capture="environment" disabled={disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onCapture(file); }} />
  </label>;
}
