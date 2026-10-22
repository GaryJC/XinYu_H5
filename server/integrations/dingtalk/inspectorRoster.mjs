import { hasAnyRole } from "../../../shared/roles.mjs";
import { pool } from '../../database/pool.mjs';
import { getDingTalkAccessToken } from './accessToken.mjs';
import { getDingTalkUserProfile, resolveDingTalkOrganizationMapping } from './organization.mjs';
import definitions from '../../../shared/dingtalkRoles.json' with { type:'json' };
import { findUserByDingTalkUserId, upsertUserFromDingTalk, saveDingTalkUserSnapshot } from '../../repositories/userRepository.mjs';

export async function listDingTalkRoleMembers(roleKeys,{fetcher=fetch,token=getDingTalkAccessToken}={}) {
  const accessToken=await token();
  async function call(path,body) {
    const url=new URL(`https://oapi.dingtalk.com/topapi/role/${path}`);url.searchParams.set('access_token',accessToken);
    const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const data=await response.json();
    if(!response.ok || data.errcode!==0 || !data.result) throw new Error('获取钉钉角色失败，请检查通讯录授权');
    return data.result;
  }
  const names=definitions.filter(r=>roleKeys.includes(r.role)).flatMap(r=>r.names);
  const roles=[];
  for(let offset=0,pages=0;;pages++) {
    if(pages>=1000) throw new Error('钉钉角色分页过多');
    const data=await call('list',{offset,size:200});
    if(!Array.isArray(data.list)) throw new Error('钉钉角色列表格式无效');
    for(const group of data.list) for(const role of group.roles||[]) if(names.includes(role.name?.trim())) roles.push(role.id);
    if(!data.hasMore && !data.has_more) break;
    if(!data.list.length) throw new Error('钉钉角色分页未前进'); offset+=data.list.length;
  }
  const ids=new Set();
  for(const role_id of roles) for(let offset=0,pages=0;;pages++) {
    if(pages>=1000) throw new Error('钉钉成员分页过多');
    const data=await call('simplelist',{role_id,offset,size:200});
    if(!Array.isArray(data.list)) throw new Error('钉钉角色成员列表格式无效');
    data.list.forEach(p=>{if(p.userid) ids.add(String(p.userid));});
    if(!data.hasMore && !data.has_more) break;
    if(!data.list.length) throw new Error('钉钉成员分页未前进'); offset+=data.list.length;
  }
  return {ids:[...ids],accessToken};
}
export const listInspectorRoleMembers=options=>listDingTalkRoleMembers(['inspector','manager'],options);
export async function syncInspectorRoster(shopId,{list=listInspectorRoleMembers,profile=getDingTalkUserProfile,find=findUserByDingTalkUserId,upsert=upsertUserFromDingTalk,snapshot=saveDingTalkUserSnapshot,database=pool}={}) {
  const {ids,accessToken}=await list();
  const eligible=[],inspectorIds=[];
  const inspectionNames=definitions.filter(d=>['inspector','manager'].includes(d.role)).flatMap(d=>d.names);
  const inspectorNames=definitions.find(d=>d.role==='inspector').names;
  // Never use a partially fetched roster as the notification audience.
  const profiles=[];
  for(const userId of ids) profiles.push(await profile({userId,accessToken}));
  for(const p of profiles) {
    const existing=await find(p.userId);
    const mapping=resolveDingTalkOrganizationMapping(p,{shopId:existing?.shopId||shopId});
    await snapshot(p);
    const user=await upsert({profile:p,mapping,existingUser:existing});
    if(user?.active && user.shopId===shopId && hasAnyRole(user, ['inspector','manager']) && p.roles.some(r=>inspectionNames.includes(r.name))) {
      eligible.push(user.id);
      if(p.roles.some(r=>inspectorNames.includes(r.name))) inspectorIds.push(user.id);
    }
  }
  await database.query('update users set inspector_role_member=(id=any($2::text[])) where shop_id=$1 and dingtalk_user_id is not null',[shopId,inspectorIds]);
  return eligible;
}
