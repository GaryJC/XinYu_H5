import { parentPort,workerData } from 'node:worker_threads';
import { readDocuments } from './read.mjs';
import { prepareDocuments,preview } from './prepare.mjs';
import { exportDocuments } from './export.mjs';
try{
 const result=prepareDocuments(readDocuments(workerData.files),workerData.rules,workerData.shopId);
 parentPort.postMessage(workerData.action==='generate'?{base64:Buffer.from(await exportDocuments(result)).toString('base64'),name:'进货单.zip'}:preview(result));
}catch(error){parentPort.postMessage({error:error.message||'文件处理失败'});}
