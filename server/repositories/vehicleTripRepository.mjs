import { pagination } from '../domain/pagination.mjs';
import { pool, transaction } from '../database/pool.mjs';
import { hasRole } from '../../shared/roles.mjs';

const iso = value => value ? new Date(value).toISOString() : undefined;
function vehicle(row) {
  return row && { id: row.id, shopId: row.shop_id, plate: row.plate, brand: row.brand, model: row.model, active: row.active };
}
function trip(row) {
  return row && { id: row.id, shopId: row.shop_id, applicantId: row.applicant_id, applicantName: row.applicant_name,
    vehicleId: row.vehicle_id, vehicle: row.vehicle_snapshot, reason: row.reason, note: row.note, status: row.status,
    approvedBy: row.approved_by, approvedName: row.approved_name, approvedAt: iso(row.approved_at),
    departureAt: iso(row.departure_at), returnAt: iso(row.return_at), rejectionReason: row.rejection_reason, createdAt: iso(row.created_at) };
}
export class VehicleTripRepository {
  constructor(database = pool) { this.database = database; }
  transaction(run) { return transaction(client => run(new VehicleTripRepository(client))); }
  async listVehicles(user, all) {
    const { rows } = await this.database.query('select * from company_vehicles where shop_id=$1 and ($2 or active) order by plate', [user.shopId, Boolean(all && hasRole(user, 'manager'))]);
    return rows.map(vehicle);
  }
  async getVehicle(id, lock = false) {
    return vehicle((await this.database.query(`select * from company_vehicles where id=$1${lock ? ' for update' : ''}`, [id])).rows[0]);
  }
  async saveVehicle(id, shopId, input, existing) {
    const values = [id, shopId, input.plate, input.brand, input.model, input.active];
    const sql = existing
      ? 'update company_vehicles set plate=$3,brand=$4,model=$5,active=$6,updated_at=now() where id=$1 and shop_id=$2 returning *'
      : 'insert into company_vehicles(id,shop_id,plate,brand,model,active) values($1,$2,$3,$4,$5,$6) returning *';
    return vehicle((await this.database.query(sql, values)).rows[0]);
  }
  async listTrips(user, query = {}) {
    const params=[user.shopId,hasRole(user,'manager'),user.id];
    let where='where shop_id=$1 and ($2 or applicant_id=$3)';
    if(query.scope==='mine')where+=' and applicant_id=$3';
    if(query.scope==='pending'||query.scope==='using'){params.push(query.scope==='pending'?'待审批':'用车中');where+=' and status=$4';}
    if(query.page===undefined)return (await this.database.query(`select * from vehicle_trip_requests ${where} order by created_at desc,id desc`,params)).rows.map(trip);
    const {page:requested,pageSize}=pagination(query);
    const {rows:[{total}]}=await this.database.query(`select count(*)::integer as total from vehicle_trip_requests ${where}`,params);
    const page=Math.min(requested,Math.max(1,Math.ceil(total/pageSize)));
    const {rows}=await this.database.query(`select * from vehicle_trip_requests ${where} order by created_at desc,id desc limit $${params.length+1} offset $${params.length+2}`,[...params,pageSize,(page-1)*pageSize]);
    return {items:rows.map(trip),total,page,pageSize};
  }
  async getTrip(id, lock = false) {
    return trip((await this.database.query(`select * from vehicle_trip_requests where id=$1${lock ? ' for update' : ''}`, [id])).rows[0]);
  }
  async createTrip(id, user, car, input) {
    await this.database.query(`insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason,note) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, user.shopId, user.id, user.name, car.id, JSON.stringify({ plate: car.plate, brand: car.brand, model: car.model }), input.reason, input.note]);
    return this.getTrip(id);
  }
  async changeTrip(id, action, user, note) {
    const changes = { approve: "status='待出车',approved_by=$2,approved_name=$3,approved_at=now()", reject: "status='已驳回',rejection_reason=$2",
      cancel: "status='已取消'", depart: "status='用车中',departure_at=now()", return: "status='已还车',return_at=now()" };
    const args = action === 'approve' ? [id, user.id, user.name] : action === 'reject' ? [id, note] : [id];
    await this.database.query(`update vehicle_trip_requests set ${changes[action]} where id=$1`, args);
    return this.getTrip(id);
  }
  async lockOperation(actorId, requestId) {
    await this.database.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([actorId, requestId])]);
    return (await this.database.query('select * from vehicle_trip_operations where actor_id=$1 and request_id=$2', [actorId, requestId])).rows[0];
  }
  async recordOperation(user, requestId, fingerprint, tripId, action, result) {
    await this.database.query('insert into vehicle_trip_operations(actor_id,request_id,fingerprint,trip_id,action,actor_name,result) values($1,$2,$3,$4,$5,$6,$7)',
      [user.id, requestId, fingerprint, tripId, action, user.name, JSON.stringify(result)]);
  }
  async addAttachment(tripId, stage, user, file) {
    await this.database.query('insert into vehicle_trip_attachments(file_id,trip_id,stage,uploaded_by) values($1,$2,$3,$4)', [file.id, tripId, stage, user.id]);
  }
  async attachments(tripId, user) {
    const { rows } = await this.database.query(`select a.file_id,a.stage,a.confirmed from vehicle_trip_attachments a
      join vehicle_trip_requests t on t.id=a.trip_id
      where a.trip_id=$1 and (a.confirmed or (a.uploaded_by=$2 and
        ((a.stage='signature' and t.status='待审批') or (a.stage='departure' and t.status='待出车') or (a.stage='return' and t.status='用车中'))))
      order by a.created_at`, [tripId, user.id]);
    return rows.map(r => ({ fileId: r.file_id, stage: r.stage, confirmed: r.confirmed }));
  }
  async confirmAttachments(tripId, stage, userId, ids) {
    const { rows } = await this.database.query(`update vehicle_trip_attachments set confirmed=true where trip_id=$1 and stage=$2 and uploaded_by=$3 and file_id=any($4::text[]) returning file_id`, [tripId, stage, userId, ids]);
    return rows.length;
  }
  async attachmentAccess(fileId) {
    return (await this.database.query('select a.*,t.shop_id,t.applicant_id from vehicle_trip_attachments a join vehicle_trip_requests t on t.id=a.trip_id where file_id=$1', [fileId])).rows[0];
  }
  async history(tripId) {
    const { rows } = await this.database.query("select action,actor_name,created_at from vehicle_trip_operations where trip_id=$1 and action not like 'upload:%' order by created_at", [tripId]);
    return rows.map(r => ({ action: r.action, actorName: r.actor_name, at: iso(r.created_at) }));
  }
}
