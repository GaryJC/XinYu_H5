import type { PhotoSlot } from "./photoSlots";

const descriptions = {
  front45: "左前方45度整车拍摄示例，完整展示车头和左侧车身",
  rear45: "右后方45度整车拍摄示例，完整展示车尾和右侧车身",
  mileage: "仪表盘总公里数拍摄示例"
};

export function PhotoGuide({ slot }: { slot: PhotoSlot }) {
  return <div className="pre-repair-guide">
    <img src={`/photo-guides/${slot}-illustrated.jpg`} alt={descriptions[slot]} />
    <span>拍摄示例</span>
  </div>;
}
