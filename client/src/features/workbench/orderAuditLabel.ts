// Keep the original audit payload available for reconciliation; show the action in the timeline.
export function orderAuditLabel(action: string): string {
  const pull = /^从润丰维修单回拉所属单位和车型\s+\S+\s+(\{.*)$/s.exec(action);
  if (pull) {
    try {
      const changes = JSON.parse(pull[1]);
      const fields = [
        (changes.org || changes.oc) && "所属单位",
        (changes.model || changes.mc) && "车型"
      ].filter(Boolean);
      if (fields.length) return "已从润丰更新" + fields.join("和");
    } catch { /* Older or incomplete payload. */ }
    return "已从润丰更新维修单";
  }
  const edit = /^(修改联系及车辆信息|修改联系人和电话)：\s*\{/.exec(action);
  return edit ? edit[1] : action;
}
