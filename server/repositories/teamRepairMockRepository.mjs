import { applyDispatchAction } from '../domain/dispatchPolicy.mjs';
import { saveDispatchTask } from './dispatchRepository.mjs';

export async function seedTeamRepairMocks(client) {
  await client.query("select pg_advisory_xact_lock(hashtext('team-repair-demo-v1'))");
  const shopId = 'shop-hq';
  const { rows: people } = await client.query("select id,name,role,shop_id as \"shopId\",active from users where id=any($1)", [['u_dev_technician', 'u_dev_advisor']]);
  const worker = people.find(p => p.id === 'u_dev_technician');
  const advisor = people.find(p => p.id === 'u_dev_advisor');
  if (!worker || !advisor || people.some(p => !p.active || p.shopId !== shopId) || worker.role !== 'technician' || advisor.role !== 'advisor') throw new Error('请先启用本地维修工和服务顾问测试身份');
  const peer = { id: 'u_demo_team_peer', name: '王师傅（多人演示）', role: 'technician', shopId, active: true };
  await client.query('insert into users(id,name,role,shop_id,active) values($1,$2,$3,$4,true) on conflict(id) do nothing', [peer.id, peer.name, peer.role, shopId]);
  const { rows: [savedPeer] } = await client.query('select name,role,shop_id,active from users where id=$1', [peer.id]);
  if (!savedPeer.active || savedPeer.role !== peer.role || savedPeer.shop_id !== shopId) throw new Error('多人演示维修工身份已被调整');
  peer.name = savedPeer.name;
  people.push(peer);
  const scenarios = ['本人已提交，同事维修中', '全员已提交，等待检验'];
  const results = [], now = Date.now(), today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  for (const [index, scenario] of scenarios.entries()) {
    const suffix = String(index + 1).padStart(2, '0'), id = `WT-DEMO-TEAM-${suffix}`, plate = `鲁B演示${suffix}`, dispatchNo = `TEAM${suffix}`;
    if ((await client.query('select 1 from work_orders where id=$1', [id])).rowCount) { results.push({ id, plate, scenario, created: false }); continue; }
    await client.query(`insert into work_orders(id,status,advisor,technician,inspector,shop_id,shop_name,old_parts_handling,vehicle_plate,vehicle_model,vehicle_mileage,customer_name,arrival_date,dispatch_no,fault_description,fee_note)
      values($1,'已委托',$2,'待派工','待检验',$3,'抚顺路店','客户带走',$4,'大众途观','35600','【模拟】多人维修展示',$5,$6,$7,'LOCAL-TEAM-DEMO-V1')`,
      [id, advisor.name, shopId, plate, today, dispatchNo, `【模拟数据】${scenario}`]);
    const items = ['检查空调制冷', '清洁空调滤芯', '检查制动异响', '检查底盘悬挂'].map((name, i) => ({ id: i + 1, name: `【模拟】${name}`, status: '待派工' }));
    for (const item of items) await client.query("insert into repair_items(order_id,client_item_id,item_no,name,status) values($1,$2,$3,$4,'待派工')", [id, item.id, item.id, item.name]);
    let task = { orderId: id, shopId, orderStatus: '已委托', stage: '待派工', version: 0, plate, dispatchNo, items };
    const act = async (actor, action, extra = {}) => {
      const at = new Date(now - 3600000 + task.version * 300000).toISOString();
      const input = { action, expectedVersion: task.version, requestId: `team-demo-${suffix}-${task.version}`, ...extra };
      task = applyDispatchAction(task, input, actor, people, at);
      await saveDispatchTask(client, task);
      await client.query('insert into dispatch_events(order_id,actor_id,actor_name,request_id,request_body,action,detail,at) values($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, actor.id, actor.name, input.requestId, JSON.stringify(input), action, JSON.stringify({ stage: task.stage, items: task.items, note: '仅用于本地多人维修展示' }), at]);
    };
    await act(advisor, 'assign', { technicianIds: [worker.id, peer.id], dueAt: new Date(now + 86400000).toISOString(), note: `【模拟】${scenario}`, itemAssignments: items.map((item, i) => ({ itemId: item.id, technicianId: i < 2 ? worker.id : peer.id })) });
    await act(worker, 'accept', { partsRequirement: { mode: 'none' } });
    await act(peer, 'record-parts', { partsRequirement: { mode: 'none' } });
    await act(worker, 'submit-order', { note: '【模拟】本人负责的两项已完成，提交检验' });
    if (index === 1) await act(peer, 'submit-order', { note: '【模拟】其余两项已完成，提交检验' });
    results.push({ id, plate, dispatchNo, scenario, stage: task.stage, items: task.items.map(item => ({ name: item.name, responsibleName: item.responsibleName, status: item.status })), created: true });
  }
  return results;
}
