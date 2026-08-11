import { Tag } from "antd";
import { VehicleReferenceCandidate, VehicleReferenceResolution } from "../../../../shared/types";

type Props = {
  label: string;
  resolution?: VehicleReferenceResolution;
  disabled?: boolean;
  onSelect: (candidate: VehicleReferenceCandidate) => void;
};

export function VehicleReferenceTags({ label, resolution, disabled, onSelect }: Props) {
  if (!resolution || resolution.status === "not_found" || !resolution.candidates.length) return null;
  return (
    <div className="vehicle-field-candidates" aria-label={`${label}匹配候选`}>
      <span>{resolution.status === "matched" ? `已匹配${label}` : `相关${label}，请选择`}</span>
      <div>
        {resolution.candidates.map((candidate, index) => {
          const selected = candidate.code
            ? candidate.code === resolution.selected?.code
            : candidate.value === resolution.selected?.value;
          return (
            <Tag.CheckableTag
              key={`${candidate.code || candidate.value}-${candidate.usageCount}-${index}`}
              checked={selected}
              className={disabled ? "is-disabled" : ""}
              onChange={() => {
                if (!disabled) onSelect(candidate);
              }}
            >
              {candidate.value}{candidate.code ? `（${candidate.code}）` : ""} · {candidate.usageCount}辆
            </Tag.CheckableTag>
          );
        })}
      </div>
    </div>
  );
}
