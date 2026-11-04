import type {DispatchTask} from '../../../../shared/types';
import {canStartRepairWithParts} from '../../../../shared/repairProgress.mjs';
export function technicianPrimaryAction(task:Pick<DispatchTask,'stage'|'feedback'|'partsRequirement'|'items'>,legacyWaiting=false,startAllowed=canStartRepairWithParts(task)&&!legacyWaiting) {
 const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt);
 if(task.stage==='待接单'&&!task.feedback)return 'accept';
 if(task.stage==='暂停')return 'resume';
 if(['待开工','维修中','回审'].includes(task.stage)&&task.items.some(item=>['待开工','待派工','待领料'].includes(item.status)))return startAllowed?'start-order':undefined;
 if(waitingForParts||legacyWaiting)return;
 if(['维修中','回审'].includes(task.stage)&&task.items.some(item=>item.status==='维修中'))return 'submit-order';
}
