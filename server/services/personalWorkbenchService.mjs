import {HttpError} from '../http/HttpError.mjs';
import {readInbox,markInboxRead,readPersonalWorkbench} from '../repositories/personalWorkbenchRepository.mjs';
const check=user=>{if(!user?.active||!user.shopId)throw new HttpError(403,'当前账号无法访问工作台');};
const validId=value=>typeof value==='string'&&/^[0-9]{1,18}$/.test(value);
export function personalWorkbench(user,params){check(user);return readPersonalWorkbench(user,undefined,{includeTodos:params?.get('todos')==='true'});}
export function personalInbox(user,params){check(user);const before=params.get('before');if(before&&!validId(before))throw new HttpError(400,'消息游标无效');return readInbox(user,{before,unread:params.get('unread')==='true'});}
export async function readPersonalMessages(user,input){check(user);if(!input||typeof input!=='object'||Array.isArray(input)||!((validId(input.id)&&input.through===undefined)||(validId(input.through)&&input.id===undefined)))throw new HttpError(400,'消息编号无效');await markInboxRead(user,input);return {ok:true};}
