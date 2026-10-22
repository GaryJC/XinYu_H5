import { hasAnyRole } from "../../../shared/roles.mjs";
import { listDingTalkRoleMembers } from './inspectorRoster.mjs';
import { getDingTalkUserProfile,resolveDingTalkOrganizationMapping } from './organization.mjs';
import { findUserByDingTalkUserId,upsertUserFromDingTalk,saveDingTalkUserSnapshot } from '../../repositories/userRepository.mjs';
import definitions from '../../../shared/dingtalkRoles.json' with {type:'json'};
export async function syncSchedulerRoster(shopId,{list=()=>listDingTalkRoleMembers(['advisor','manager']),profile=getDingTalkUserProfile,find=findUserByDingTalkUserId,upsert=upsertUserFromDingTalk,snapshot=saveDingTalkUserSnapshot}={}) {
  const {ids,accessToken}=await list();
  const profiles=[];
  for(const userId of ids) profiles.push(await profile({userId,accessToken}));
  const names=definitions.filter(r=>['advisor','manager'].includes(r.role)).flatMap(r=>r.names);
  const eligible=[];
  for(const p of profiles) {
    const existing=await find(p.userId);
    const mapping=resolveDingTalkOrganizationMapping(p,{shopId:existing?.shopId||shopId});
    await snapshot(p);
    const user=await upsert({profile:p,mapping,existingUser:existing});
    if(user?.active && user.shopId===shopId && hasAnyRole(user, ['advisor','manager']) && p.roles.some(r=>names.includes(r.name))) eligible.push(user.id);
  }
  return [...new Set(eligible)];
}
