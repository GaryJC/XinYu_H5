create index vehicle_trip_usage_month
  on vehicle_trip_requests (shop_id, departure_at desc, id desc)
  where departure_at is not null;
