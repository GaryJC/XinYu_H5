import { hasAnyRole } from "../../../shared/roles.mjs";
import {getDingTalkAccessToken} from './accessToken.mjs';
import {getDingTalkUserProfile,resolveDingTalkOrganizationMapping} from './organization.mjs';
import {findUserByDingTalkUserId,upsertUserFromDingTalk,saveDingTalkUserSnapshot} from '../../repositories/userRepository.mjs';
import definitions from '../../../shared/dingtalkRoles.json' with {type:'json'};
export async function syncManagerRoster(shopId,{fetcher=fetch,token=getDingTalkAccessToken,profile=getDingTalkUserProfile,find=findUserByDingTalkUserId,upsert=upsertUserFromDingTalk,snapshot=saveDingTalkUserSnapshot,roleKeys=['manager']}={}) {
  const accessToken=await token();
  async function call(method,body) {
    const url=new URL(`https://oapi.dingtalk.com/topapi/role/${method}`);url.searchParams.set('access_token',accessToken);
    const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const payload=await response.json().catch(()=>null);
    if(!response.ok || payload?.errcode!==0 || !Array.isArray(payload.result?.list))throw new Error('读取钉钉门店管理员角色失败，请检查通讯录授权');
    return payload.result;
  }
  const names=definitions.filter(r=>roleKeys.includes(r.role)).flatMap(r=>r.names);
  const roles=new Set(),ids=new Set();
  async function pages(method,body,accept) {
    for(let offset=0,page=0;page<1000;page++) {
      const data=await call(method,{...body,offset,size:200});accept(data.list);
      if(!data.hasMore&&!data.has_more)return;
      if(!data.list.length)throw new Error('钉钉角色分页未前进');offset+=data.list.length;
    }
    throw new Error('钉钉角色分页过多');
  }
  await pages('list',{},groups=>{for(const group of groups)for(const role of group.roles||[])if(names.includes(role.name?.trim()))roles.add(role.id);});
  for(const role_id of roles)await pages('simplelist',{role_id},users=>users.forEach(u=>{if(u.userid)ids.add(String(u.userid));}));
  const profiles=[];
  for(const userId of ids)profiles.push(await profile({userId,accessToken}));
  const eligible=[];
  for(const p of profiles) {
    const existing=await find(p.userId),mapping=resolveDingTalkOrganizationMapping(p,{shopId:existing?.shopId||shopId});
    await snapshot(p);const user=await upsert({profile:p,mapping,existingUser:existing});
    if(user?.active&&user.shopId===shopId&&hasAnyRole(user, roleKeys)&&p.roles.some(r=>names.includes(r.name)))eligible.push(user.id);
  }
  return eligible;
}
