// Does not load production configuration, enqueue syncs, or send notifications.
const url=new URL(process.env.DATABASE_URL||'');
if(process.env.APP_ENV!=='development' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.searchParams.has('host')) throw new Error('模拟数据仅允许写入本机开发数据库');
const {pool,transaction}=await import('../server/database/pool.mjs');
const {seedTechnicianMocks}=await import('../server/repositories/dispatchMockRepository.mjs');
try {console.log(JSON.stringify(await transaction(seedTechnicianMocks),null,2));} finally {await pool.end();}
