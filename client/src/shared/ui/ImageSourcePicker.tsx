import { Camera, Images, Sparkles } from "lucide-react";
import { type ChangeEvent, type MouseEvent } from "react";
import { Button } from "antd";

type Props = {
  disabled?: boolean;
  loading?: boolean;
  label: string;
  onSelect: (file: File) => void | Promise<void>;
};

export function ImageSourcePicker({ disabled, loading, label, onSelect }: Props) {
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
    <div className="image-source-buttons">
      <div className="file-button">
        <Button
          icon={loading ? <Sparkles size={16} /> : <Camera size={16} />}
          loading={loading}
          disabled={pickerDisabled}
          tabIndex={-1}
        >
          拍照
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
        <Button icon={<Images size={16} />} disabled={pickerDisabled} tabIndex={-1}>相册</Button>
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
