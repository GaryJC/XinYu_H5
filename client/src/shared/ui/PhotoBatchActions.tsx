import { useState } from "react";
import { Button, Checkbox, Popconfirm, Space } from "antd";

export function usePhotoSelection(ids: string[]) {
  const [selected, setSelected] = useState<string[]>([]);
  const selectedIds = selected.filter(id => ids.includes(id));
  return {
    selectedIds,
    toggle: (id: string, checked: boolean) => setSelected(current => checked ? [...new Set([...current, id])] : current.filter(value => value !== id)),
    selectAll: (checked: boolean) => setSelected(checked ? ids : []),
    clear: () => setSelected([])
  };
}

export function PhotoBatchActions({ ids, selection, disabled, onRemove }: {
  ids: string[]; selection: ReturnType<typeof usePhotoSelection>; disabled: boolean;
  onRemove: (ids: string[]) => void | Promise<unknown>;
}) {
  if (!ids.length) return null;
  return <Space wrap style={{ marginBottom: 12 }}>
    <Checkbox disabled={disabled} checked={selection.selectedIds.length === ids.length}
      indeterminate={selection.selectedIds.length > 0 && selection.selectedIds.length < ids.length}
      onChange={event => selection.selectAll(event.target.checked)}>全选照片</Checkbox>
    <Popconfirm title={`确认删除选中的 ${selection.selectedIds.length} 张照片？`} okText="删除" cancelText="取消"
      onConfirm={async () => { const result = await onRemove(selection.selectedIds); if (result !== false) selection.clear(); }}>
      <Button danger disabled={disabled || !selection.selectedIds.length}>删除所选（{selection.selectedIds.length}）</Button>
    </Popconfirm>
  </Space>;
}
