import { pool } from '../database/pool.mjs';
import { hasSqlServerConfig } from '../config/sqlServerConfig.mjs';
import { HttpError } from '../http/HttpError.mjs';
import { getDispatchTask } from '../repositories/dispatchRepository.mjs';
import { findRunfengParts,listRunfengWarehouses } from '../repositories/runfengStockRepository.mjs';

export function parseStockSearch(input={}) {
  if(typeof input.query!=='string'||!input.query.trim()||input.query.trim().length>80)throw new HttpError(400,'请输入 1 至 80 字的配件名称、货号或规格');
  const query=input.query.trim(),tokens=query.split(/\s+/);
  if(tokens.length>6)throw new HttpError(400,'最多使用 6 个检索词，可用空格分隔');
  let warehouseId;
  if(input.warehouseId!==undefined && input.warehouseId!=='') {
    if(!/^\d{1,10}$/.test(String(input.warehouseId))||!Number.isSafeInteger(Number(input.warehouseId))||Number(input.warehouseId)<1||Number(input.warehouseId)>2147483647)throw new HttpError(400,'请选择有效仓库');
    warehouseId=Number(input.warehouseId);
  }
  if(input.inStockOnly!==undefined&&!['true','false'].includes(input.inStockOnly))throw new HttpError(400,'库存筛选参数无效');
  return {query,tokens,warehouseId,inStockOnly:input.inStockOnly!=='false'};
}
async function authorize(actor,orderId,{getTask=getDispatchTask,database=pool,configured=hasSqlServerConfig}={}) {
  if(!actor?.active||!['warehouse','manager'].includes(actor.role))throw new HttpError(403,'仅仓管或管理员可检索润丰仓库');
  const task=await getTask(database,orderId,actor);
  if(['草稿','待客户签字'].includes(task.orderStatus)||(!task.partsRequirement&&!task.hasPartsHistory))throw new HttpError(409,'登记配件需求后可检索润丰仓库');
  if(!configured())throw new HttpError(503,'润丰仓库检索尚未配置，请联系管理员');
}
export async function warehouseStockOptions(actor,orderId,deps={}) {
  await authorize(actor,orderId,deps);
  try{return {warehouses:await (deps.listWarehouses||listRunfengWarehouses)()};}
  catch{throw new HttpError(502,'润丰仓库连接失败，请稍后重试');}
}
export async function searchWarehouseStock(actor,orderId,input,deps={}) {
  const filters=parseStockSearch(input);
  await authorize(actor,orderId,deps);
  try {
    const result=await (deps.findParts||findRunfengParts)(filters);
    return {...result,query:filters.query,warehouseId:filters.warehouseId,inStockOnly:filters.inStockOnly,source:'润丰',queriedAt:new Date().toISOString()};
  }catch{throw new HttpError(502,'润丰配件检索失败，请稍后重试');}
}
