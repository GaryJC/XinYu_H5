import test from 'node:test';
import assert from 'node:assert/strict';
import { userRoles, hasRole } from '../shared/roles.mjs';
import { resolveDingTalkOrganizationMapping } from '../server/integrations/dingtalk/organization.mjs';
import { requireAnyRole } from '../server/domain/accessPolicy.mjs';
import { applyDispatchAction, assertDispatchAccess, canInspect } from '../server/domain/dispatchPolicy.mjs';
import { requiresEmployeeBinding } from '../server/domain/employeeBinding.mjs';

const employee = {id:'dual',name:'兼岗员工',role:'advisor',roles:['advisor','inspector'],active:true,shopId:'s'};
const task = () => ({orderId:'order',shopId:'s',stage:'待检验',orderStatus:'维修中',version:0,technicianId:'worker',items:[{id:1,name:'保养',status:'待检验',responsibleId:'worker',startedBy:'worker',finishedBy:'worker'}]});
const action = (task, name, actor) => applyDispatchAction(task,{action:name,expectedVersion:task.version,requestId:'multi-role-request',...(name==='inspect'?{workHours:2}:{})},actor,[actor]);

test('DingTalk retains all recognized memberships, deduplicates aliases and preserves landing priority',()=>{
  const mapping=resolveDingTalkOrganizationMapping({roles:['检验员','维修工','服务顾问','维修技师','普通员工'].map((name,id)=>({name,id:String(id)}))});
  assert.equal(mapping.role,'advisor');
  assert.deepEqual(mapping.roles,['advisor','inspector','technician']);
  assert.equal(mapping.homeRoute,'order-create');
  assert.deepEqual(userRoles({role:'advisor'}),['advisor']);
});

test('advisor and inspector permissions are additive without granting administrator privileges',()=>{
  assert.equal(requireAnyRole(employee,['advisor']),employee);
  assert.equal(requireAnyRole(employee,['inspector']),employee);
  assert.throws(()=>requireAnyRole(employee,['manager']),error=>error.status===403);
  const claimed=action(task(),'claim-inspection',employee);
  assert.equal(claimed.inspectorId,employee.id);
  assert.equal(action(claimed,'inspect',employee).stage,'维修完成');
});

test('multi-role membership never permits self inspection, disabled access or cross-shop access',()=>{
  for(const own of [
    {...task(),technicianId:employee.id},
    {...task(),participantIds:[employee.id]},
    {...task(),items:[{...task().items[0],startedBy:employee.id}]},
    {...task(),items:[{...task().items[0],responsibleId:employee.id}]}
  ]) {
    assert.equal(canInspect(own,employee),false);
    assert.throws(()=>action(own,'claim-inspection',employee),error=>error.status===403);
  }
  for(const actor of [{...employee,active:false},{...employee,shopId:'other'}]) {
    assert.throws(()=>assertDispatchAccess(task(),actor),error=>error.status===403);
  }
});

test('revoked inspection membership removes inspection while keeping advisor access',()=>{
  for(const actor of [{...employee,roles:['advisor']},{...employee,inspectorRoleMember:false}]) {
    assert.equal(hasRole(actor,'advisor'),true);
    assert.equal(canInspect(task(),actor),false);
    assert.throws(()=>action(task(),'claim-inspection',actor),error=>error.status===403);
  }
});

test('warehouse and inspector can inspect, and technician membership requires employee binding',()=>{
  const actor={...employee,role:'inspector',roles:['inspector','warehouse']};
  assert.equal(action(task(),'claim-inspection',actor).inspectorId,actor.id);
  assert.equal(requiresEmployeeBinding({...employee,roles:['advisor','technician']}),true);
});

test('inspector sees the same shop task list as a manager while other roles retain scoped access',async()=>{
  process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
  const {listDispatchTasks}=await import('../server/repositories/dispatchRepository.mjs');
  const actor={...employee,role:'inspector',roles:['inspector','technician']};
  const row=(id,technicianId,stage)=>({order_id:id,shop_id:'s',order_status:'维修中',stage,technician_id:technicianId,repair_items:[],data:{items:[]}});
  const rows=[row('own',actor.id,'维修中'),row('inspection','other','待检验'),row('not-own','other','维修中')];
  assert.deepEqual((await listDispatchTasks(actor,{query:async()=>({rows})})).map(task=>task.orderId),['own','inspection','not-own']);
});

test('inspector roster includes advisors who also have the inspector role',async()=>{
  process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1/unused';
  const {syncInspectorRoster}=await import('../server/integrations/dingtalk/inspectorRoster.mjs');
  const queries=[];
  const ids=await syncInspectorRoster('s',{
    list:async()=>({ids:['dual'],accessToken:''}),
    profile:async()=>({userId:'dual',active:true,roles:[{id:'1',name:'服务顾问'},{id:'2',name:'检验员'}]}),
    find:async()=>employee,snapshot:async()=>{},
    upsert:async({mapping})=>({...employee,...mapping}),
    database:{query:async(...args)=>queries.push(args)}
  });
  assert.deepEqual(ids,['dual']);
  assert.deepEqual(queries[0][1],['s',['dual']]);
});
