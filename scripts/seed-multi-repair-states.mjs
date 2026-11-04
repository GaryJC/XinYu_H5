// Local fixtures only. Never queue notifications or Runfeng synchronization.
import {mkdir,writeFile,stat} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const database=new URL(process.env.DATABASE_URL||'');
if(process.env.APP_ENV!=='development'||process.env.NODE_ENV==='production'||!['localhost','127.0.0.1','[::1]'].includes(database.hostname)||database.searchParams.has('host'))throw new Error('测试单仅允许写入本机开发数据库');
if(process.env.RUNFENG_REPAIR_WRITEBACK_ENABLED==='true'||!['disabled','mock'].includes(process.env.DISPATCH_NOTIFICATION_MODE||'disabled'))throw new Error('请先关闭真实润丰写回和钉钉通知，再创建可操作的测试单');
const root=path.resolve(process.env.LOCAL_UPLOAD_ROOT||'server/data/uploads');
const folder='multi-repair-states-20261104';
await mkdir(path.join(root,folder),{recursive:true});
const photos=[];
for(const [key,label] of [['nameplate','Vehicle nameplate placeholder'],['a','Technician A repair evidence'],['b','Technician B repair evidence']]) {
  const objectKey=`${folder}/${key}.jpg`,target=path.join(root,objectKey);
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="#edf3fb"/><rect x="40" y="40" width="880" height="560" rx="24" fill="white" stroke="#c7d6ea"/><text x="80" y="160" font-family="sans-serif" font-size="44" fill="#d44832">LOCAL TEST ONLY</text><text x="80" y="270" font-family="sans-serif" font-size="32" fill="#243b59">${label}</text><text x="80" y="350" font-family="sans-serif" font-size="26" fill="#536781">Dummy multi-technician repair data</text><text x="80" y="490" font-family="sans-serif" font-size="22" fill="#536781">Not a real vehicle document or repair photo</text></svg>`;
  try {await writeFile(target,await sharp(Buffer.from(svg)).jpeg({quality:85}).toBuffer(),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  photos.push({key,objectKey,sizeBytes:(await stat(target)).size});
}
const {pool,transaction}=await import('../server/database/pool.mjs');
const {seedMultiRepairStates}=await import('../server/repositories/multiRepairStatesMockRepository.mjs');
try {console.log(JSON.stringify(await transaction(client=>seedMultiRepairStates(client,photos)),null,2));}finally{await pool.end();}
