// Stop all producers synchronously before waiting for any consumer to drain.
export async function drainServer(server, stops, closePools) {
 const workers=stops.map(stop=>stop());
 const requests=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 server.closeIdleConnections();
 await Promise.all([...workers,requests]);
 await Promise.all(closePools.map(close=>close()));
}
