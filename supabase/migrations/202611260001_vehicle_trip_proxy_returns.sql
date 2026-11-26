alter table vehicle_trip_requests
  add column proxy_returned_by text references users(id),
  add column proxy_returned_name text,
  add constraint vehicle_trip_proxy_return_valid check (
    (proxy_returned_by is null and proxy_returned_name is null)
    or (proxy_returned_by is not null and proxy_returned_name is not null
      and proxy_returned_by <> applicant_id and status = '已还车'
      and return_at is not null and departure_at is not null)
  );

create index vehicle_trip_proxy_return_month
  on vehicle_trip_requests (shop_id, departure_at desc, id desc)
  where proxy_returned_by is not null;
