import type {DispatchTask} from '../../../../shared/types';

export type WarehouseRequestSort='newest'|'oldest';
const requestTime=(task:DispatchTask)=>{
  const value=Date.parse(task.partsRequirement?.recordedAt||'');
  return Number.isFinite(value)?value:undefined;
};
export function sortWarehouseRequests(tasks:DispatchTask[],order:WarehouseRequestSort):DispatchTask[] {
  return [...tasks].sort((a,b)=>{
    const left=requestTime(a),right=requestTime(b);
    // Requests without a recorded date stay at the end in either direction.
    if(left===undefined)return right===undefined?0:1;
    if(right===undefined)return -1;
    return order==='newest'?right-left:left-right;
  });
}
