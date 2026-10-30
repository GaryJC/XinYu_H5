-- Stable page ordering within a shop; retain earlier migrations unchanged.
create index if not exists work_orders_shop_updated_page on work_orders(shop_id,updated_at desc,id asc);
create index if not exists work_orders_shop_created_page on work_orders(shop_id,created_at desc,id asc);
create index if not exists vehicle_trip_shop_page on vehicle_trip_requests(shop_id,created_at desc,id desc);
create index if not exists procurement_tenders_shop_page on procurement_tenders(shop_id,created_at desc,id desc);
