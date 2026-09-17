import { useEffect,useState } from 'react';
import { Alert,Button,Input,Select,Space,Switch,Table } from 'antd';
import type { DingTalkMappings,DingTalkRoleMapping,RoleKey } from '../../../../shared/types';
import { request } from '../../shared/api/httpClient';
export function DingTalkRoleMappings() {
  const [mappings,setMappings]=useState<DingTalkRoleMapping[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const empty:DingTalkRoleMapping={dingtalkRoleId:'',dingtalkRoleName:'',appRole:'technician',shopId:'shop-hq',homeRoute:'workbench',enabled:true};
  const [draft,setDraft]=useState(empty);
  async function load(){try{setMappings((await request<DingTalkMappings>('/api/admin/dingtalk-mappings')).roleMappings);}catch(e){setError(e instanceof Error?e.message:'读取角色映射失败');}}
  useEffect(()=>{void load();},[]);
  async function save(){setBusy(true);setError('');try{await request('/api/admin/dingtalk-role-mappings',{method:'PUT',body:draft});setDraft(empty);await load();}catch(e){setError(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
  const labels:Record<RoleKey,string>={manager:'门店管理员',advisor:'服务顾问',technician:'维修工',inspector:'检验员'};
  return <section className="mapping-intro"><h3>钉钉角色映射</h3><p>填写钉钉角色 ID、名称和所属门店；员工重新登录后生效。多个角色按管理员、服务顾问、检验员、维修工的顺序选择。</p>
    {error?<Alert title={error} type="error"/>:null}
    <Table size="small" rowKey="dingtalkRoleId" dataSource={mappings} pagination={false} scroll={{x:550}} columns={[
      {title:'钉钉角色',dataIndex:'dingtalkRoleName'},{title:'应用角色',dataIndex:'appRole',render:(role:RoleKey)=>labels[role]},
      {title:'门店',dataIndex:'shopId'},{title:'状态',dataIndex:'enabled',render:value=>value?'启用':'停用'},
      {title:'操作',render:(_,row)=><Button onClick={()=>setDraft(row)}>编辑</Button>}
    ]}/>
    <Space wrap>
      <Input aria-label="钉钉角色 ID" placeholder="钉钉角色 ID" value={draft.dingtalkRoleId} onChange={e=>setDraft({...draft,dingtalkRoleId:e.target.value})}/>
      <Input aria-label="钉钉角色名称" placeholder="钉钉角色名称" value={draft.dingtalkRoleName} onChange={e=>setDraft({...draft,dingtalkRoleName:e.target.value})}/>
      <Select aria-label="应用角色" value={draft.appRole} options={Object.entries(labels).map(([value,label])=>({value,label}))} onChange={(appRole:RoleKey)=>setDraft({...draft,appRole,homeRoute:appRole==='advisor'?'order-create':'workbench'})}/>
      <Input aria-label="映射门店 ID" placeholder="门店 ID" value={draft.shopId} onChange={e=>setDraft({...draft,shopId:e.target.value})}/>
      <Switch aria-label="启用角色映射" checked={draft.enabled} onChange={enabled=>setDraft({...draft,enabled})}/>
      <Button type="primary" loading={busy} disabled={!draft.dingtalkRoleId.trim()||!draft.dingtalkRoleName.trim()||!draft.shopId?.trim()} onClick={()=>void save()}>保存角色映射</Button>
    </Space>
  </section>;
}
