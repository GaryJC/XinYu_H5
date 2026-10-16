import { VehicleScanIllustration } from "../vehicle-identity/VehicleScanIllustration";
import { AuthenticatedImage } from "../../shared/ui/AuthenticatedImage";
import { Button, Flex } from "antd";
import { CircleCheckBig } from "lucide-react";
import { OcrFieldState, VehicleLicenseOcrResult } from "../../../../shared/types";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { normalizeOcrDate } from "./ocrUtils";

type Props = {
  state: OcrFieldState;
  result?: VehicleLicenseOcrResult;
  fileId?: string;
  disabled?: boolean;
  onScan: (file: File) => Promise<void>;
  onConfirm: () => void | Promise<void>;
};

export function VehicleLicenseOcrControl({ state, result, fileId, disabled, onScan, onConfirm }: Props) {
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

  return (
    <div className="ocr-strip compact-ocr vehicle-license-ocr">
      <div className="ocr-main">
        <strong>扫描行驶证（选填）</strong>
        <span>{state.source} · {state.status}{state.value ? ` · ${state.value}` : ""}</span>
        {fileId && <div><AuthenticatedImage fileId={fileId} alt="已上传的行驶证照片" width={160} height={100}/>
          <p>照片已上传，保存委托单时会一并保存；识别失败不影响照片保存。</p></div>}
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
        <ImageSourcePicker
          disabled={disabled || state.status === "识别中"}
          loading={state.status === "识别中"}
          label="识别行驶证照片"
          cameraArtwork={<VehicleScanIllustration kind="license" />}
          primaryActionLabel="拍照识别"
          galleryActionLabel="相册选择"
          onSelect={onScan}
        />
        <Button
          className="ocr-confirm-button"
          type={state.status === "待确认" ? "primary" : "default"}
          size="large"
          icon={<CircleCheckBig size={17} />}
          onClick={onConfirm}
          disabled={disabled || state.status !== "待确认"}
        >
          {state.status === "已确认" ? "已确认" : "确认结果"}
        </Button>
      </Flex>
    </div>
  );
}
