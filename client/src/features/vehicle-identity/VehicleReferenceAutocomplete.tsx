import { useEffect, useRef, useState } from "react";
import { Button, Select } from "antd";
import { VehicleReferenceCandidate, VehicleReferenceKind } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

type Props = {
  kind: VehicleReferenceKind;
  value: string;
  code: string;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel: string;
  onSearchChange?: (value: string) => void;
  onRequestCreate?: (value: string) => void;
  onSelect: (candidate: VehicleReferenceCandidate) => void;
};

type ReferenceOption = {
  value: string;
  label: string;
  candidate: VehicleReferenceCandidate;
};

export function VehicleReferenceAutocomplete({ kind, value, code, disabled, placeholder, ariaLabel, onSearchChange, onRequestCreate, onSelect }: Props) {
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchValue, setSearchValue] = useState("");
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
          value: candidate.code || candidate.value,
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

  const selectedOption = code ? {
    value: code,
    label: `${value}（${code}）`,
    candidate: { value, code, usageCount: 0 }
  } : undefined;
  const visibleOptions = selectedOption && !options.some((option) => option.value === code)
    ? [selectedOption, ...options]
    : options;
  const label = kind === "model" ? "车型" : "所属单位";
  const emptyContent = searchError || (
    <div className="vehicle-reference-empty">
      <span>没有相关记录</span>
      {searchValue.trim() && onRequestCreate ? (
        <Button
          type="link"
          size="small"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen(false);
            onRequestCreate(searchValue.trim());
          }}
        >
          新增“{searchValue.trim()}”
        </Button>
      ) : <span>请使用下方“新增{label}”</span>}
    </div>
  );

  return (
    <Select
      value={code || undefined}
      searchValue={searchValue}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={!code && value ? `待确认：${value}（点击搜索或新增）` : placeholder}
      options={visibleOptions}
      open={open}
      showSearch
      filterOption={false}
      notFoundContent={loading ? "正在查询公司数据库…" : emptyContent}
      onSearch={(query) => {
        setSearchValue(query);
        onSearchChange?.(query);
        search(query);
      }}
      onFocus={() => {
        const initialQuery = searchValue || (!code ? value : "");
        if (initialQuery) {
          setSearchValue(initialQuery);
          onSearchChange?.(initialQuery);
          search(initialQuery);
        }
      }}
      onOpenChange={setOpen}
      onSelect={(_selectedValue, option) => {
        setOpen(false);
        setSearchValue("");
        onSearchChange?.("");
        onSelect((option as ReferenceOption).candidate);
      }}
    />
  );
}

function normalizeSearch(value: string) {
  return value.normalize("NFKC").trim().replace(/[\s\-_]/g, "");
}
