import { Tag } from 'antd';
const colors: Record<string,string> = {
  '待接单':'gold','未接单':'gold','待开工':'orange','待派工':'orange','未派工':'orange','待领料':'orange',
  '维修中':'blue','正在维修':'blue','回审':'orange','暂停':'purple','待检验':'cyan',
  '维修完成':'green','已完工':'green','已完结':'green','待结算':'green','完成':'green'
};
export function RepairStatusTag({status}:{status:string}) {
  return <Tag className="repair-status-tag" color={colors[status]}>{status}</Tag>;
}
