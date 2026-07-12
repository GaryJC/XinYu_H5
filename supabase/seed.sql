insert into users (id, name, role, dingtalk_user_id) values
  ('u_advisor_linjia', '林佳', 'advisor', null),
  ('u_dispatcher_wangtao', '王涛', 'dispatcher', null),
  ('u_technician_chenli', '陈立', 'technician', null),
  ('u_technician_liufeng', '刘峰', 'technician', null),
  ('u_technician_zhangming', '张明', 'technician', null),
  ('u_inspector_huang', '黄检', 'inspector', null),
  ('u_inspector_wang', '王检', 'inspector', null),
  ('u_manager_admin', '管理员', 'manager', null)
on conflict (id) do update set
  name = excluded.name,
  role = excluded.role,
  dingtalk_user_id = excluded.dingtalk_user_id;

insert into work_orders (
  id, status, advisor, technician, inspector,
  vehicle_plate, vehicle_vin, vehicle_mileage, vehicle_model, vehicle_purchase_date,
  customer_name, customer_phone, customer_contact, customer_address,
  inspection, fault_description, estimated_fee, old_parts_handling,
  estimated_delivery_at, settlement_amount, fee_note, platform_order_no,
  created_at, updated_at
) values
  (
    'WT-20260626-018', '维修中', '林佳', '陈立', '待检验',
    '沪A·7K92D', 'LSGPC52U9MF018736', '68240', '别克 GL8', '2021-08-16',
    '周先生', '138****2641', '周先生', '上海市闵行区',
    '{"belongings": ["行驶证", "备胎", "千斤顶"], "fuelLevel": "1/2", "exteriorIssues": ["划伤"]}'::jsonb,
    '刹车异响，发动机舱低速异响。', 880, '环保处理', '2026-06-27 18:00', 0, '', null,
    '2026-06-26T09:00:00+08:00', '2026-06-26T10:00:00+08:00'
  ),
  (
    'WT-20260626-017', '待派工', '林佳', '待派工', '待检验',
    '沪C·N581Q', 'LGBH52E04NY218456', '45210', '本田 雅阁', '2020-03-12',
    '沈女士', '139****8812', '沈女士', '上海市长宁区',
    '{"belongings": ["行驶证"], "fuelLevel": "1/2", "exteriorIssues": []}'::jsonb,
    '空调制冷效果差。', 520, '环保处理', '', 0, '', null,
    '2026-06-26T09:30:00+08:00', '2026-06-26T10:10:00+08:00'
  ),
  (
    'WT-20260626-016', '待结算', '林佳', '刘峰', '黄检',
    '苏E·45M8A', 'LSVNV2189P2184501', '81200', '大众 途腾', '2019-11-03',
    '许先生', '136****6032', '许先生', '苏州市工业园区',
    '{"belongings": ["行驶证"], "fuelLevel": "1/2", "exteriorIssues": []}'::jsonb,
    '保养并更换机油滤芯。', 980, '环保处理', '', 980, '', null,
    '2026-06-26T08:30:00+08:00', '2026-06-26T10:20:00+08:00'
  )
on conflict (id) do update set
  status = excluded.status,
  advisor = excluded.advisor,
  technician = excluded.technician,
  inspector = excluded.inspector,
  vehicle_plate = excluded.vehicle_plate,
  vehicle_vin = excluded.vehicle_vin,
  vehicle_mileage = excluded.vehicle_mileage,
  vehicle_model = excluded.vehicle_model,
  vehicle_purchase_date = excluded.vehicle_purchase_date,
  customer_name = excluded.customer_name,
  customer_phone = excluded.customer_phone,
  customer_contact = excluded.customer_contact,
  customer_address = excluded.customer_address,
  inspection = excluded.inspection,
  fault_description = excluded.fault_description,
  estimated_fee = excluded.estimated_fee,
  old_parts_handling = excluded.old_parts_handling,
  estimated_delivery_at = excluded.estimated_delivery_at,
  settlement_amount = excluded.settlement_amount,
  fee_note = excluded.fee_note,
  platform_order_no = excluded.platform_order_no,
  updated_at = excluded.updated_at;

delete from repair_items where order_id in ('WT-20260626-018', 'WT-20260626-017', 'WT-20260626-016');
insert into repair_items (order_id, client_item_id, item_no, name, labor_fee, owner) values
  ('WT-20260626-018', 1, 1, '更换前刹车片', 260, '陈立'),
  ('WT-20260626-018', 2, 2, '发动机舱异响检查', 180, '陈立'),
  ('WT-20260626-017', 1, 1, '空调系统检测', 220, '待派工'),
  ('WT-20260626-016', 1, 1, '小保养', 180, '刘峰'),
  ('WT-20260626-016', 2, 2, '底盘检查', 120, '刘峰');

delete from signatures where order_id in ('WT-20260626-018', 'WT-20260626-017', 'WT-20260626-016');
insert into signatures (order_id, signer_type, signer_name, signed_at) values
  ('WT-20260626-018', 'customer', '周先生', '2026-06-26T09:50:00+08:00'),
  ('WT-20260626-018', 'advisor', '林佳', '2026-06-26T09:00:00+08:00'),
  ('WT-20260626-017', 'customer', '沈女士', '2026-06-26T10:00:00+08:00'),
  ('WT-20260626-017', 'advisor', '林佳', '2026-06-26T09:30:00+08:00'),
  ('WT-20260626-016', 'customer', '许先生', '2026-06-26T09:10:00+08:00'),
  ('WT-20260626-016', 'advisor', '王涛', '2026-06-26T08:30:00+08:00'),
  ('WT-20260626-016', 'inspector', '黄检', '2026-06-26T10:20:00+08:00');

delete from audit_logs where order_id in ('WT-20260626-018', 'WT-20260626-017', 'WT-20260626-016');
insert into audit_logs (order_id, at, actor, action) values
  ('WT-20260626-018', '2026-06-26T09:50:00+08:00', '林佳', '客户已签字'),
  ('WT-20260626-018', '2026-06-26T10:00:00+08:00', '王涛', '已派工给陈立'),
  ('WT-20260626-017', '2026-06-26T10:00:00+08:00', '沈女士', '客户已签字'),
  ('WT-20260626-017', '2026-06-26T10:10:00+08:00', '林佳', '提交派工池'),
  ('WT-20260626-016', '2026-06-26T10:10:00+08:00', '刘峰', '维修完成提报'),
  ('WT-20260626-016', '2026-06-26T10:20:00+08:00', '黄检', '检验通过');

update work_orders set
  dispatch_no = replace(id, 'WT-', 'PG-'),
  arrival_date = to_char(created_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD'),
  shop_id = 'shop-hq',
  shop_name = '上海虹桥店',
  shop_address = '抚顺路店',
  shop_phone = '021-6000-8618';

update repair_items set status = '维修中', start_at = '2026-06-26 10:30', inspector = '黄检'
where order_id = 'WT-20260626-018';
update repair_items set status = '已完工', start_at = '2026-06-26 09:10', finish_at = '2026-06-26 10:05', inspector = '黄检'
where order_id = 'WT-20260626-016';

delete from platform_sync_records where order_id in ('WT-20260626-018', 'WT-20260626-016');
insert into platform_sync_records (id, order_id, platform_order_no, status, message, synced_at) values
  ('sync_seed_018', 'WT-20260626-018', 'PLAT-20260626-018', '已同步', '已生成维修业务平台工单和模拟出库单', '2026-06-26T10:05:00+08:00'),
  ('sync_seed_016', 'WT-20260626-016', 'PLAT-20260626-016', '已同步', '已同步结算来源数据', '2026-06-26T10:15:00+08:00');

update work_orders set platform_order_no = 'PLAT-20260626-018' where id = 'WT-20260626-018';
update work_orders set platform_order_no = 'PLAT-20260626-016' where id = 'WT-20260626-016';

delete from outbound_orders where order_id in ('WT-20260626-018');
insert into outbound_orders (id, order_id, dispatch_no, platform_order_no, technician, status, created_at)
values ('out_seed_018', 'WT-20260626-018', 'PG-20260626-018', 'PLAT-20260626-018', '陈立', '已领料', '2026-06-26T10:10:00+08:00');
delete from outbound_order_items where outbound_order_id = 'out_seed_018';
insert into outbound_order_items (id, outbound_order_id, repair_item_id, name, quantity, picked) values
  ('outi_seed_018_1', 'out_seed_018', 1, '更换前刹车片', 1, true),
  ('outi_seed_018_2', 'out_seed_018', 2, '发动机舱异响检查', 1, true);

delete from settlement_statements where order_id in ('WT-20260626-016');
insert into settlement_statements (id, order_id, dispatch_no, plate, technician, amount, source, match_status, synced_at)
values ('settle_seed_016', 'WT-20260626-016', 'PG-20260626-016', '苏E·45M8A', '刘峰', 980, '维修业务平台', '已匹配', '2026-06-26T10:25:00+08:00');
