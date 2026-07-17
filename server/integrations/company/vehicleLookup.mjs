import { HttpError } from "../../http/HttpError.mjs";

// TODO: Replace this adapter body with the company's production vehicle API.
// Keeping the contract here means the route and client do not need to change later.
const mockVehicles = [
  { plate: "辽A12345", vin: "LSVNV2182E2123456", model: "大众 帕萨特 2023款" },
  { plate: "沪AG12345", vin: "LSVCY6C49MN027789", model: "大众汽车 SVW7142BPV" }
];

export async function lookupVehicleInCompanySystem({ plate, vin } = {}) {
  const normalizedPlate = normalizeIdentifier(plate);
  const normalizedVin = normalizeIdentifier(vin);
  if (!normalizedPlate && !normalizedVin) {
    throw new HttpError(400, "请提供车牌号或 VIN 码");
  }

  const vehicle = mockVehicles.find((item) =>
    (normalizedPlate && normalizeIdentifier(item.plate) === normalizedPlate) ||
    (normalizedVin && normalizeIdentifier(item.vin) === normalizedVin)
  );

  return vehicle
    ? { found: true, vehicle, message: "已从公司系统匹配到车辆历史信息" }
    : { found: false, message: "公司系统中未查询到这辆车，可继续新建车辆档案" };
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim().replace(/[\s-]/g, "").toUpperCase() : "";
}
