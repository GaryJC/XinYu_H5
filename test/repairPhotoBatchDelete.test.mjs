import test from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL ||= 'postgresql://test:test@127.0.0.1:5432/test';
const {removeRepairPhotos,removeRepairPhoto}=await import('../server/repositories/repairPhotoRepository.mjs');
const actor={id:'worker',name:'维修工',role:'technician',active:true,shopId:'shop'};
const file=(id,extra={})=>({id,orderId:'o',kind:'repair_progress_photo',repairRound:1,uploadedBy:'worker',...extra});
function database({stage='维修中',round=1,individual=false,submitted=false}={}) {
  let files=[file('a'),file('b'),file('old',{repairRound:0}),file('foreign',{uploadedBy:'other'}),file('parts',{kind:'repair_parts_photo'}),file('wrong-order',{orderId:'elsewhere'})];
  const calls=[];
  return{calls,get files(){return files;},async query(sql,params=[]) {
    calls.push({sql,params});
    if(sql.includes('from work_orders wo left join dispatch_tasks'))return{rows:[{order_id:'o',shop_id:'shop',order_status:'维修中',stage,version:1,technician_id:'worker',data:{repairRound:round,technicianIds:individual?['worker','other']:['worker'],items:[{id:1,status:submitted?'待检验':'维修中',responsibleId:'worker'},{id:2,status:'维修中',responsibleId:individual?'other':'worker'}]},repair_items:[]}]};
    if(sql.includes('select role,active,shop_id'))return{rows:[{role:actor.role,active:true,shop_id:'shop'}]};
    if(sql.includes('select id from files where')||sql.includes('delete from files where')) {
      const [ids,orderId,currentRound,ownerId]=params;
      assert.match(sql,/kind='repair_progress_photo'/);assert.match(sql,/coalesce\(repair_round,0\)=\$3/);
      const chosen=files.filter(f=>ids.includes(f.id)&&f.orderId===orderId&&f.kind==='repair_progress_photo'&&f.repairRound===currentRound&&(!ownerId||f.uploadedBy===ownerId));
      if(sql.startsWith('delete'))files=files.filter(f=>!chosen.includes(f));
      return{rows:chosen.map(f=>({id:f.id}))};
    }
    return{rows:[]};
  }};
}
test('batch delete validates the complete current-round selection then deletes and audits once',async()=>{
  const db=database();
  assert.deepEqual(await removeRepairPhotos(db,actor,'o',['a','b']),{ids:['a','b']});
  assert.ok(!db.files.some(f=>['a','b'].includes(f.id)));
  assert.equal(db.calls.filter(c=>c.sql.startsWith('delete from files')).length,1);
  assert.equal(db.calls.filter(c=>c.sql.startsWith('insert into audit_logs')).length,1);
  assert.ok(db.files.some(f=>f.id==='old'));
});
test('a missing, historic, wrong-kind or other-order photo rejects the whole selection before deleting',async()=>{
  for(const invalid of ['missing','old','parts','wrong-order']) {
    const db=database();
    await assert.rejects(()=>removeRepairPhotos(db,actor,'o',['a',invalid]),error=>error.status===409);
    assert.ok(db.files.some(f=>f.id==='a'));
    assert.ok(!db.calls.some(c=>c.sql.startsWith('delete from files')));
  }
});
test('individual repair only deletes the current worker photos and blocks already-submitted projects',async()=>{
  const db=database({individual:true});
  await assert.rejects(()=>removeRepairPhotos(db,actor,'o',['a','foreign']),error=>error.status===409);
  assert.ok(!db.calls.some(c=>c.sql.startsWith('delete from files')));
  await removeRepairPhotos(db,actor,'o',['a','b']);
  await assert.rejects(()=>removeRepairPhotos(database({individual:true,submitted:true}),actor,'o',['a']),/本人项目已提交/);
});
test('empty, duplicate, malformed and oversized batch selections fail before database queries',async()=>{
  for(const ids of [undefined,[],['a','a'],[''],[23],Array.from({length:101},(_,i)=>`${i}`)]) {
    const db=database();await assert.rejects(()=>removeRepairPhotos(db,actor,'o',ids),error=>error.status===400);
    assert.equal(db.calls.length,0);
  }
});
test('old single-photo entrypoint stays compatible and current stage/role restrictions remain enforced',async()=>{
  assert.deepEqual(await removeRepairPhoto(database(),actor,'o','a'),{id:'a'});
  await assert.rejects(()=>removeRepairPhotos(database({stage:'待检验'}),actor,'o',['a']),error=>error.status===409);
  await assert.rejects(()=>removeRepairPhotos(database(),{...actor,role:'advisor'},'o',['a']),error=>error.status===403);
  await assert.rejects(()=>removeRepairPhotos(database(),{...actor,shopId:'elsewhere'},'o',['a']),error=>error.status===403);
});
