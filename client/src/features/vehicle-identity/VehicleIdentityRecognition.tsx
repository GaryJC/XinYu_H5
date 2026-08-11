import { useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { VehicleHistoryLookupResult, VehicleReferenceCandidate, VehicleReferenceResolution } from "../../../../shared/types";
import { ImageSourcePicker } from "../../shared/ui/ImageSourcePicker";
import { IdentifierKind, IdentifierRecognitionState } from "./useVehicleIdentityRecognition";

type Props = {
  disabled?: boolean;
  recognition: Record<IdentifierKind, IdentifierRecognitionState>;
  history?: VehicleHistoryLookupResult;
  historyLoading: boolean;
  historyError: string;
  onScan: (kind: IdentifierKind, file: File) => Promise<void>;
  onManualLookup: (kind: IdentifierKind, value: string) => Promise<void>;
  onSelectReference: (kind: "model" | "organization", candidate: VehicleReferenceCandidate) => void;
};

export function VehicleIdentityRecognition({ disabled, recognition, history, historyLoading, historyError, onScan, onManualLookup, onSelectReference }: Props) {
  const [testPlate, setTestPlate] = useState("");

  async function submitTestPlate() {
    await onManualLookup("plate", testPlate);
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
        <div className="vehicle-test-lookup">
          <Input
            aria-label="测试车牌号码"
            disabled={disabled || historyLoading}
            placeholder="输入数据库中已有的车牌号码"
            value={testPlate}
            onChange={(event) => setTestPlate(event.target.value)}
            onPressEnter={() => void submitTestPlate()}
          />
          <Button
            disabled={disabled || historyLoading || !testPlate.trim()}
            loading={historyLoading}
            onClick={() => void submitTestPlate()}
          >
            查询并回填
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
            : history.references
              ? <ReferenceResults references={history.references} disabled={disabled} onSelect={onSelectReference} />
              : undefined}
        />
      ) : null}
      {historyError ? <Alert showIcon type="warning" title="车辆已识别，但公司系统查询失败" description={historyError} /> : null}
    </div>
  );
}

function ReferenceResults({ references, disabled, onSelect }: {
  references: NonNullable<VehicleHistoryLookupResult["references"]>;
  disabled?: boolean;
  onSelect: (kind: "model" | "organization", candidate: VehicleReferenceCandidate) => void;
}) {
  return (
    <div className="vehicle-reference-results">
      {references.model ? <ReferenceResult label="车型" kind="model" resolution={references.model} disabled={disabled} onSelect={onSelect} /> : null}
      {references.organization ? <ReferenceResult label="所属单位" kind="organization" resolution={references.organization} disabled={disabled} onSelect={onSelect} /> : null}
    </div>
  );
}

function ReferenceResult({ label, kind, resolution, disabled, onSelect }: {
  label: string;
  kind: "model" | "organization";
  resolution: VehicleReferenceResolution;
  disabled?: boolean;
  onSelect: (kind: "model" | "organization", candidate: VehicleReferenceCandidate) => void;
}) {
  if (resolution.status === "matched" && resolution.selected) {
    return <span><b>{label}：</b>已复用“{resolution.selected.value}”{resolution.selected.code ? `（编码 ${resolution.selected.code}）` : ""}</span>;
  }
  if (resolution.status === "not_found") {
    return <span><b>{label}：</b>没有匹配到已有记录，保留行驶证识别值“{resolution.input}”</span>;
  }
  return (
    <div>
      <b>{label}：</b>存在多个同名编码，请选择：
      <div className="vehicle-reference-candidates">
        {resolution.candidates.map((candidate) => (
          <Button
            key={`${candidate.code || candidate.value}-${candidate.usageCount}`}
            size="small"
            disabled={disabled}
            onClick={() => onSelect(kind, candidate)}
          >
            {candidate.value}{candidate.code ? `（${candidate.code}）` : ""} · {candidate.usageCount}辆
          </Button>
        ))}
      </div>
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
      <ImageSourcePicker disabled={disabled} loading={scanning} label={title} onSelect={(file) => onScan(kind, file)} />
    </div>
  );
}
