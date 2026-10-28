import { Camera, Images, Sparkles } from "lucide-react";
import { type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { Button, Spin } from "antd";
import "./image-source-picker.css";

type Props = {
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  label: string;
  emphasized?: boolean;
  cameraArtwork?: ReactNode;
  primaryActionLabel?: string;
  galleryActionLabel?: string;
  multiple?: boolean;
  onSelectMany?: (files: File[]) => void | Promise<void>;
  onSelect: (file: File) => void | Promise<void>;
};

export function ImageSourcePicker({ disabled, loading, loadingLabel, label, emphasized, primaryActionLabel, galleryActionLabel, cameraArtwork, multiple, onSelectMany, onSelect }: Props) {
  const pickerDisabled = disabled || loading;

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.currentTarget.files || []);
    event.currentTarget.value = "";
    if (files.length && onSelectMany) await onSelectMany(files);
    else if (files[0]) await onSelect(files[0]);
  }

  const resetValue = (event: MouseEvent<HTMLInputElement>) => {
    event.currentTarget.value = "";
  };

  return (
    <div className={`image-source-buttons${emphasized ? " emphasized" : ""}${cameraArtwork ? " has-camera-artwork" : ""}`}>
      <div className={`file-button${cameraArtwork ? " camera-source-card" : ""}${pickerDisabled ? " is-disabled" : ""}`}>
        {cameraArtwork ? (
          <div className="camera-source-artwork" aria-hidden="true">
            {cameraArtwork}
            <span className="camera-source-caption">{loading ? loadingLabel || "正在识别…" : primaryActionLabel || "拍照识别"}</span>
            <span className="camera-source-badge">{loading ? <Spin size="small" /> : <Camera size={27} strokeWidth={1.8} />}</span>
          </div>
        ) : <Button
          type="primary"
          size={emphasized ? "large" : "middle"}
          icon={loading ? <Sparkles size={16} /> : <Camera size={16} />}
          loading={loading}
          disabled={pickerDisabled}
          tabIndex={-1}
        >
          {primaryActionLabel || (emphasized ? "拍照扫描" : "拍照")}
        </Button>}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={pickerDisabled}
          aria-label={`${label}拍照`}
          onClick={resetValue}
          onChange={handleChange}
        />
      </div>
      <div className="file-button">
        <Button type="default" size={emphasized ? "large" : "middle"} icon={<Images size={16} />} disabled={pickerDisabled} tabIndex={-1}>{galleryActionLabel || (emphasized ? "从相册选择" : "相册")}</Button>
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          disabled={pickerDisabled}
          aria-label={`${label}从相册选择`}
          onClick={resetValue}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
