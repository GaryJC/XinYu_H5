import { useEffect, useRef, useState } from "react";
import type { EmployeeBindingStatus, UserProfile } from "../../../../shared/types";
import { employeeBindingApi } from "./employeeBindingApi";

export function useEmployeeBinding(user: UserProfile, onBound: (user: UserProfile) => void) {
  const [status, setStatus] = useState<EmployeeBindingStatus>();
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const callback = useRef(onBound);
  callback.current = onBound;
  async function run(code?: string) {
    const requestGeneration = ++generation.current;
    setLoading(true); setError("");
    try {
      const next = code ? await employeeBindingApi.confirm(code) : await employeeBindingApi.status();
      if (requestGeneration !== generation.current) return;
      setStatus(next); setSelected(undefined);
      if (!next.required && next.employeeCode) callback.current({ ...user, legacyEmployeeCode: next.employeeCode });
    } catch (e) {
      if (requestGeneration === generation.current) setError(e instanceof Error ? e.message : "员工匹配失败，请重试");
    } finally {
      if (requestGeneration === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    setStatus(undefined); setSelected(undefined);
    void run();
    return () => { generation.current += 1; };
  }, [user.id]);
  return { status, selected, setSelected, loading, error, retry: () => run(), confirm: () => selected ? run(selected) : undefined };
}
