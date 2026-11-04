import {isIP} from 'node:net';

// The documented Nginx deployment connects over loopback and appends the
// actual peer to X-Forwarded-For. Direct public callers cannot select this key.
export function localProxyClientAddress(req) {
 const remote=req.socket.remoteAddress||'unknown';
 if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote.toLowerCase()))return remote;
 const header=req.headers['x-forwarded-for'];
 if(typeof header!=='string')return remote;
 const addresses=header.split(',').map(value=>value.trim());
 return addresses.length&&addresses.every(address=>isIP(address))?addresses.at(-1):remote;
}
