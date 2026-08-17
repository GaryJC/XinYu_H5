import { useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { VehicleHistoryLookupResult, VehicleLookupInput } from "../../../../shared/types";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { IdentifierKind, IdentifierRecognitionState } from "./useVehicleIdentityRecognition";
import { VehicleReferenceAutocomplete } from "./VehicleReferenceAutocomplete";

type Props = {
  disabled?: boolean;
  recognition: Record<IdentifierKind, IdentifierRecognitionState>;
  history?: VehicleHistoryLookupResult;
  historyLoading: boolean;
  historyError: string;
  onScan: (kind: IdentifierKind, file: File) => Promise<void>;
  onManualLicenseLookup: (input: VehicleLookupInput) => Promise<void>;
};

export function VehicleIdentityRecognition({ disabled, recognition, history, historyLoading, historyError, onScan, onManualLicenseLookup }: Props) {
  const [testLicense, setTestLicense] = useState<VehicleLookupInput>({ plate: "", vin: "", model: "", owner: "" });

  async function submitTestLicense() {
    await onManualLicenseLookup(testLicense);
  }

  return (
    <div className="vehicle-identity-section">
      <div className="vehicle-identity-heading">
        <strong>快速识别车辆</strong>
        <span>拍摄车牌或车架上的 VIN 码，识别后自动查询公司系统车辆档案。</span>
      </div>
      <div className="vehicle-identity-grid">
        <IdentifierScanner kind="plate" title="识别车牌号" hint="请将完整车牌置于画面中央" disabled={disabled} state={recognition.plate} onScan={onScan} />
        <IdentifierScanner kind="vin" title="识别 VIN 码" hint="请对准车架上的 17 位识别码" disabled={disabled} state={recognition.vin} onScan={onScan} />
      </div>
      {import.meta.env.DEV ? (
        <div className="vehicle-test-license">
          <strong>DEV 行驶证匹配测试</strong>
          <span>模拟行驶证 OCR 返回，不上传图片、不创建 OCR 记录。</span>
          <div className="vehicle-test-license-fields">
            <Input aria-label="测试行驶证车牌号码" disabled={disabled || historyLoading} placeholder="车牌号码" value={testLicense.plate} onChange={(event) => setTestLicense((current) => ({ ...current, plate: event.target.value }))} />
            <Input aria-label="测试行驶证VIN" disabled={disabled || historyLoading} placeholder="VIN/底盘号" value={testLicense.vin} onChange={(event) => setTestLicense((current) => ({ ...current, vin: event.target.value }))} />
            <VehicleReferenceAutocomplete
              kind="model"
              ariaLabel="测试行驶证车型"
              disabled={disabled || historyLoading}
              placeholder="车型，例如大众"
              value={testLicense.model || ""}
              code=""
              onSearchChange={(value) => setTestLicense((current) => ({ ...current, model: value }))}
              onClear={() => setTestLicense((current) => ({ ...current, model: "" }))}
              onSelect={(candidate) => setTestLicense((current) => ({ ...current, model: candidate.value }))}
            />
            <VehicleReferenceAutocomplete
              kind="organization"
              ariaLabel="测试行驶证所有人"
              disabled={disabled || historyLoading}
              placeholder="所有人/所属单位，例如水务公司"
              value={testLicense.owner || ""}
              code=""
              onSearchChange={(value) => setTestLicense((current) => ({ ...current, owner: value }))}
              onClear={() => setTestLicense((current) => ({ ...current, owner: "" }))}
              onSelect={(candidate) => setTestLicense((current) => ({ ...current, owner: candidate.value }))}
            />
          </div>
          <Button
            disabled={disabled || historyLoading || (!testLicense.plate?.trim() && !testLicense.vin?.trim())}
            loading={historyLoading}
            onClick={() => void submitTestLicense()}
          >
            模拟识别并匹配
          </Button>
        </div>
      ) : null}
      {historyLoading ? <div className="vehicle-history-loading"><Spin size="small" />正在查询公司系统车辆档案…</div> : null}
      {history ? (
        <Alert
          showIcon
          type={history.status === "conflict" ? "error" : history.found ? "success" : "info"}
          title={history.message}
          description={history.vehicle
            ? `车型：${history.vehicle.model || "-"}；所属单位：${history.vehicle.organization?.name || "-"}；VIN：${history.vehicle.vin || "-"}`
            : undefined}
        />
      ) : null}
      {historyError ? <Alert showIcon type="warning" title="车辆已识别，但公司系统查询失败" description={historyError} /> : null}
    </div>
  );
}

function IdentifierScanner({ kind, title, hint, disabled, state, onScan }: {
  kind: IdentifierKind;
  title: string;
  hint: string;
  disabled?: boolean;
  state: IdentifierRecognitionState;
  onScan: (kind: IdentifierKind, file: File) => Promise<void>;
}) {
  const scanning = state.status === "识别中";

  return (
    <div className="identifier-scanner">
      <div>
        <strong>{title}</strong>
        <span>{state.value ? `${state.status}：${state.value}` : `${state.status} · ${hint}`}</span>
        {state.error ? <em>{state.error}</em> : null}
      </div>
      <ImageSourcePicker
        emphasized
        disabled={disabled}
        loading={scanning}
        label={title}
        primaryActionLabel={`拍照${title}`}
        galleryActionLabel="从相册选择"
        onSelect={(file) => onScan(kind, file)}
      />
    </div>
  );
}
