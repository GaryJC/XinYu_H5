import { Camera, Sparkles } from "lucide-react";
import { type ChangeEvent, useRef } from "react";
import { Alert, Button, Spin } from "antd";
import { VehicleHistoryLookupResult } from "../../../../shared/types";
import { IdentifierKind, IdentifierRecognitionState } from "./useVehicleIdentityRecognition";

type Props = {
  disabled?: boolean;
  recognition: Record<IdentifierKind, IdentifierRecognitionState>;
  history?: VehicleHistoryLookupResult;
  historyLoading: boolean;
  historyError: string;
  onScan: (kind: IdentifierKind, file: File) => Promise<void>;
};

export function VehicleIdentityRecognition({ disabled, recognition, history, historyLoading, historyError, onScan }: Props) {
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
      {historyLoading ? <div className="vehicle-history-loading"><Spin size="small" />正在查询公司系统车辆档案…</div> : null}
      {history ? (
        <Alert
          showIcon
          type={history.found ? "success" : "info"}
          title={history.message}
          description={history.vehicle ? `车型：${history.vehicle.model || "-"}；VIN：${history.vehicle.vin || "-"}` : undefined}
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
  const inputRef = useRef<HTMLInputElement>(null);
  const scanning = state.status === "识别中";

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) await onScan(kind, file);
  }

  return (
    <div className="identifier-scanner">
      <div>
        <strong>{title}</strong>
        <span>{state.value ? `${state.status}：${state.value}` : `${state.status} · ${hint}`}</span>
        {state.error ? <em>{state.error}</em> : null}
      </div>
      <Button
        icon={scanning ? <Sparkles size={16} /> : <Camera size={16} />}
        loading={scanning}
        disabled={disabled || scanning}
        onClick={() => inputRef.current?.click()}
      >
        拍照识别
      </Button>
      <input ref={inputRef} hidden type="file" accept="image/*" capture="environment" disabled={disabled || scanning} aria-label={title} onChange={handleChange} />
    </div>
  );
}
