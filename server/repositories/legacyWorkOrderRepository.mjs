import { executeSqlServerTransaction } from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY = `
  select top 1
    reid,
    dh,
    RTRIM(pgd) as pgd
  from dbo.qxwxb with (updlock, holdlock)
  where RTRIM(bzxx) = @source_marker
  order by reid desc
`;

export const ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY = `
  select
    ISNULL(MAX(dh), 0) as max_document_no,
    ISNULL(MAX(
      case
        when LEFT(UPPER(RTRIM(pgd)), 1) = @dispatch_prefix
          and LEN(RTRIM(pgd)) > 1
          and PATINDEX('%[^0-9]%', SUBSTRING(RTRIM(pgd), 2, 19)) = 0
        then CONVERT(int, SUBSTRING(RTRIM(pgd), 2, 19))
        else 0
      end
    ), 0) as max_dispatch_number
  from dbo.qxwxb with (tablockx, holdlock)
`;

export const FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY = `
  select * from (
    select top 1 reid, RTRIM(cx) as cx, RTRIM(ssdw) as ssdw, 1 as plate_matched
    from dbo.qxclxxb with (updlock, holdlock)
    where @plate <> '' and REPLACE(REPLACE(UPPER(RTRIM(ch)), ' ', ''), '-', '') = @plate
    order by reid desc
  ) plate_result
  union all
  select * from (
    select top 1 reid, RTRIM(cx) as cx, RTRIM(ssdw) as ssdw, 0 as plate_matched
    from dbo.qxclxxb with (updlock, holdlock)
    where @vin <> '' and REPLACE(REPLACE(UPPER(RTRIM(sbdm)), ' ', ''), '-', '') = @vin
    order by reid desc
  ) vin_result
`;

export const INSERT_LEGACY_VEHICLE_QUERY = `
  insert into dbo.qxclxxb (ch, cx, scrq, ssdw, lxr, lxdh, bz, sbdm)
  values (@plate_text, @model_text, @production_date, @organization_code, @contact, @phone, @vehicle_note, @vin_text)
`;

export const INSERT_LEGACY_WORK_ORDER_QUERY = `
  insert into dbo.qxwxb (
    bm, wd, dh, jcrq, jcsj, ch, cx, sxr, wxnr, fyhj, bz, jcr,
    pgd, lc, xmfy, lxdh, wxlb, lxr, ssdw, ywd, zcbz, bzxx
  ) values (
    @department_code, '', @document_no, @arrival_date, @arrival_time, @plate_text, @model_text,
    @sender, @repair_content, @total_fee, @note, @advisor, @dispatch_no, @mileage,
    @project_fee, @phone, @repair_category, @contact, @organization_code, 0, 0, @source_marker
  );
  select CONVERT(int, SCOPE_IDENTITY()) as reid;
`;

export const INSERT_LEGACY_REPAIR_ITEM_QUERY = `
  insert into dbo.qxwxmxb (wd, dh, lb, hh, sl, dj, je, gs, bz, wxr, hh0, Xh)
  values ('', @document_no, '项目', @item_name, 1, @labor_fee, @labor_fee, @labor_fee, '', '', '', @item_no)
`;

export async function writeLegacyWorkOrder(
  order,
  { executeTransaction = executeSqlServerTransaction, now = new Date(), dispatchPrefix = "A" } = {}
) {
  const prefix = normalizeDispatchPrefix(dispatchPrefix);
  const sourceMarker = truncateLegacyText(`H5:${order.id}`, 50);

  return executeTransaction(async (execute) => {
    const existing = await execute(FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY, (request, sql) => {
      request.input("source_marker", sql.VarChar(50), sourceMarker);
    });
    const existingRow = existing.recordset?.[0];
    if (existingRow) return mapLegacyWriteResult(existingRow, true);

    const allocated = await execute(ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, (request, sql) => {
      request.input("dispatch_prefix", sql.Char(1), prefix);
    });
    const documentNo = Number(allocated.recordset?.[0]?.max_document_no || 0) + 1;
    const dispatchNumber = Number(allocated.recordset?.[0]?.max_dispatch_number || 0) + 1;
    const dispatchNo = `${prefix}${dispatchNumber}`;

    const vehicleResult = await execute(FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY, (request, sql) => {
      request.input("plate", sql.VarChar(50), normalizeIdentifier(order.vehicle?.plate));
      request.input("vin", sql.VarChar(50), normalizeIdentifier(order.vehicle?.vin));
    });
    const vehicleRows = vehicleResult.recordset || [];
    if (new Set(vehicleRows.map((row) => Number(row.reid))).size > 1) {
      throw new Error("车牌号和 VIN 指向润丰中的不同车辆，已停止写入");
    }
    const existingVehicle = vehicleRows.find((row) => row.plate_matched) || vehicleRows[0];
    const modelText = existingVehicle?.cx || buildLegacyModel(order.vehicle);
    const organizationCode = existingVehicle?.ssdw || truncateLegacyText(order.customer?.legacyCode, 50);

    if (!existingVehicle) {
      await execute(INSERT_LEGACY_VEHICLE_QUERY, (request, sql) => {
        request.input("plate_text", sql.VarChar(10), truncateLegacyText(order.vehicle?.plate, 10));
        request.input("model_text", sql.VarChar(100), modelText);
        request.input("production_date", sql.Char(10), formatLegacyDate(order.vehicle?.purchaseDate));
        request.input("organization_code", sql.VarChar(50), organizationCode);
        request.input("contact", sql.VarChar(20), truncateLegacyText(order.customer?.contact, 20));
        request.input("phone", sql.VarChar(50), truncateLegacyText(order.customer?.phone, 50));
        request.input("vehicle_note", sql.VarChar(200), truncateLegacyText(order.customer?.address, 200));
        request.input("vin_text", sql.Char(20), truncateLegacyText(order.vehicle?.vin, 20));
      });
    }

    const arrivalDate = formatLegacyDate(order.arrivalDate || now);
    const arrivalTime = formatLegacyTime(now);
    const projectFee = (order.repairItems || []).reduce((sum, item) => sum + Number(item.laborFee || 0), 0);
    const repairContent = (order.repairItems || []).map((item) => item.name?.trim()).filter(Boolean).join("；");
    const header = await execute(INSERT_LEGACY_WORK_ORDER_QUERY, (request, sql) => {
      request.input("department_code", sql.VarChar(50), truncateLegacyText(order.department?.code, 50));
      request.input("document_no", sql.Int, documentNo);
      request.input("arrival_date", sql.Char(10), arrivalDate);
      request.input("arrival_time", sql.Char(5), arrivalTime);
      request.input("plate_text", sql.Char(10), truncateLegacyText(order.vehicle?.plate, 10));
      request.input("model_text", sql.VarChar(100), modelText);
      request.input("sender", sql.VarChar(50), truncateLegacyText(order.customer?.contact || order.customer?.name, 50));
      request.input("repair_content", sql.VarChar(500), truncateLegacyText(repairContent || order.faultDescription, 500));
      request.input("total_fee", sql.Decimal(18, 2), projectFee);
      request.input("note", sql.VarChar(400), truncateLegacyText(order.faultDescription, 400));
      request.input("advisor", sql.Char(20), truncateLegacyText(order.advisor, 20));
      request.input("dispatch_no", sql.VarChar(20), dispatchNo);
      request.input("mileage", sql.Char(20), truncateLegacyText(order.vehicle?.mileage, 20));
      request.input("project_fee", sql.Decimal(18, 2), projectFee);
      request.input("phone", sql.VarChar(50), truncateLegacyText(order.customer?.phone, 50));
      request.input("repair_category", sql.Char(20), "小修");
      request.input("contact", sql.VarChar(20), truncateLegacyText(order.customer?.contact, 20));
      request.input("organization_code", sql.VarChar(50), organizationCode);
      request.input("source_marker", sql.VarChar(50), sourceMarker);
    });

    for (const [index, item] of (order.repairItems || []).entries()) {
      await execute(INSERT_LEGACY_REPAIR_ITEM_QUERY, (request, sql) => {
        request.input("document_no", sql.Int, documentNo);
        request.input("item_name", sql.VarChar(100), truncateLegacyText(item.name, 100));
        request.input("labor_fee", sql.Decimal(18, 2), Number(item.laborFee || 0));
        request.input("item_no", sql.SmallInt, index + 1);
      });
    }

    return {
      reid: Number(header.recordset?.[0]?.reid || 0),
      documentNo,
      dispatchNo,
      existing: false
    };
  });
}

export function formatLegacyDate(value) {
  if (!value) return "";
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("进厂日期无效");
    return `${value.getFullYear()}.${pad(value.getMonth() + 1)}.${pad(value.getDate())}`;
  }
  const match = String(value).trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!match) throw new Error("进厂日期必须是 YYYY-MM-DD 格式");
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    throw new Error("进厂日期无效");
  }
  return `${match[1]}.${pad(match[2])}.${pad(match[3])}`;
}

export function truncateLegacyText(value, maxBytes) {
  let output = "";
  let bytes = 0;
  for (const character of String(value || "").trim()) {
    const size = character.codePointAt(0) <= 0x7f ? 1 : 2;
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

function buildLegacyModel(vehicle = {}) {
  const code = truncateLegacyText(vehicle.modelLegacyCode, 50);
  const name = truncateLegacyText(vehicle.model, 100);
  if (!code || name.toUpperCase().startsWith(code.toUpperCase())) return name;
  return truncateLegacyText(`${code} ${name}`, 100);
}

function normalizeIdentifier(value) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]/g, "");
}

function normalizeDispatchPrefix(value) {
  const prefix = String(value || "A").trim().toUpperCase();
  if (!/^[A-Z]$/.test(prefix)) throw new Error("派工号前缀必须是单个英文字母");
  return prefix;
}

function formatLegacyTime(value) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function mapLegacyWriteResult(row, existing) {
  return {
    reid: Number(row.reid || 0),
    documentNo: Number(row.dh || 0),
    dispatchNo: String(row.pgd || "").trim(),
    existing
  };
}

function pad(value) {
  return String(value).padStart(2, "0");
}
