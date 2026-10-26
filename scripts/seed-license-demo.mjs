// Local-only visual fixtures. Never enqueue Runfeng syncs or DingTalk messages.
import { readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
const url = new URL(process.env.DATABASE_URL || "");
if (process.env.APP_ENV !== "development" || !["localhost","127.0.0.1","[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) throw new Error("照片示例仅允许写入本机开发数据库");
const {pool, transaction} = await import("../server/database/pool.mjs");
const root = path.resolve(process.env.LOCAL_UPLOAD_ROOT || "server/data/uploads");
const guides = path.resolve("client/public/photo-guides");
try {
  const {rows:[advisor]} = await pool.query("select id,name,shop_id from users where id='u_dev_advisor' and active=true and role='advisor'");
  if (!advisor) throw new Error("请先启用本地服务顾问测试身份");
  const images = {front45:"front45-illustrated.jpg",rear45:"rear45-illustrated.jpg",mileage:"mileage-illustrated.jpg",license:"front45-illustrated.jpg",licenseNew:"rear45-illustrated.jpg",extra:"rear45-illustrated.jpg"};
  await mkdir(path.join(root,"license-demo"),{recursive:true});
  for (const [key,file] of Object.entries(images)) await copyFile(path.join(guides,file),path.join(root,"license-demo",`${key}.jpg`));
  const result = await transaction(async client => {
    const result=[];
    const scenarios=[
      {name:"缺少 VIN，验证具体错误",vin:""},
      {name:"无行驶证，验证空理由与正常备案"},
      {name:"已备案，验证后续补传",exception:true},
      {name:"历史行驶证 A，验证旧单不被覆盖",license:true,vin:"LSVAB1234A9900004",plate:"鲁BDM004"},
      {name:"历史行驶证 B，未来优先复用",license:true,vin:"LSVAB1234A9900004",plate:"鲁BDM004",newer:true},
      {name:"同车新单，预览复用或重新上传",vin:"LSVAB1234A9900004",plate:"鲁BDM004"},
      {name:"正式委托无照片，详情补传",status:"已委托"},
      {name:"正式委托有照片，详情替换",status:"已委托",license:true},
      {name:"军车免上传",military:true},
      {name:"同牌不同 VIN 甲，需核对 VIN",license:true,plate:"鲁BDM010"},
      {name:"同牌不同 VIN 乙，需核对 VIN",license:true,plate:"鲁BDM010"}
    ];
    for (const [index,scenario] of scenarios.entries()) {
      const id=`WT-MOCK-LICENSE-${String(index+1).padStart(2,"0")}`;
      const plate=scenario.plate||`鲁BDM${String(index+1).padStart(3,'0')}`;
      const vin=scenario.vin??`LSVAB1234A99000${String(index+1).padStart(2,'0')}`;
      const exists=await client.query("select id from work_orders where id=$1",[id]);
      if (exists.rowCount) {result.push({id,...scenario,created:false});continue;}
      const ids=Object.fromEntries(Object.keys(images).map(key=>[key,`${id}-${key}`]));
      const inspection={...(scenario.license?{vehicleLicenseFileId:ids.license}:{}),belongings:scenario.military?["备胎"]:["备胎","行驶证"],fuelLevel:"1/2",exteriorIssues:[],preRepairPhotos:{front45:ids.front45,rear45:ids.rear45,mileage:ids.mileage,extra:[ids.extra]}};
      await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,shop_address,shop_phone,
        vehicle_plate,vehicle_vin,vehicle_mileage,vehicle_model,vehicle_purchase_date,vehicle_is_military,
        customer_name,customer_contact,customer_phone,customer_address,arrival_date,inspection,fault_description,fee_note,old_parts_handling)
        values($1,$2,$3,'待派工','待检验',$4,'本地示例门店','示例路1号','000-00000000',$5,$6,'52380','示例车型','2021-06-18',$7,
        $8,'示例联系人','00000000000','【本地模拟】示例地址',to_char(current_date,'YYYY-MM-DD'),$9::jsonb,$10,'LOCAL-PHOTO-DEMO','环保处理')`,
        [id,scenario.status||"草稿",advisor.name,advisor.shop_id,plate,vin,Boolean(scenario.military),`【示例】${scenario.name}`,JSON.stringify(inspection),`【本地模拟】${scenario.name}：用于查看照片和重新上传功能，无真实业务。`]);
      for (const [key,fileId] of Object.entries(ids)) {
        if(key==='licenseNew')continue;
        if (key==='license' && !scenario.license) continue;
        const imageKey=key==='license'&&scenario.newer?'licenseNew':key;
        const target=path.join(root,"license-demo",`${imageKey}.jpg`);
        const bytes=await readFile(target);
        await client.query(`insert into files(id,order_id,kind,storage_provider,bucket,object_key,original_name,mime_type,size_bytes,uploaded_by)
          values($1,$2,$3,'local','local',$4,$5,'image/jpeg',$6,$7)`,
          [fileId,id,key==='license'?'vehicle_license':'repair_order_photo',`license-demo/${imageKey}.jpg`,key==='license'?`行驶证占位图${scenario.newer?'B':'A'}（非真实证件）.jpg`:`示例-${key}.jpg`,bytes.length,advisor.id]);
      }
      if(scenario.license)await client.query("update files set license_vehicle_vin=$2,license_selected_at=now()-($3::int * interval '1 day') where id=$1",[ids.license,vin,scenario.newer?1:2]);
      if(scenario.exception)await client.query(`insert into vehicle_license_exceptions(id,order_id,request_id,vehicle_plate,vehicle_vin,reason,reported_by,reported_name,payload,status,next_attempt_at) values($1,$2,'local-fixture',$3,$4,'【本地测试】客户未携带行驶证，后续补传',$5,$6,'{}','queued',null)`,[randomUUID(),id,plate,vin,advisor.id,advisor.name]);
      await client.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,1,1,'【示例】常规保养','待派工')",[id]);
      await client.query("insert into audit_logs(order_id,actor,action) values($1,$2,'创建本地带照片示例，未推送任何外部系统')",[id,advisor.name]);
      result.push({id,plate,vin,...scenario,created:true});
    }
    return result;
  });
  console.log(JSON.stringify(result,null,2));
} finally {await pool.end();}
