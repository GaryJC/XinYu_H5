import { executeSqlServerTransaction } from "../database/sqlServerPool.mjs";

export const FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY = `
  select top 2
    reid,
    dh,
    RTRIM(pgd) as pgd
  from dbo.qxwxb with (updlock, holdlock)
  where RTRIM(bzxx) = @source_marker
  order by reid desc
`;

export const FIND_LEGACY_DEPARTMENT_QUERY = `
  select top 1 RTRIM(bm) as code
  from dbo.bmxxb with (holdlock)
  where RTRIM(bm) = @department_code
`;

export const ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY = `
  select
    ISNULL(MAX(dh), 0) as max_document_no,
    ISNULL(MAX(
      case
        when LEFT(UPPER(RTRIM(pgd)), 1) = @dispatch_prefix
          and LEN(RTRIM(pgd)) between 2 and 10
          and PATINDEX('%[^0-9]%', SUBSTRING(RTRIM(pgd), 2, 19)) = 0
        then CONVERT(int, SUBSTRING(RTRIM(pgd), 2, 19))
        else 0
      end
    ), 0) as max_dispatch_number
  from dbo.qxwxb with (tablockx, holdlock)
`;

export const FIND_LEGACY_MODEL_BY_CODE_QUERY = `
  select top 1
    RTRIM(bh) as code,
    COALESCE(NULLIF(RTRIM(qc), ''), RTRIM(mc)) as name
  from dbo.cxb with (holdlock)
  where RTRIM(bh) = @model_code
`;

export const FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY = `
  select top 1 RTRIM(bm) as code, RTRIM(mc) as name
  from dbo.khxxb with (holdlock)
  where RTRIM(bm) = @organization_code
`;

export const INSERT_LEGACY_MODEL_QUERY = `
  insert into dbo.cxb (bh, mc, qc)
  values (@model_code, @model_name, @model_name)
`;

export const INSERT_LEGACY_ORGANIZATION_QUERY = `
  insert into dbo.khxxb (bm, mc, lxr, lxdh, jydz)
  values (@organization_code, @organization_name, @contact, @phone, @address)
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
  { executeTransaction = executeSqlServerTransaction, now = new Date(), dispatchPrefix } = {}
) {
  if (!String(order.id || "").trim()) throw new Error("H5 委托单号不能为空");
  const departmentCode = truncateLegacyText(order.department?.code, 2).toUpperCase();
  const prefix = normalizeDispatchPrefix(dispatchPrefix || dispatchPrefixForDepartment(departmentCode));
  const sourceMarker = truncateLegacyText(`H5:${order.id}`, 50);
  const arrivalDate = formatLegacyDate(order.arrivalDate || now);
  const arrivalTime = formatLegacyTime(now);
  const productionDate = formatLegacyDate(order.vehicle?.purchaseDate);
  const repairItems = order.repairItems || [];
  const projectFees = repairItems.map((item) => normalizeLegacyMoney(item.laborFee, `维修项目“${item.name || "未命名"}”工费`));
  const projectFee = normalizeLegacyMoney(projectFees.reduce((sum, value) => sum + value, 0), "项目工费合计");
  const repairContent = repairItems.map((item) => item.name?.trim()).filter(Boolean).join("；");

  return executeTransaction(async (execute) => {
    const existing = await execute(FIND_LEGACY_WORK_ORDER_BY_SOURCE_QUERY, (request, sql) => {
      request.input("source_marker", sql.VarChar(50), sourceMarker);
    });
    const existingRows = existing.recordset || [];
    if (new Set(existingRows.map((row) => Number(row.reid))).size > 1) {
      throw new Error(`润丰中存在重复的 H5 委托单标记：${order.id}`);
    }
    const existingRow = existingRows[0];
    if (existingRow) return validateLegacyWriteResult(mapLegacyWriteResult(existingRow, true));

    const department = await execute(FIND_LEGACY_DEPARTMENT_QUERY, (request, sql) => {
      request.input("department_code", sql.VarChar(2), departmentCode);
    });
    if (!department.recordset?.[0]) throw new Error(`润丰部门编码不存在：${departmentCode || "空"}`);

    const vehicleResult = await execute(FIND_LEGACY_VEHICLE_FOR_WRITE_QUERY, (request, sql) => {
      request.input("plate", sql.VarChar(50), normalizeIdentifier(order.vehicle?.plate));
      request.input("vin", sql.VarChar(50), normalizeIdentifier(order.vehicle?.vin));
    });
    const vehicleRows = vehicleResult.recordset || [];
    if (new Set(vehicleRows.map((row) => Number(row.reid))).size > 1) {
      throw new Error("车牌号和 VIN 指向润丰中的不同车辆，已停止写入");
    }
    const existingVehicle = vehicleRows.find((row) => row.plate_matched) || vehicleRows[0];
    let modelText = existingVehicle?.cx || "";
    let organizationCode = existingVehicle?.ssdw || "";

    if (!existingVehicle) {
      const modelCode = requiredLegacyCode(order.vehicle?.modelLegacyCode, 10, "车型");
      const modelName = truncateLegacyText(order.vehicle?.model, 100);
      const model = await execute(FIND_LEGACY_MODEL_BY_CODE_QUERY, (request, sql) => {
        request.input("model_code", sql.VarChar(10), modelCode);
      });
      const modelRow = model.recordset?.[0];
      if (modelRow) {
        assertMatchingReferenceName("车型", modelCode, modelName, modelRow.name);
        modelText = buildLegacyModel({ modelLegacyCode: modelRow.code, model: modelRow.name });
      } else {
        assertNewLegacyCode(modelCode, "车型");
        try {
          await execute(INSERT_LEGACY_MODEL_QUERY, (request, sql) => {
            request.input("model_code", sql.Char(10), modelCode);
            request.input("model_name", sql.VarChar(100), modelName);
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) throw new Error(`车型编码 ${modelCode} 已被其他记录使用，请修改编码`);
          throw error;
        }
        modelText = buildLegacyModel({ modelLegacyCode: modelCode, model: modelName });
      }

      organizationCode = requiredLegacyCode(order.customer?.legacyCode, 50, "所属单位");
      const organizationName = truncateLegacyText(order.customer?.name, 150);
      const organization = await execute(FIND_LEGACY_ORGANIZATION_BY_CODE_QUERY, (request, sql) => {
        request.input("organization_code", sql.VarChar(50), organizationCode);
      });
      const organizationRow = organization.recordset?.[0];
      if (organizationRow) {
        assertMatchingReferenceName("所属单位", organizationCode, organizationName, organizationRow.name);
        organizationCode = organizationRow.code;
      } else {
        assertNewLegacyCode(organizationCode, "所属单位");
        try {
          await execute(INSERT_LEGACY_ORGANIZATION_QUERY, (request, sql) => {
            request.input("organization_code", sql.VarChar(50), organizationCode);
            request.input("organization_name", sql.VarChar(150), organizationName);
            request.input("contact", sql.VarChar(80), truncateLegacyText(order.customer?.contact, 80));
            request.input("phone", sql.VarChar(80), truncateLegacyText(order.customer?.phone, 80));
            request.input("address", sql.VarChar(150), truncateLegacyText(order.customer?.address, 150));
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) throw new Error(`所属单位编码 ${organizationCode} 已被其他记录使用，请修改编码`);
          throw error;
        }
      }
    }

    const allocated = await execute(ALLOCATE_LEGACY_WORK_ORDER_NUMBERS_QUERY, (request, sql) => {
      request.input("dispatch_prefix", sql.Char(1), prefix);
    });
    const documentNo = Number(allocated.recordset?.[0]?.max_document_no || 0) + 1;
    const dispatchNumber = Number(allocated.recordset?.[0]?.max_dispatch_number || 0) + 1;
    if (!Number.isSafeInteger(documentNo) || documentNo < 1 || documentNo > 2147483647) {
      throw new Error("润丰内部单号已超出可用范围");
    }
    if (!Number.isSafeInteger(dispatchNumber) || dispatchNumber < 1 || dispatchNumber > 999999999) {
      throw new Error(`润丰 ${prefix} 系列派工号已超出可用范围`);
    }
    const dispatchNo = `${prefix}${dispatchNumber}`;

    if (!existingVehicle) {
      await execute(INSERT_LEGACY_VEHICLE_QUERY, (request, sql) => {
        request.input("plate_text", sql.VarChar(10), truncateLegacyText(order.vehicle?.plate, 10));
        request.input("model_text", sql.VarChar(100), modelText);
        request.input("production_date", sql.Char(10), productionDate);
        request.input("organization_code", sql.VarChar(50), organizationCode);
        request.input("contact", sql.VarChar(20), truncateLegacyText(order.customer?.contact, 20));
        request.input("phone", sql.VarChar(50), truncateLegacyText(order.customer?.phone, 50));
        request.input("vehicle_note", sql.VarChar(200), truncateLegacyText(order.customer?.address, 200));
        request.input("vin_text", sql.Char(20), truncateLegacyText(order.vehicle?.vin, 20));
      });
    }

    const header = await execute(INSERT_LEGACY_WORK_ORDER_QUERY, (request, sql) => {
      request.input("department_code", sql.VarChar(50), departmentCode);
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

    for (const [index, item] of repairItems.entries()) {
      await execute(INSERT_LEGACY_REPAIR_ITEM_QUERY, (request, sql) => {
        request.input("document_no", sql.Int, documentNo);
        request.input("item_name", sql.VarChar(100), truncateLegacyText(item.name, 100));
        request.input("labor_fee", sql.Decimal(18, 2), projectFees[index]);
        request.input("item_no", sql.SmallInt, index + 1);
      });
    }

    return validateLegacyWriteResult({
      reid: Number(header.recordset?.[0]?.reid || 0),
      documentNo,
      dispatchNo,
      existing: false
    });
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

function requiredLegacyCode(value, maxLength, label) {
  const code = String(value || "").trim();
  if (!code) throw new Error(`新车辆必须选择已有${label}或新增${label}编码`);
  if (code.length > maxLength) throw new Error(`${label}编码最多 ${maxLength} 个字符`);
  return code;
}

function assertNewLegacyCode(code, label) {
  if (!/^[A-Za-z0-9]+$/.test(code)) throw new Error(`新增${label}编码只能包含英文字母和数字`);
}

function assertMatchingReferenceName(label, code, inputName, existingName) {
  if (normalizeReferenceName(inputName) !== normalizeReferenceName(existingName)) {
    throw new Error(`${label}编码 ${code} 已被“${String(existingName || "其他记录").trim()}”使用，请修改编码`);
  }
}

function isDuplicateKeyError(error) {
  const pending = [error];
  const visited = new Set();
  while (pending.length) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || visited.has(current)) continue;
    visited.add(current);
    if (current.number === 2601 || current.number === 2627 || current.info?.number === 2601 || current.info?.number === 2627) {
      return true;
    }
    pending.push(current.originalError, current.cause, ...(current.precedingErrors || []));
  }
  return false;
}

function normalizeReferenceName(value) {
  return String(value || "").normalize("NFKC").trim().replace(/[\s\-_]/g, "").toUpperCase();
}

function normalizeDispatchPrefix(value) {
  const prefix = String(value || "A").trim().toUpperCase();
  if (!/^[A-Z]$/.test(prefix)) throw new Error("派工号前缀必须是单个英文字母");
  return prefix;
}

export function dispatchPrefixForDepartment(departmentCode) {
  const code = String(departmentCode || "").trim().toUpperCase();
  if (code === "M") return "A";
  if (/^[ABFJ]$/.test(code)) return code;
  throw new Error(`无法确定润丰部门“${code || "空"}”的派工号前缀`);
}

function normalizeLegacyMoney(value, label) {
  const amount = Number(value || 0);
  const cents = Math.round((amount + Number.EPSILON) * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(cents)) {
    throw new Error(`${label}无效`);
  }
  return cents / 100;
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

function validateLegacyWriteResult(result) {
  if (!Number.isInteger(result.reid) || result.reid < 1) throw new Error("润丰未返回有效的维修单 reid");
  if (!Number.isInteger(result.documentNo) || result.documentNo < 1) throw new Error("润丰未返回有效的内部单号");
  if (!/^[A-Z][0-9]+$/.test(result.dispatchNo)) throw new Error("润丰未返回有效的派工号");
  return result;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
