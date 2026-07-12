import { Camera, Sparkles } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Button, Flex } from "antd";
import { OcrFieldState, VehicleLicenseOcrResult } from "../../../../shared/types";
import { normalizeOcrDate } from "./ocrUtils";

type Props = {
  state: OcrFieldState;
  result?: VehicleLicenseOcrResult;
  disabled?: boolean;
  onScan: (file: File) => Promise<void>;
  onConfirm: () => void | Promise<void>;
};

export function VehicleLicenseOcrControl({ state, result, disabled, onScan, onConfirm }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scanDisabled = disabled || state.status === "识别中";
  const resultFields = result
    ? [
        ["车牌", result.plate],
        ["VIN", result.vin],
        ["车型", result.model],
        ["车主", result.owner],
        ["住址", result.address],
        ["注册日期", normalizeOcrDate(result.registerDate) || result.registerDate]
      ].filter(([, value]) => Boolean(value))
    : [];

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await onScan(file);
  }

  return (
    <div className="ocr-strip compact-ocr vehicle-license-ocr">
      <div className="ocr-main">
        <strong>扫描行驶证</strong>
        <span>{state.source} · {state.status}{state.value ? ` · ${state.value}` : ""}</span>
        {state.error ? <em>{state.error}</em> : null}
        {resultFields.length ? (
          <div className="ocr-result-grid">
            {resultFields.map(([label, value]) => (
              <span key={label}>
                <b>{label}</b>
                {value}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <Flex className="button-row" gap={8} wrap="wrap">
        <div className="file-button">
          <Button
            icon={state.status === "识别中" ? <Sparkles size={16} /> : <Camera size={16} />}
            loading={state.status === "识别中"}
            disabled={scanDisabled}
            onClick={() => inputRef.current?.click()}
          >
            拍照识别
          </Button>
          <input ref={inputRef} hidden type="file" accept="image/*" capture="environment" disabled={scanDisabled} onChange={handleFileChange} />
        </div>
        <Button type="link" onClick={onConfirm} disabled={disabled || state.status !== "待确认"}>确认</Button>
      </Flex>
    </div>
  );
}
