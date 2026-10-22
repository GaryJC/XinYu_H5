import type {DispatchTask} from '../../../../shared/types';
export function technicianPrimaryAction(task:Pick<DispatchTask,'stage'|'feedback'|'partsRequirement'|'items'>) {
 const waitingForParts=Boolean(task.partsRequirement&&task.partsRequirement.mode!=='none'&&!task.partsRequirement.issuedAt&&!task.partsRequirement.preparedAt);
 if(task.stage==='待接单'&&!task.feedback)return 'accept';
 if(task.stage==='暂停')return 'resume';
 if(waitingForParts)return;
 if(task.stage==='回审'&&task.items.some(item=>item.status==='维修中'))return 'submit-order';
 if(['待开工','维修中'].includes(task.stage)&&task.items.some(item=>['待开工','待派工','待领料'].includes(item.status)))return 'start-order';
 if(task.stage==='维修中'&&task.items.some(item=>item.status==='维修中'))return 'submit-order';
}
