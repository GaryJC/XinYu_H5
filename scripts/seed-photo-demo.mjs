// Local-only visual fixtures. Never enqueue Runfeng syncs or DingTalk messages.
import { readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
const url = new URL(process.env.DATABASE_URL || "");
if (process.env.APP_ENV !== "development" || !["localhost","127.0.0.1","[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error("照片示例仅允许写入本机开发数据库");
const {pool, transaction} = await import("../server/database/pool.mjs");
const root = path.resolve(process.env.LOCAL_UPLOAD_ROOT || "server/data/uploads");
const guides = path.resolve("client/public/photo-guides");
try {
  const {rows:[advisor]} = await pool.query("select id,name,shop_id from users where id='u_dev_advisor' and active=true and role='advisor'");
  if (!advisor) throw new Error("请先启用本地服务顾问测试身份");
  const images = {front45:"front45-illustrated.jpg",rear45:"rear45-illustrated.jpg",mileage:"mileage-illustrated.jpg",license:"front45-illustrated.jpg",extra:"rear45-illustrated.jpg"};
  await mkdir(path.join(root,"photo-demo"),{recursive:true});
  for (const [key,file] of Object.entries(images)) await copyFile(path.join(guides,file),path.join(root,"photo-demo",`${key}.jpg`));
  const result = await transaction(async client => {
    const result=[];
    const scenarios=[{name:"普通车辆照片齐全",military:false,status:"已委托"},{name:"军车免传行驶证",military:true,status:"已委托"},{name:"已完成可补传照片",military:false,status:"完成"}];
    for (const [index,scenario] of scenarios.entries()) {
      const id=`WT-MOCK-PHOTO-${String(index+1).padStart(2,"0")}`;
      const exists=await client.query("select id from work_orders where id=$1",[id]);
      if (exists.rowCount) {result.push({id,...scenario,created:false});continue;}
      const ids=Object.fromEntries(Object.keys(images).map(key=>[key,`${id}-${key}`]));
      const inspection={belongings:scenario.military?["备胎"]:["备胎","行驶证"],fuelLevel:"1/2",exteriorIssues:[],preRepairPhotos:{front45:ids.front45,rear45:ids.rear45,mileage:ids.mileage,extra:[ids.extra]}};
      await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,shop_address,shop_phone,
        vehicle_plate,vehicle_vin,vehicle_mileage,vehicle_model,vehicle_purchase_date,vehicle_is_military,
        customer_name,customer_contact,customer_phone,customer_address,arrival_date,inspection,fault_description,fee_note,old_parts_handling)
        values($1,$2,$3,'待派工','待检验',$4,'本地示例门店','示例路1号','000-00000000',$5,$6,'52380','示例车型','2021-06-18',$7,
        $8,'示例联系人','00000000000','【本地模拟】示例地址',to_char(current_date,'YYYY-MM-DD'),$9::jsonb,$10,'LOCAL-PHOTO-DEMO','环保处理')`,
        [id,scenario.status,advisor.name,advisor.shop_id,scenario.military?'军示例002':`鲁B示例00${index+1}`,`LSVAB1234A123456${index+1}`,scenario.military,`【示例】${scenario.name}`,JSON.stringify(inspection),`【本地模拟】${scenario.name}：用于查看照片和重新上传功能，无真实业务。`]);
      for (const [key,fileId] of Object.entries(ids)) {
        if (key==='license' && scenario.military) continue;
        const target=path.join(root,"photo-demo",`${key}.jpg`);
        const bytes=await readFile(target);
        await client.query(`insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by)
          values($1,$2,$3,'local','local',$4,$5,'image/jpeg',$6,$7)`,
          [fileId,id,key==='license'?'vehicle_license':'repair_order_photo',`photo-demo/${key}.jpg`,key==='license'?'行驶证占位图（非真实证件）.jpg':`示例-${key}.jpg`,bytes.length,advisor.id]);
      }
      await client.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,1,1,'【示例】常规保养','待派工')",[id]);
      await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,'创建本地带照片示例，未推送任何外部系统')",[id,advisor.name]);
      result.push({id,...scenario,created:true});
    }
    return result;
  });
  console.log(JSON.stringify(result,null,2));
} finally {await pool.end();}
