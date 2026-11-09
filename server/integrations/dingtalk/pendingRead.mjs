import {createPendingRead} from '../../domain/pendingRead.mjs';

const readers=new WeakMap();
// Notification discovery may share overlapping network reads, never settled
// results. Login and command authorization leave coalesce=false (the default).
// Fetch implementation and access token isolate credentials and test transports.
export function pendingDingTalkRead({fetcher,accessToken,endpoint,body,coalesce=false},load) {
  if(!coalesce)return load();
  let read=readers.get(fetcher);
  if(!read){read=createPendingRead();readers.set(fetcher,read);}
  return read(JSON.stringify([accessToken,endpoint,body]),load);
}
