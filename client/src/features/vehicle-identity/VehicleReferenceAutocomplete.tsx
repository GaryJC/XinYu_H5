import { useEffect, useRef, useState } from "react";
import { AutoComplete, Button } from "antd";
import { VehicleReferenceCandidate, VehicleReferenceKind } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

type Props = {
  kind: VehicleReferenceKind;
  value: string;
  code: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onRequestCreate?: (value: string) => void;
  onClear?: () => void;
  onSelect: (candidate: VehicleReferenceCandidate) => void;
};

type ReferenceOption = {
  key: string;
  value: string;
  label: string;
  candidate: VehicleReferenceCandidate;
};

export function VehicleReferenceAutocomplete({ kind, value, disabled, placeholder, ariaLabel, onChange, onRequestCreate, onClear, onSelect }: Props) {
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
          key: candidate.code || candidate.value,
          value: candidate.value,
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

  const label = kind === "model" ? "车型" : "所属单位";
  const emptyContent = searchError || (
    <div className="vehicle-reference-empty">
      <span>没有相关记录</span>
      {searchQuery.trim() && onRequestCreate ? (
        <Button
          type="link"
          size="small"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(false);
            onRequestCreate(searchQuery.trim());
          }}
        >
          新增“{searchQuery.trim()}”
        </Button>
      ) : <span>请使用下方“新增{label}”</span>}
    </div>
  );

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
      notFoundContent={loading ? "正在查询公司数据库…" : emptyContent}
      onChange={(nextValue) => {
        setSearchQuery(nextValue);
        onChange(nextValue);
      }}
      onSearch={(query) => {
        setSearchQuery(query);
        search(query);
      }}
      onFocus={() => search(value)}
      onOpenChange={setOpen}
      onClear={() => {
        setSearchQuery("");
        setOptions([]);
        setOpen(false);
        onClear?.();
      }}
      onSelect={(selectedValue, option) => {
        const selectedOption = options.find((item) => item.key === String(option.key) || item.value === selectedValue);
        if (!selectedOption) return;
        setOpen(false);
        setSearchQuery("");
        onSelect(selectedOption.candidate);
      }}
    />
  );
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").trim().replace(/[\s\-_]/g, "");
}
