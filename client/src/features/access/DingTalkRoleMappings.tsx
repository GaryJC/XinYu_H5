import { useState } from 'react';
import { Alert,Button,Card,Collapse,Empty,Grid,Space,Table,Tag } from 'antd';
import type { AccessSettingsController } from './useAccessSettings';
import type { DingTalkRoleMapping,DingTalkDepartmentMapping,RoleKey } from '../../../../shared/types';
import { roleLabels } from './accessConfig';
import { MappingEditor,type MappingEditorTarget } from './MappingEditor';
export function DingTalkRoleMappings({controller:c}:{controller:AccessSettingsController}){
  const [editor,setEditor]=useState<MappingEditorTarget>();
  const mobile=!Grid.useBreakpoint().md;
  const state=(enabled:boolean)=><Tag color={enabled?'success':'default'}>{enabled?'启用':'停用'}</Tag>;
  return <div className="access-section">
    <Alert type="info" showIcon title="配置岗位对应关系，不直接修改员工账号" description="规则对匹配的钉钉员工生效；保存后需员工重新进入钉钉应用。部门规则仅决定门店归属，不授予操作权限。"/>
    <section className="access-rule-section">
      <div className="access-section-heading"><div><h3>角色授权</h3><p>钉钉角色 → 应用角色，决定员工可以做什么。</p></div><Button type="primary" disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'role'})}>新增角色规则</Button></div>
      {!c.mappings.roleMappings.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置自定义角色规则；同名内置规则仍可能生效。"/>:mobile?<div className="access-employee-cards">{c.mappings.roleMappings.map(row=><Card size="small" key={row.dingtalkRoleId} title={row.dingtalkRoleName} extra={<Button disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'role',value:row})}>编辑</Button>}><p className="access-caption">ID：{row.dingtalkRoleId}</p><Space wrap><Tag color="blue">{roleLabels[row.appRole]}</Tag>{state(row.enabled)}</Space><p className="access-caption">门店：{row.shopId||'按部门归属 / 默认门店'}</p></Card>)}</div>:<Table size="middle" rowKey="dingtalkRoleId" dataSource={c.mappings.roleMappings} pagination={{pageSize:10,hideOnSinglePage:true}} scroll={{x:650}} columns={[
        {title:'钉钉角色',key:'name',render:(_,row:DingTalkRoleMapping)=><div><strong>{row.dingtalkRoleName}</strong><div className="access-caption">ID：{row.dingtalkRoleId}</div></div>},
        {title:'应用角色',dataIndex:'appRole',render:(role:RoleKey)=>roleLabels[role]}, {title:'门店归属',dataIndex:'shopId',render:value=>value||'按部门 / 默认门店'},
        {title:'规则状态',dataIndex:'enabled',render:state}, {title:'操作',key:'action',render:(_,row)=><Button disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'role',value:row})}>编辑</Button>}
      ]}/>}
    </section>
    <section className="access-rule-section">
      <div className="access-section-heading"><div><h3>部门归属</h3><p>钉钉部门 → 门店，决定员工默认归属哪里。</p></div><Button disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'department'})}>新增部门规则</Button></div>
      {!c.mappings.departmentMappings.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未配置部门规则；未指定门店时使用默认门店 shop-hq。"/>:mobile?<div className="access-employee-cards">{c.mappings.departmentMappings.map(row=><Card key={row.dingtalkDepartmentId} size="small" title={row.dingtalkDepartmentName} extra={<Button disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'department',value:row})}>编辑</Button>}><p className="access-caption">ID：{row.dingtalkDepartmentId}</p><Space wrap><span>门店：{row.shopId}</span>{state(row.enabled)}</Space></Card>)}</div>:<Table size="middle" rowKey="dingtalkDepartmentId" dataSource={c.mappings.departmentMappings} pagination={{pageSize:10,hideOnSinglePage:true}} scroll={{x:550}} columns={[
        {title:'钉钉部门',key:'name',render:(_,row:DingTalkDepartmentMapping)=><div><strong>{row.dingtalkDepartmentName}</strong><div className="access-caption">ID：{row.dingtalkDepartmentId}</div></div>},
        {title:'所属门店',dataIndex:'shopId'},{title:'规则状态',dataIndex:'enabled',render:state},
        {title:'操作',key:'action',render:(_,row)=><Button disabled={!c.ready||c.loading} onClick={()=>setEditor({kind:'department',value:row})}>编辑</Button>}
      ]}/>}
    </section>
    <Collapse items={[{key:'rules',label:'查看生效规则与常见问题',children:<div className="access-section access-help"><p><strong>内置规则：</strong>钉钉角色名为“服务顾问”或“门店管理员”时，未配置自定义规则也可匹配相应角色。维修技师与检验员需配置角色 ID。</p><p><strong>优先级：</strong>同一角色 ID 的自定义规则优先；停用后不会回退内置规则。多个角色按管理员、服务顾问、检验员、维修技师依次选择。</p><p><strong>门店：</strong>角色固定门店优先，其次为匹配的启用部门规则，最后为默认门店 shop-hq。</p><p><strong>未看到员工：</strong>员工需先打开一次钉钉应用；本页员工名单只显示当前门店。</p><p><strong>停用规则：</strong>不等于停用员工，其他有效角色仍可授予权限，已经打开的页面也不会立即失效。</p></div>}]} />
    {editor?<MappingEditor target={editor} controller={c} onClose={()=>setEditor(undefined)}/>:null}
  </div>;
}
