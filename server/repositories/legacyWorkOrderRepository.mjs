import { executeSqlServerTransaction } from "../database/sqlServerPool.mjs";
import { HttpError } from "../http/HttpError.mjs";

export const LEGACY_ORDER_QUERY = `select top 2 reid, dh, wd, pgd, bzxx, ch, cx, lc, jcrq, jhrq,
  sxr, lxr, lxdh, ssdw, wxnr, fyhj from dbo.qxwxb
  where (@reid is not null and reid=@reid and dh=@dh)
     or (@reid is null and RTRIM(bzxx)=@marker)`;
export const LEGACY_ITEMS_QUERY = `select reid, Xh, hh, je from dbo.qxwxmxb
  where dh=@dh and wd=@wd and RTRIM(lb)='项目' order by Xh, reid`;

// Read the header and its details from one consistent SQL Server snapshot.
// No writes are made to Runfeng, and no plate-only fallback is allowed.
export async function readLegacyWorkOrder(order, runTransaction = executeSqlServerTransaction) {
  return runTransaction(async execute => {
    const linked = order.legacy_reid != null && order.legacy_document_no != null;
    const result = await execute(LEGACY_ORDER_QUERY, (request, sql) => {
      request.input("reid", sql.Int, linked ? Number(order.legacy_reid) : null);
      request.input("dh", sql.Int, linked ? Number(order.legacy_document_no) : null);
      request.input("marker", sql.VarChar(50), `H5:${order.id}`);
    });
    if (result.recordset?.length !== 1) throw new HttpError(409, result.recordset?.length ? "润丰存在多个对应单据，无法安全更新" : "润丰未找到对应单据，原数据未修改");
    const header = result.recordset[0];
    const marker = String(header.bzxx || "").trim();
    if (marker.startsWith("H5:") && marker !== `H5:${order.id}`) throw new HttpError(409, "润丰来源标记与委托单不一致");
    if (!linked && order.dispatch_no && String(header.pgd || "").trim() !== order.dispatch_no.trim()) throw new HttpError(409, "润丰派工号与委托单不一致");
    const items = await execute(LEGACY_ITEMS_QUERY, (request, sql) => {
      request.input("dh", sql.Int, header.dh);
      request.input("wd", sql.VarChar(50), String(header.wd || "").trim());
    });
    const vehicles = await execute(`select top 2 v.sbdm, v.cx,
      m.bh as model_code, COALESCE(NULLIF(RTRIM(m.qc),''),NULLIF(RTRIM(m.mc),''),NULLIF(@model,''),v.cx) as model_name
      from dbo.qxclxxb v left join dbo.cxb m on COALESCE(NULLIF(@model,''),RTRIM(v.cx))=RTRIM(m.bh)
        or COALESCE(NULLIF(@model,''),RTRIM(v.cx))=RTRIM(m.bh)+' '+RTRIM(m.qc)
        or COALESCE(NULLIF(@model,''),RTRIM(v.cx))=RTRIM(m.bh)+' '+RTRIM(m.mc)
      where RTRIM(v.ch)=@plate`, (request, sql) => {
        request.input("plate", sql.VarChar(50), String(header.ch || "").trim());
        request.input("model", sql.VarChar(200), String(header.cx || "").trim());
      });
    if (vehicles.recordset?.length > 1) throw new HttpError(409, "润丰车辆档案存在多个匹配，请先核对润丰数据");
    const customers = await execute(`select top 2 mc, jydz from dbo.khxxb where RTRIM(bm)=@code`,
      (request, sql) => request.input("code", sql.VarChar(50), String(header.ssdw || "").trim()));
    if (customers.recordset?.length > 1) throw new HttpError(409, "润丰客户档案存在多个匹配");
    return { originalPlate: order.vehicle_plate, header, items: items.recordset || [], vehicle: vehicles.recordset?.[0], customer: customers.recordset?.[0] };
  });
}
