import { pagination } from '../domain/pagination.mjs';
import { pool, transaction } from '../database/pool.mjs';
import { hasRole } from '../../shared/roles.mjs';

const iso = value => value ? new Date(value).toISOString() : undefined;
function vehicle(row) {
  return row && { id: row.id, shopId: row.shop_id, plate: row.plate, brand: row.brand, model: row.model, active: row.active, insuranceStart: row.insurance_start ? String(row.insurance_start).slice(0,10) : undefined, insuranceEnd: row.insurance_end ? String(row.insurance_end).slice(0,10) : undefined, insuranceDetails: row.insurance_details || {} };
}
function trip(row) {
  return row && { id: row.id, shopId: row.shop_id, applicantId: row.applicant_id, applicantName: row.applicant_name,
    vehicleId: row.vehicle_id, vehicle: row.vehicle_snapshot, reason: row.reason, note: row.note, status: row.status,
    approvedBy: row.approved_by, approvedName: row.approved_name, approvedAt: iso(row.approved_at),
    departureAt: iso(row.departure_at), returnAt: iso(row.return_at), rejectionReason: row.rejection_reason, createdAt: iso(row.created_at),
    departureEvidence: row.departure_evidence, returnRound: row.return_round, returnReviewedBy: row.return_reviewed_by, returnReviewedName: row.return_reviewed_name,
    returnReviewedAt: iso(row.return_reviewed_at), returnRejectionReason: row.return_rejection_reason };
}
export class VehicleTripRepository {
  constructor(database = pool) { this.database = database; }
  transaction(run) { return transaction(client => run(new VehicleTripRepository(client))); }
  async listVehicles(user, all) {
    const { rows } = await this.database.query('select *,insurance_start::text,insurance_end::text from company_vehicles where shop_id=$1 and ($2 or active) order by plate', [user.shopId, Boolean(all && hasRole(user, 'manager'))]);
    return rows.map(vehicle);
  }
  async getVehicle(id, lock = false) {
    return vehicle((await this.database.query(`select *,insurance_start::text,insurance_end::text from company_vehicles where id=$1${lock ? ' for update' : ''}`, [id])).rows[0]);
  }
  async isVehicleInUse(vehicleId, exceptTripId) {
    const {rows}=await this.database.query("select 1 from vehicle_trip_requests where vehicle_id=$1 and status in ('用车中','待收车审核') and ($2::text is null or id<>$2) limit 1",[vehicleId,exceptTripId]);
    return rows.length>0;
  }
  async saveVehicle(id, shopId, input, existing) {
    const values = [id, shopId, input.plate, input.brand, input.model, input.active, input.insuranceStart, input.insuranceEnd, JSON.stringify(input.insuranceDetails)];
    const sql = existing
      ? 'update company_vehicles set plate=$3,brand=$4,model=$5,active=$6,insurance_start=$7,insurance_end=$8,insurance_details=$9,updated_at=now() where id=$1 and shop_id=$2 returning *,insurance_start::text,insurance_end::text'
      : 'insert into company_vehicles(id,shop_id,plate,brand,model,active,insurance_start,insurance_end,insurance_details) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *,insurance_start::text,insurance_end::text';
    return vehicle((await this.database.query(sql, values)).rows[0]);
  }
  async listTrips(user, query = {}) {
    const params=[user.shopId,hasRole(user,'manager'),user.id];
    let where='where shop_id=$1 and ($2 or applicant_id=$3)';
    if(query.scope==='mine')where+=' and applicant_id=$3';
    if(query.scope==='pending'||query.scope==='using'){params.push(query.scope==='pending'?'待审批':'用车中');where+=' and status=$4';}
    if(query.scope==='return-review'){params.push('待收车审核');where+=' and status=$4';}
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
    await this.database.query(`insert into vehicle_trip_requests(id,shop_id,applicant_id,applicant_name,vehicle_id,vehicle_snapshot,reason,note,status,departure_evidence) values($1,$2,$3,$4,$5,$6,$7,$8,'待审批','mileage')`,
      [id, user.shopId, user.id, user.name, car.id, JSON.stringify({ plate: car.plate, brand: car.brand, model: car.model }), input.reason, input.note]);
    return this.getTrip(id);
  }
  async changeTrip(id, action, user, note) {
    const changes = { approve: "status='用车中',approved_by=$2,approved_name=$3,approved_at=now(),departure_at=now()", reject: "status='已驳回',rejection_reason=$2",
      cancel: "status='已取消'", depart: "status='用车中',departure_at=now()",
      return: "status='已还车',return_at=now(),return_reviewed_by=null,return_reviewed_name=null,return_reviewed_at=null,return_rejection_reason=null",
      'approve-return': "status='已还车',return_reviewed_by=$2,return_reviewed_name=$3,return_reviewed_at=now()",
      'reject-return': "status='用车中',return_at=null,return_round=return_round+1,return_reviewed_by=$2,return_reviewed_name=$3,return_reviewed_at=now(),return_rejection_reason=$4" };
    const args = ['approve', 'approve-return'].includes(action) ? [id, user.id, user.name] : action === 'reject-return' ? [id, user.id, user.name, note] : action === 'reject' ? [id, note] : [id];
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
  async addAttachment(tripId, stage, user, file, returnRound = 1) {
    await this.database.query('insert into vehicle_trip_attachments(file_id,trip_id,stage,uploaded_by,return_round) values($1,$2,$3,$4,$5)', [file.id, tripId, stage, user.id, returnRound]);
  }
  async attachments(tripId, user) {
    const { rows } = await this.database.query(`select a.file_id,a.stage,a.confirmed,a.return_round from vehicle_trip_attachments a
      join vehicle_trip_requests t on t.id=a.trip_id
      where a.trip_id=$1 and (a.confirmed or (a.uploaded_by=$2 and
        ((a.stage='signature' and t.status='待审批') or (a.stage='departure' and t.status in ('待审批','待出车')) or (a.stage='return' and t.status='用车中' and a.return_round=t.return_round))))
      order by a.created_at`, [tripId, user.id]);
    return rows.map(r => ({ fileId: r.file_id, stage: r.stage, confirmed: r.confirmed, returnRound: r.return_round }));
  }
  async confirmAttachments(tripId, stage, userId, ids, returnRound = 1) {
    const { rows } = await this.database.query(`update vehicle_trip_attachments set confirmed=true where trip_id=$1 and stage=$2 and uploaded_by=$3 and file_id=any($4::text[]) and (stage<>'return' or return_round=$5) returning file_id`, [tripId, stage, userId, ids, returnRound]);
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
