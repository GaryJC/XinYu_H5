import { HttpError } from "../../http/HttpError.mjs";
import { hasSqlServerConfig } from "../../config/sqlServerConfig.mjs";
import {
  findLegacyModelCandidates,
  findLegacyOrganizationCandidates,
  findLegacyVehicle
} from "../../repositories/legacyVehicleRepository.mjs";

const mockVehicles = [
  { id: "1", plate: "辽A12345", vin: "LSVNV2182E2123456", model: "大众 帕萨特 2023款", modelLegacyCode: "DZPST", organization: { code: "GR", name: "个人" } },
  { id: "2", plate: "沪AG12345", vin: "LSVCY6C49MN027789", model: "大众汽车 SVW7142BPV", modelLegacyCode: "DZ", organization: { code: "QDDTGSYXYYFGS", name: "青岛地铁运营有限公司" } }
];

const mockModels = [
  { value: "大众 帕萨特 2023款", code: "DZPST", usageCount: 12 },
  { value: "大众汽车 SVW7142BPV", code: "DZ", usageCount: 6 },
  { value: "奥迪 A6", code: "ADA6", usageCount: 8 }
];

const mockOrganizations = [
  { value: "个人", code: "GR", usageCount: 20 },
  { value: "青岛地铁运营有限公司", code: "QDDTGSYXYYFGS", usageCount: 10 },
  { value: "青岛水务集团有限公司", code: "QDSWJT", usageCount: 8 },
  { value: "青岛水务发展有限公司", code: "QDSWFZ", usageCount: 5 }
];

export async function lookupVehicleInCompanySystem({ plate, vin, model, owner } = {}) {
  const normalizedPlate = normalizeIdentifier(plate);
  const normalizedVin = normalizeIdentifier(vin);
  if (!normalizedPlate && !normalizedVin) {
    throw new HttpError(400, "请提供车牌号或 VIN 码");
  }

  const configured = hasSqlServerConfig();
  const candidates = configured
    ? await findLegacyVehicle({ plate: normalizedPlate, vin: normalizedVin })
    : findMockVehicles(normalizedPlate, normalizedVin);
  const vehicleResolution = resolveVehicleCandidates(candidates, normalizedPlate, normalizedVin);

  if (vehicleResolution.status === "conflict") {
    return {
      found: false,
      status: "conflict",
      conflicts: vehicleResolution.conflicts,
      message: "车牌和 VIN 分别匹配到不同车辆，已停止自动回填，请核对行驶证"
    };
  }

  if (vehicleResolution.vehicle) {
    return {
      found: true,
      status: "found",
      vehicle: publicVehicle(vehicleResolution.vehicle),
      message: "已从公司系统匹配到现有车辆，继续使用原车型和所属单位"
    };
  }

  const normalizedModel = normalizeReference(model);
  const normalizedOwner = normalizeReference(owner);
  const [modelCandidates, organizationCandidates] = await Promise.all([
    normalizedModel
      ? configured ? findLegacyModelCandidates(normalizedModel) : Promise.resolve(findMockReferences(mockModels, normalizedModel))
      : Promise.resolve([]),
    normalizedOwner
      ? configured ? findLegacyOrganizationCandidates(normalizedOwner) : Promise.resolve(findMockReferences(mockOrganizations, normalizedOwner))
      : Promise.resolve([])
  ]);
  const references = {};
  if (typeof model === "string" && model.trim()) references.model = resolveReference(model, modelCandidates, true);
  if (typeof owner === "string" && owner.trim()) references.organization = resolveReference(owner, organizationCandidates, true);

  const matchedParts = [
    references.model?.status === "matched" ? "已有车型" : "",
    references.organization?.status === "matched" ? "已有所属单位" : ""
  ].filter(Boolean);
  const candidateParts = [
    references.model?.status === "ambiguous" ? "车型" : "",
    references.organization?.status === "ambiguous" ? "所属单位" : ""
  ].filter(Boolean);
  return {
    found: false,
    status: "new",
    ...(Object.keys(references).length ? { references } : {}),
    message: candidateParts.length
      ? `公司系统中没有这辆车，请选择相关${candidateParts.join("和")}`
      : matchedParts.length
      ? `公司系统中没有这辆车，已匹配并复用${matchedParts.join("和")}`
      : "公司系统中未查询到这辆车，可继续新建车辆档案"
  };
}

export async function searchCompanyVehicleReferences({ kind, query } = {}) {
  if (kind !== "model" && kind !== "organization") {
    throw new HttpError(400, "请选择车型或所属单位查询类型");
  }
  const normalizedQuery = normalizeReference(query);
  if (normalizedQuery.length < 2) return { kind, query: typeof query === "string" ? query : "", candidates: [] };

  const configured = hasSqlServerConfig();
  const candidates = kind === "model"
    ? configured
      ? await findLegacyModelCandidates(normalizedQuery)
      : findMockReferences(mockModels, normalizedQuery)
    : configured
      ? await findLegacyOrganizationCandidates(normalizedQuery)
      : findMockReferences(mockOrganizations, normalizedQuery);
  return { kind, query, candidates };
}

export function resolveVehicleCandidates(candidates, normalizedPlate, normalizedVin) {
  const plateMatch = normalizedPlate ? candidates.find((item) => item.plateMatched ?? normalizeIdentifier(item.plate) === normalizedPlate) : undefined;
  const vinMatch = normalizedVin ? candidates.find((item) => item.vinMatched ?? normalizeIdentifier(item.vin) === normalizedVin) : undefined;
  if (plateMatch && vinMatch && plateMatch.id !== vinMatch.id) {
    return {
      status: "conflict",
      conflicts: [
        { identifier: "plate", plate: plateMatch.plate, vin: plateMatch.vin },
        { identifier: "vin", plate: vinMatch.plate, vin: vinMatch.vin }
      ]
    };
  }
  return { status: plateMatch || vinMatch ? "found" : "new", vehicle: vinMatch || plateMatch };
}

export function resolveReference(input, candidates, requireUniqueCode) {
  if (!candidates.length) return { input, status: "not_found", candidates: [] };
  const normalizedInput = normalizeReference(input);
  const exactCandidates = candidates.filter((item) => normalizeReference(item.value) === normalizedInput);
  if (!exactCandidates.length) return { input, status: "ambiguous", candidates };
  const uniqueCodes = new Set(exactCandidates.map((item) => requireUniqueCode ? item.code : normalizeReference(item.value)));
  if (uniqueCodes.size > 1) return { input, status: "ambiguous", candidates: exactCandidates };
  return { input, status: "matched", selected: exactCandidates[0], candidates: exactCandidates };
}

function findMockVehicles(normalizedPlate, normalizedVin) {
  if (process.env.APP_ENV === "production") {
    throw new HttpError(503, "公司车辆数据库未配置");
  }
  return mockVehicles
    .filter((item) =>
      (normalizedPlate && normalizeIdentifier(item.plate) === normalizedPlate) ||
      (normalizedVin && normalizeIdentifier(item.vin) === normalizedVin)
    )
    .map((item) => ({
      ...item,
      plateMatched: Boolean(normalizedPlate && normalizeIdentifier(item.plate) === normalizedPlate),
      vinMatched: Boolean(normalizedVin && normalizeIdentifier(item.vin) === normalizedVin)
    }));
}

function findMockReferences(references, normalizedInput) {
  return references.filter((item) => fuzzyReferenceMatch(normalizeReference(item.value), normalizedInput));
}

function fuzzyReferenceMatch(candidate, input) {
  let position = 0;
  for (const character of Array.from(input)) {
    const matchAt = candidate.indexOf(character, position);
    if (matchAt < 0) return false;
    position = matchAt + character.length;
  }
  return true;
}

function publicVehicle(vehicle) {
  return {
    plate: vehicle.plate,
    vin: vehicle.vin,
    model: vehicle.model,
    modelLegacyCode: vehicle.modelLegacyCode || "",
    organization: vehicle.organization
  };
}

function normalizeIdentifier(value) {
  return typeof value === "string" ? value.trim().replace(/[\s-]/g, "").toUpperCase() : "";
}

export function normalizeReference(value) {
  return typeof value === "string"
    ? value.normalize("NFKC").trim().replace(/[\s\-_]/g, "").toUpperCase()
    : "";
}
