-- Preserve the meaning of historical mileage evidence; new applications carry a vehicle license.
alter table vehicle_trip_requests add column departure_evidence text not null default 'mileage'
  check (departure_evidence in ('mileage','license'));
-- These records already have submitted return evidence and a server-recorded return time.
-- Retire the mistakenly introduced review step without inventing a human reviewer/time.
update vehicle_trip_requests set status='已还车'
where status='待收车审核' and return_at is not null;
