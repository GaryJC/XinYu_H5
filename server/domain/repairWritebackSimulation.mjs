// Simulation never changes real writeback receipts or calls SQL Server.
export function repairWritebackSimulationEnabled(env=process.env) {
 if(env.RUNFENG_REPAIR_WRITEBACK_MODE!=='mock')return false;
 let local=false;
 try {local=['localhost','127.0.0.1','[::1]'].includes(new URL(env.DATABASE_URL).hostname);} catch {}
 if(!['development','test'].includes(env.APP_ENV)||env.NODE_ENV==='production'||!local||env.RUNFENG_REPAIR_WRITEBACK_ENABLED==='true') {
  throw new Error('润丰模拟写回仅限本地开发/测试数据库，且必须关闭真实写回');
 }
 if(!['success','failure'].includes(env.RUNFENG_REPAIR_WRITEBACK_MOCK_RESULT||'success'))throw new Error('模拟写回结果须为 success 或 failure');
 return true;
}
