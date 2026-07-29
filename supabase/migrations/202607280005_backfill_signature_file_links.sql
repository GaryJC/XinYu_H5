update signatures signature
set file_id = (
  select file.id
  from files file
  where file.order_id = signature.order_id
    and file.kind = 'signature_image'
  order by file.created_at desc
  limit 1
)
where signature.signer_type = 'customer'
  and signature.file_id is null
  and exists (
    select 1
    from files file
    where file.order_id = signature.order_id
      and file.kind = 'signature_image'
  );
