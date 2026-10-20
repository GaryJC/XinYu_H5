// Enable dispatch workflows on the dispatch development branch.
export const dispatchEnabled = true;

export function isDispatchNavigation(label: string) {
  return ["配件申请", "派工台", "我的维修", "检验任务"].includes(label);
}
