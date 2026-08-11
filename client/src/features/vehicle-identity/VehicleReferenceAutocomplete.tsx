import { useEffect, useRef, useState } from "react";
import { AutoComplete } from "antd";
import { VehicleReferenceCandidate, VehicleReferenceKind } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

type Props = {
  kind: VehicleReferenceKind;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onSelect: (candidate: VehicleReferenceCandidate) => void;
};

type ReferenceOption = {
  value: string;
  label: string;
  candidate: VehicleReferenceCandidate;
};

export function VehicleReferenceAutocomplete({ kind, value, disabled, placeholder, ariaLabel, onChange, onSelect }: Props) {
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const requestSequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    requestSequence.current += 1;
  }, []);

  function search(query: string) {
    if (timer.current) clearTimeout(timer.current);
    const sequence = ++requestSequence.current;
    if (normalizeSearch(query).length < 2) {
      setOptions([]);
      setLoading(false);
      setSearchError("");
      setOpen(false);
      return;
    }
    setLoading(true);
    setSearchError("");
    setOpen(true);
    timer.current = setTimeout(async () => {
      try {
        const result = await workOrderApi.searchVehicleReferences(kind, query);
        if (sequence !== requestSequence.current) return;
        setOptions(result.candidates.map((candidate) => ({
          value: candidate.code ? `${candidate.value}（${candidate.code}）` : candidate.value,
          label: `${candidate.value}${candidate.code ? `（${candidate.code}）` : ""} · ${candidate.usageCount}辆`,
          candidate
        })));
        setLoading(false);
      } catch (error) {
        if (sequence === requestSequence.current) {
          setOptions([]);
          setLoading(false);
          setSearchError(error instanceof Error ? error.message : "查询失败，请重试");
          setOpen(true);
        }
      }
    }, 300);
  }

  return (
    <AutoComplete
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      options={options}
      open={open}
      allowClear
      filterOption={false}
      notFoundContent={loading ? "正在查询公司数据库…" : searchError || "没有相关记录"}
      onChange={onChange}
      onSearch={search}
      onFocus={() => search(value)}
      onOpenChange={setOpen}
      onSelect={(_selectedValue, option) => {
        setOpen(false);
        onSelect((option as ReferenceOption).candidate);
      }}
    />
  );
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").trim().replace(/[\s\-_]/g, "");
}
