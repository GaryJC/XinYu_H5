import { Camera, Images, Sparkles } from "lucide-react";
import { type ChangeEvent, type MouseEvent } from "react";
import { Button } from "antd";

type Props = {
  disabled?: boolean;
  loading?: boolean;
  label: string;
  emphasized?: boolean;
  primaryActionLabel?: string;
  galleryActionLabel?: string;
  onSelect: (file: File) => void | Promise<void>;
};

export function ImageSourcePicker({ disabled, loading, label, emphasized, primaryActionLabel, galleryActionLabel, onSelect }: Props) {
  const pickerDisabled = disabled || loading;

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await onSelect(file);
  }

  const resetValue = (event: MouseEvent<HTMLInputElement>) => {
    event.currentTarget.value = "";
  };

  return (
    <div className={`image-source-buttons${emphasized ? " emphasized" : ""}`}>
      <div className="file-button">
        <Button
          type={emphasized ? "primary" : "default"}
          size={emphasized ? "large" : "middle"}
          icon={loading ? <Sparkles size={16} /> : <Camera size={16} />}
          loading={loading}
          disabled={pickerDisabled}
          tabIndex={-1}
        >
          {primaryActionLabel || (emphasized ? "拍照扫描" : "拍照")}
        </Button>
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
        <Button size={emphasized ? "large" : "middle"} icon={<Images size={16} />} disabled={pickerDisabled} tabIndex={-1}>{galleryActionLabel || (emphasized ? "从相册选择" : "相册")}</Button>
        <input
          type="file"
          accept="image/*"
          disabled={pickerDisabled}
          aria-label={`${label}从相册选择`}
          onClick={resetValue}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
