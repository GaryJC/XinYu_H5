select setval(
  pg_get_serial_sequence('repair_items', 'id'),
  coalesce((select max(id) + 1 from repair_items), 1),
  false
);

select setval(
  pg_get_serial_sequence('signatures', 'id'),
  coalesce((select max(id) + 1 from signatures), 1),
  false
);

select setval(
  pg_get_serial_sequence('audit_logs', 'id'),
  coalesce((select max(id) + 1 from audit_logs), 1),
  false
);
