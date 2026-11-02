async function listDingTalkRoleMembers(keys) {
  const roster=await import('./inspectorRoster.mjs');
  return roster.listDingTalkRoleMembers(keys);
}
import { userRoles } from '../../../shared/roles.mjs';

// Validate both candidate reads and transactional dispatch checks. Do not cache
// memberships: a removed technician must not remain assignable from an old page.
export async function verifyTechnicianMembership(people, {env=process.env,list=listDingTalkRoleMembers}={}) {
  const localMock=['development','test'].includes(env.APP_ENV)&&env.DISPATCH_NOTIFICATION_MODE==='mock';
  if(localMock)return people;
  if(env.APP_ENV!=='production'&&!env.DINGTALK_APP_KEY)return people;
  if(!people.some(person=>userRoles(person).includes('technician')))return people;
  const {ids}=await list(['technician']);
  const members=new Set(ids);
  return people.map(person=>{
    if(!userRoles(person).includes('technician')||members.has(person.dingtalkUserId))return person;
    const roles=userRoles(person).filter(role=>role!=='technician');
    return {...person,roles:roles.length?roles:['employee'],role:person.role==='technician'?(roles[0]||'employee'):person.role};
  });
}
