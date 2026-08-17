import {
  closeSqlServerPool,
  executeSqlServerQuery
} from "../server/database/sqlServerPool.mjs";

const args = process.argv.slice(2);
const orderId = readOption(args, "--order-id");
const sourceMarker = orderId ? normalizeSourceMarker(orderId) : "";

const FIND_LATEST_H5_ORDER = `
  select top 1 *
  from dbo.qxwxb
  where RTRIM(bzxx) like 'H5:%'
  order by reid desc
`;

const FIND_H5_ORDER_BY_MARKER = `
  select top 1 *
  from dbo.qxwxb
  where RTRIM(bzxx) = @source_marker
  order by reid desc
`;

const FIND_COMPARISON_ORDER = `
  select top 1 *
  from dbo.qxwxb
  where reid <> @reid
    and RTRIM(bm) = @department_code
    and ISNULL(RTRIM(wd), '') = @workshop_flag
    and ISNULL(RTRIM(bzxx), '') not like 'H5:%'
  order by ABS(reid - @reid)
`;

const FIND_VEHICLES = `
  select top 10 *
  from dbo.qxclxxb
  where REPLACE(REPLACE(UPPER(RTRIM(ch)), ' ', ''), '-', '') = @plate
     or (@vin <> '' and REPLACE(REPLACE(UPPER(RTRIM(sbdm)), ' ', ''), '-', '') = @vin)
  order by reid desc
`;

const FIND_MODEL = `
  select top 10 *
  from dbo.cxb
  where RTRIM(bh) = @model_code
     or RTRIM(qc) = @model_text
     or RTRIM(mc) = @model_text
`;

const FIND_ORGANIZATION = `
  select top 10 *
  from dbo.khxxb
  where RTRIM(bm) = @organization_code
`;

const FIND_REPAIR_ITEMS = `
  select *
  from dbo.qxwxmxb
  where ISNULL(RTRIM(wd), '') = @workshop_flag
    and dh = @document_no
  order by Xh
`;

const FIND_TABLE_COLUMNS = `
  select
    RTRIM(o.name) as table_name,
    c.colid as column_no,
    RTRIM(c.name) as column_name,
    RTRIM(t.name) as data_type,
    c.length as max_bytes,
    c.isnullable as is_nullable,
    c.cdefault as default_object_id
  from dbo.sysobjects o
  inner join dbo.syscolumns c on c.id = o.id
  inner join dbo.systypes t on t.xusertype = c.xusertype
  where o.xtype = 'U'
    and o.name in ('qxwxb', 'qxwxmxb', 'qxclxxb')
  order by o.name, c.colid
`;

try {
  const h5Result = await executeSqlServerQuery(
    sourceMarker ? FIND_H5_ORDER_BY_MARKER : FIND_LATEST_H5_ORDER,
    sourceMarker
      ? (request, sql) => request.input("source_marker", sql.VarChar(50), sourceMarker)
      : undefined
  );
  const h5Order = h5Result.recordset?.[0];
  if (!h5Order) {
    throw new Error(sourceMarker ? `未找到 ${sourceMarker} 对应的润丰维修单` : "未找到 bzxx 以 H5: 开头的润丰维修单");
  }

  const [comparisonResult, vehicleResult, modelResult, organizationResult, itemResult, columnsResult] =
    await Promise.all([
      executeSqlServerQuery(FIND_COMPARISON_ORDER, (request, sql) => {
        request.input("reid", sql.Int, Number(h5Order.reid));
        request.input("department_code", sql.VarChar(50), trimmed(h5Order.bm));
        request.input("workshop_flag", sql.VarChar(10), trimmed(h5Order.wd));
      }),
      executeSqlServerQuery(FIND_VEHICLES, (request, sql) => {
        request.input("plate", sql.VarChar(50), normalizeIdentifier(h5Order.ch));
        request.input("vin", sql.VarChar(50), "");
      }),
      executeSqlServerQuery(FIND_MODEL, (request, sql) => {
        const model = parseLegacyModel(h5Order.cx);
        request.input("model_code", sql.VarChar(50), model.code);
        request.input("model_text", sql.VarChar(100), model.name);
      }),
      executeSqlServerQuery(FIND_ORGANIZATION, (request, sql) => {
        request.input("organization_code", sql.VarChar(50), trimmed(h5Order.ssdw));
      }),
      executeSqlServerQuery(FIND_REPAIR_ITEMS, (request, sql) => {
        request.input("workshop_flag", sql.VarChar(10), trimmed(h5Order.wd));
        request.input("document_no", sql.Int, Number(h5Order.dh));
      }),
      executeSqlServerQuery(FIND_TABLE_COLUMNS)
    ]);

  const comparisonOrder = comparisonResult.recordset?.[0] || null;
  console.log(JSON.stringify(clean({
    inspectedSource: trimmed(h5Order.bzxx),
    warning: "本脚本只执行 SELECT，不会修改润丰数据",
    h5Order,
    comparisonOrder,
    differingHeaderFields: comparisonOrder ? differingFields(h5Order, comparisonOrder) : [],
    matchingVehicles: vehicleResult.recordset || [],
    matchingModels: modelResult.recordset || [],
    matchingOrganizations: organizationResult.recordset || [],
    repairItems: itemResult.recordset || [],
    tableColumns: groupColumns(columnsResult.recordset || [])
  }), null, 2));
} catch (error) {
  console.error(`润丰维修单检查失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await closeSqlServerPool();
}

function readOption(values, option) {
  const index = values.indexOf(option);
  if (index < 0) return "";
  const value = String(values[index + 1] || "").trim();
  if (!value || value.startsWith("--")) throw new Error(`${option} 后必须提供委托单号`);
  return value;
}

function normalizeSourceMarker(value) {
  const text = String(value || "").trim();
  return text.toUpperCase().startsWith("H5:") ? text : `H5:${text}`;
}

function normalizeIdentifier(value) {
  return trimmed(value).toUpperCase().replace(/[\s-]/g, "");
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function parseLegacyModel(value) {
  const text = trimmed(value);
  const match = text.match(/^(\S+)\s+(.+)$/);
  return match ? { code: match[1], name: match[2] } : { code: "", name: text };
}

function differingFields(left, right) {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter((key) => normalizedValue(left[key]) !== normalizedValue(right[key]))
    .map((key) => ({ field: key, h5: left[key], runfeng: right[key] }));
}

function normalizedValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  return value == null ? null : String(value);
}

function groupColumns(rows) {
  return rows.reduce((result, row) => {
    const table = trimmed(row.table_name);
    (result[table] ||= []).push({
      name: trimmed(row.column_name),
      type: trimmed(row.data_type),
      maxBytes: row.max_bytes,
      nullable: Boolean(row.is_nullable),
      hasDefault: Number(row.default_object_id || 0) !== 0
    });
    return result;
  }, {});
}

function clean(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clean(entry)]));
  }
  return typeof value === "string" ? value.trimEnd() : value;
}
