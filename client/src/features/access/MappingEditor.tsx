import { useState } from 'react';
import { Alert,Form,Input,Modal,Select,Switch } from 'antd';
import type { DingTalkRoleMapping,DingTalkDepartmentMapping,RoleKey } from '../../../../shared/types';
import type { AccessSettingsController } from './useAccessSettings';
import { roleDescriptions,roleOptions } from './accessConfig';
export type MappingEditorTarget={kind:'role';value?:DingTalkRoleMapping}|{kind:'department';value?:DingTalkDepartmentMapping};
export function MappingEditor({target,controller,onClose}:{target:MappingEditorTarget;controller:AccessSettingsController;onClose:()=>void}){
  const role=target.kind==='role',editing=Boolean(target.value);
  const originalId=target.value?(target.kind==='role'?target.value.dingtalkRoleId:target.value.dingtalkDepartmentId):'';
  const originalName=target.value?(target.kind==='role'?target.value.dingtalkRoleName:target.value.dingtalkDepartmentName):'';
  const [id,setId]=useState(originalId),[name,setName]=useState(originalName),[shopId,setShopId]=useState(target.value?.shopId||''),[enabled,setEnabled]=useState(target.value?.enabled??true);
  const [appRole,setAppRole]=useState<RoleKey>(target.kind==='role'?target.value?.appRole||'technician':'technician');
  const [error,setError]=useState('');
  async function save(){
    setError('');if(!id.trim()||!name.trim()||(!role&&!shopId.trim())){setError('请填写所有必填项');return;}
    const exists=role?controller.mappings.roleMappings.some(item=>item.dingtalkRoleId===id.trim()):controller.mappings.departmentMappings.some(item=>item.dingtalkDepartmentId===id.trim());
    if(!editing&&exists){setError('该 ID 已有规则，请关闭窗口后编辑已有规则');return;}
    const common={shopId:shopId.trim()||undefined,enabled};
    const result=role?await controller.save('role',{...common,dingtalkRoleId:id.trim(),dingtalkRoleName:name.trim(),appRole,homeRoute:target.kind==='role'&&target.value?.appRole===appRole?target.value.homeRoute:appRole==='advisor'?'order-create':'workbench'}):await controller.save('department',{...common,shopId:shopId.trim(),dingtalkDepartmentId:id.trim(),dingtalkDepartmentName:name.trim()});
    if(result)setError(result);else onClose();
  }
  return <Modal open title={`${editing?'编辑':'新增'}${role?'角色授权':'部门归属'}规则`} onCancel={()=>{if(!controller.saving)onClose();}} onOk={()=>void save()} confirmLoading={controller.saving} cancelButtonProps={{disabled:controller.saving}} okText="保存规则" cancelText="取消" maskClosable={false} closable={!controller.saving} keyboard={!controller.saving}>
    <Form layout="vertical" className="access-rule-form" disabled={controller.saving}>
      {error?<Alert type="error" showIcon title={error}/>:null}
      <Form.Item label={role?'钉钉角色 ID':'钉钉部门 ID'} required extra={editing?'ID 不可修改；如需关联其他角色或部门，请新增规则。':'请从钉钉管理后台获取准确 ID，不能用名称代替。'}><Input aria-label={role?'钉钉角色 ID':'钉钉部门 ID'} disabled={editing||controller.saving} value={id} onChange={e=>setId(e.target.value)}/></Form.Item>
      <Form.Item label={role?'钉钉角色名称':'钉钉部门名称'} required><Input aria-label={role?'钉钉角色名称':'钉钉部门名称'} value={name} onChange={e=>setName(e.target.value)}/></Form.Item>
      {role?<Form.Item label="应用角色" required extra={roleDescriptions[appRole].abilities}><Select aria-label="应用角色" options={roleOptions} value={appRole} onChange={setAppRole}/></Form.Item>:null}
      <Form.Item label={role?'固定门店 ID（可选）':'所属门店 ID'} required={!role} extra={role?'留空时按部门归属；未匹配部门时使用默认门店 shop-hq。填写后优先于部门规则。':'填写系统门店 ID，例如 shop-hq。部门只决定归属门店，不授予角色权限。'}><Input aria-label="映射门店 ID" placeholder={role?'按部门归属自动确定':'例如 shop-hq'} value={shopId} onChange={e=>setShopId(e.target.value)}/></Form.Item>
      <Form.Item label="规则状态"><Switch aria-label="启用角色映射" checked={enabled} onChange={setEnabled} checkedChildren="启用" unCheckedChildren="停用"/></Form.Item>
      <Alert type={enabled?'info':'warning'} showIcon title={enabled?'下次钉钉免登时生效':'仅停用这条规则，不等于停用员工'} description={enabled?'同一员工匹配多个角色时，按角色优先级取一个应用角色。':role?'员工仍可能通过其他角色获得权限；该角色的内置同名规则不会回退启用。':'员工仍可能通过角色的固定门店或其他部门规则确定门店。'}/>
    </Form>
  </Modal>;
}
