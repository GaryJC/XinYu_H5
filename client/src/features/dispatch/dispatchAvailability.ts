// Keep dispatch code and API contracts available while its UI is unreleased.
export const dispatchEnabled = false;

export function isDispatchNavigation(label: string) {
  return ["派工台", "维修工详情", "我的维修", "检验任务"].includes(label);
}
