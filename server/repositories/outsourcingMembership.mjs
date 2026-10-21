export const outsourcingMembership = `(
  role='outsourcing' or exists (
    select 1 from dingtalk_user_snapshots s, jsonb_array_elements(s.role_list) r
    where s.dingtalk_user_id=users.dingtalk_user_id and trim(r->>'name')='外包'
  )
) as outsourcing_role_member`;
