import { hasAnyRole } from "../../../shared/roles.mjs";
import {getDingTalkAccessToken} from './accessToken.mjs';
import {listDingTalkRoleMembers} from './inspectorRoster.mjs';
import {getDingTalkUserProfile,resolveDingTalkOrganizationMapping} from './organization.mjs';
import {findUserByDingTalkUserId,upsertUserFromDingTalk,saveDingTalkUserSnapshot} from '../../repositories/userRepository.mjs';
import definitions from '../../../shared/dingtalkRoles.json' with {type:'json'};
export async function syncManagerRoster(shopId,{fetcher=fetch,token=getDingTalkAccessToken,profile=getDingTalkUserProfile,find=findUserByDingTalkUserId,upsert=upsertUserFromDingTalk,snapshot=saveDingTalkUserSnapshot,roleKeys=['manager']}={}) {
  const {ids,accessToken}=await listDingTalkRoleMembers(roleKeys,{fetcher,token,coalesce:true});
  const names=definitions.filter(r=>roleKeys.includes(r.role)).flatMap(r=>r.names);
  const profiles=[];
  for(const userId of ids)profiles.push(await profile({userId,accessToken,coalesce:true}));
  const eligible=[];
  for(const p of profiles) {
    const existing=await find(p.userId),mapping=resolveDingTalkOrganizationMapping(p,{shopId:existing?.shopId||shopId});
    await snapshot(p);const user=await upsert({profile:p,mapping,existingUser:existing});
    if(user?.active&&user.shopId===shopId&&hasAnyRole(user, roleKeys)&&p.roles.some(r=>names.includes(r.name)))eligible.push(user.id);
  }
  return eligible;
}
