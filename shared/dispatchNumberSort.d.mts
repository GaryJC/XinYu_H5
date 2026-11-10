export type DispatchNumberSort = 'dispatch-desc' | 'dispatch-asc';
export const dispatchNumberSortOptions: Array<{value:DispatchNumberSort; label:string}>;
type DispatchSortable = {dispatchNo?:string|null;createdAtIso?:string|null;createdAt?:string|null};
export function compareDispatchNumbers(a:DispatchSortable, b:DispatchSortable, sort?:DispatchNumberSort):number;
