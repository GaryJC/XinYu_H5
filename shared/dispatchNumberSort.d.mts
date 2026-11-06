export type DispatchNumberSort = 'dispatch-desc' | 'dispatch-asc';
export const dispatchNumberSortOptions: Array<{value:DispatchNumberSort; label:string}>;
export function compareDispatchNumbers(a:{dispatchNo?:string|null}, b:{dispatchNo?:string|null}, sort?:DispatchNumberSort):number;
