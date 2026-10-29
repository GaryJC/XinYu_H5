import { userRoles, hasRole } from "../../../../shared/roles.mjs";
import { useState } from 'react';
import { Alert,Button,Card,Collapse,Descriptions,Drawer,Empty,Form,Grid,Input,Select,Space,Table,Tabs,Tag } from 'antd';
import type { UserProfile,RoleKey } from '../../../../shared/types';
import { roleDefinitions,roleLabels,roleOptions,roleDescriptions,roleLandingPage,displayLogin } from './accessConfig';
import { useAccessSettings } from './useAccessSettings';
import './access.css';
export function AccessSettingsPage({users}:{users:UserProfile[]}){
  const c=useAccessSettings(users),mobile=!Grid.useBreakpoint().md;
  const [search,setSearch]=useState(''),[role,setRole]=useState<RoleKey>(),[status,setStatus]=useState<string>(),[selected,setSelected]=useState<string>();
  const filtered=c.users.filter(user=>(!search.trim()||[user.name,user.id].some(value=>value.toLowerCase().includes(search.trim().toLowerCase())))&&(!role||hasRole(user, role))&&(!status||user.active===(status==='active')));
  const employee=c.users.find(user=>user.id===selected);
  const statusTag=(user:UserProfile)=><Tag color={user.active?'success':'default'}>{user.active?'启用':'停用'}</Tag>;
  const rolesPanel=<div className="access-role-grid">{roleOptions.map(({value,label})=>{const info=roleDescriptions[value as RoleKey];const definition=roleDefinitions.find(item=>item.role===value)!;return <Card key={value} size="small" title={label}><dl><dt>钉钉角色名称（任选其一）</dt><dd><Space wrap>{(definition?.names || ["无需配置岗位角色，在职员工自动开放出车申请"]).map(name=><Tag key={name} color="blue">{name}</Tag>)}</Space></dd><dt>进入页面</dt><dd>{roleLandingPage(value as RoleKey)}</dd><dt>数据范围</dt><dd>{info.scope}</dd><dt>允许操作</dt><dd>{info.abilities}</dd><dt>操作限制</dt><dd>{info.limits}</dd></dl></Card>;})}</div>;
  const employeePanel=<div className="access-section">
    <div className="access-section-heading"><div><h3>本店员工 <span className="access-count">{c.users.length}</span></h3><p>这里仅展示系统识别结果，不在此给员工分配角色。管理员在钉钉调整角色后，员工重新进入应用时自动同步。</p></div></div>
    <Form layout="vertical" className="access-filter-bar">
      <Form.Item label="搜索员工"><Input aria-label="搜索员工" placeholder="姓名 / 员工编号" allowClear value={search} onChange={e=>setSearch(e.target.value)}/></Form.Item>
      <Form.Item label="应用角色"><Select aria-label="筛选员工角色" allowClear placeholder="全部角色" value={role} options={roleOptions} onChange={setRole}/></Form.Item>
      <Form.Item label="账号状态"><Select aria-label="筛选员工状态" allowClear placeholder="全部状态" value={status} options={[{value:'active',label:'启用'},{value:'inactive',label:'停用'}]} onChange={setStatus}/></Form.Item>
      <Button type="text" onClick={()=>{setSearch('');setRole(undefined);setStatus(undefined);}}>重置筛选</Button>
    </Form>
    <p className="access-caption">找到 {filtered.length} 位员工 · 查看详情了解当前权限及进入记录</p>
    {mobile?<div className="access-employee-cards">{filtered.length?filtered.map(user=><Card size="small" key={user.id} title={user.name} extra={<Button type="link" onClick={()=>setSelected(user.id)}>查看权限</Button>}><Space size={[8,8]} wrap>{userRoles(user).map(role=><Tag key={role} color="blue">{roleLabels[role]}</Tag>)}{statusTag(user)}</Space><p className="access-caption">门店：{user.shopId||'未分配'}</p><p className="access-caption">最近进入：{displayLogin(user.lastLoginAt)}</p></Card>):<Empty description="没有符合条件的员工"/>}</div>:<Table rowKey="id" size="middle" loading={c.loading} dataSource={filtered} pagination={{pageSize:10,showSizeChanger:false,hideOnSinglePage:true}} scroll={{x:760}} locale={{emptyText:<Empty description="没有符合条件的员工"/>}} columns={[
      {title:'员工',dataIndex:'name',render:(name:string,user:UserProfile)=><div><strong>{name}</strong><div className="access-caption">{user.id}</div></div>},
      {title:'应用角色',dataIndex:'role',render:(_:RoleKey,user:UserProfile)=><Space wrap>{userRoles(user).map(role=><Tag key={role} color="blue">{roleLabels[role]}</Tag>)}</Space>},
      {title:'状态',key:'status',render:(_,user)=>statusTag(user)},
      {title:'所属门店',dataIndex:'shopId',render:value=>value||'未分配'},
      {title:'最近进入',dataIndex:'lastLoginAt',render:displayLogin},
      {title:'操作',key:'action',render:(_,user)=><Button type="link" onClick={()=>setSelected(user.id)}>查看权限</Button>}
    ]}/>}
  </div>;
  return <section className="access-page" aria-label="权限设置">
    <div className="access-heading"><div><h2>页面与权限</h2><p>部门和角色在钉钉分配；员工打开应用后自动识别身份，无需手动登录。</p></div><Button loading={c.loading} onClick={()=>void c.refresh()}>刷新识别结果</Button></div>
    {c.error?<Alert type="error" showIcon title="权限数据读取失败" description={c.error} action={<Button disabled={c.loading} onClick={()=>void c.refresh()}>重试</Button>}/>:null}
    <Card className="access-main-card"><Tabs items={[
      {key:'employees',label:'员工识别结果',children:employeePanel},
      {key:'roles',label:'页面与权限',children:<div className="access-section"><div className="access-section-heading"><div><h3>应用角色</h3><p>请在钉钉中按下方准确名称创建并分配角色，任选一个对应名称即可。无需填写角色 ID，部门在钉钉管理。员工打开应用即可免登录进入对应页面。</p></div></div>{rolesPanel}<Alert type="info" showIcon title="多角色权限同时生效" description="可在钉钉为同一员工分配多个角色，例如服务顾问＋检验员。重新进入应用后同时拥有对应入口和操作权限；默认首页仍按角色优先级确定，门店范围和禁止自检限制继续生效。"/></div>}
    ]}/></Card>
    <Drawer open={Boolean(employee)} onClose={()=>setSelected(undefined)} title={employee?`${employee.name} · 当前权限`:'员工权限'} size={mobile?'100%':480}>
      {employee?<div className="access-section"><Space wrap>{userRoles(employee).map(role=><Tag key={role} color="blue">{roleLabels[role]}</Tag>)}{statusTag(employee)}</Space>
        {!employee.active?<Alert type="warning" title="该员工当前为停用状态" description="角色说明不代表停用账号仍可执行操作。"/>:null}
        <Descriptions column={1} items={[{key:'id',label:'员工编号',children:employee.id},{key:'shop',label:'门店 ID',children:employee.shopId||'未分配'},{key:'login',label:'最近进入',children:displayLogin(employee.lastLoginAt)},{key:'source',label:'钉钉关联',children:employee.dingtalkUserId?'已关联':'未关联（本地或测试账号）'}]}/>
        {userRoles(employee).map(role=><Card key={role} size="small" title={roleLabels[role]+"可做什么"}><dl><dt>数据范围</dt><dd>{roleDescriptions[role].scope}</dd><dt>允许操作</dt><dd>{roleDescriptions[role].abilities}</dd><dt>操作限制</dt><dd>{roleDescriptions[role].limits}</dd></dl></Card>)}
        <Collapse items={[{key:'change',label:'如何调整员工权限？',children:<ol className="access-steps"><li>在钉钉中调整员工所属角色。</li><li>角色名称须与“页面与权限”列出的名称一致。</li><li>员工重新进入钉钉应用后自动更新，再刷新本页核对。</li></ol>}]}/>
      </div>:null}
    </Drawer>
  </section>;
}
