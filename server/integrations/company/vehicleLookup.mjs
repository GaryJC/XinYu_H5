import { legacyReferenceNameError } from "../../../shared/legacyInputValidation.mjs";
import { HttpError } from "../../http/HttpError.mjs";
import { hasSqlServerConfig } from "../../config/sqlServerConfig.mjs";
import {
  findLegacyModelCandidates,
  findLegacyOrganizationCandidates,
  findLegacyReferenceByCode,
  findLegacyVehicle,
  createLegacyVehicleReference
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

export async function lookupVehicleInCompanySystem({ plate, vin, model, owner, confirmedPlate } = {}) {
  const normalizedPlate = plateSearchKey(plate);
  const normalizedVin = normalizeIdentifier(vin);
  if (!normalizedPlate && !normalizedVin) {
    throw new HttpError(400, "请提供车牌号或 VIN 码");
  }

  const configured = configuredVehicleDatabase();
  const candidates = configured
    ? await findLegacyVehicle({ plate: normalizedPlate, vin: normalizedVin })
    : findMockVehicles(normalizedPlate, normalizedVin);
  const vehicleResolution = resolveVehicleCandidates(candidates, normalizedPlate, normalizedVin, confirmedPlate);

  if (vehicleResolution.status === "conflict") {
    return {
      found: false,
      status: "conflict",
      conflicts: vehicleResolution.conflicts,
      plateChoices: vehicleResolution.plateChoices,
      message: vehicleResolution.message || "车牌和 VIN 分别匹配到不同车辆，已停止自动回填，请核对行驶证"
    };
  }

  if (vehicleResolution.vehicle) {
    const { vehicle, models, organizations } = vehicleResolution;
    const choices = [models.length > 1 && "车型", organizations.length > 1 && "所属单位"].filter(Boolean);
    return {
      found: true,
      status: "found",
      vehicle: {
        ...publicVehicle(vehicle),
        model: models.length > 1 ? "" : models[0]?.name || vehicle.model,
        modelLegacyCode: models.length > 1 ? "" : models[0]?.code || vehicle.modelLegacyCode || "",
        organization: organizations.length > 1 ? undefined : organizations[0] || vehicle.organization
      },
      models,
      organizations,
      message: choices.length ? `请从该车的润丰档案中选择本次开单的${choices.join("和")}`
        : "已匹配到润丰车辆档案，车型和所属单位已锁定，如需更正请先更新润丰档案"
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

  const configured = configuredVehicleDatabase();
  const candidates = kind === "model"
    ? configured
      ? await findLegacyModelCandidates(normalizedQuery)
      : findMockReferences(mockModels, normalizedQuery)
    : configured
      ? await findLegacyOrganizationCandidates(normalizedQuery)
      : findMockReferences(mockOrganizations, normalizedQuery);
  return { kind, query, candidates };
}

export async function checkCompanyVehicleReferenceCode({ kind, code } = {}) {
  if (kind !== "model" && kind !== "organization") {
    throw new HttpError(400, "请选择车型或所属单位编码类型");
  }
  const maxLength = kind === "model" ? 10 : 50;
  const normalizedCode = normalizeNewReferenceCode(code, maxLength);
  const configured = configuredVehicleDatabase();
  const references = kind === "model" ? mockModels : mockOrganizations;
  const existing = configured
    ? await findLegacyReferenceByCode(kind, normalizedCode)
    : references.find((item) => item.code.toUpperCase() === normalizedCode.toUpperCase());
  return {
    kind,
    code: normalizedCode,
    available: !existing,
    ...(existing ? { existing } : {})
  };
}

export async function createCompanyVehicleReference({ kind, name, code } = {}, createReference = createLegacyVehicleReference) {
  if (kind !== "model" && kind !== "organization") {
    throw new HttpError(400, "请选择车型或所属单位类型");
  }
  const normalizedName = typeof name === "string" ? name.normalize("NFKC").trim() : "";
  if (!normalizedName) throw new HttpError(400, `${kind === "model" ? "车型" : "所属单位"}名称不能为空`);
  if (normalizedName.length > (kind === "model" ? 100 : 150)) {
    throw new HttpError(400, `${kind === "model" ? "车型" : "所属单位"}名称过长`);
  }
  const nameError = legacyReferenceNameError(kind, normalizedName);
  if (nameError) throw new HttpError(400, nameError);
  const normalizedCode = normalizeNewReferenceCode(code, kind === "model" ? 10 : 50);
  const result = await createReference({ kind, name: normalizedName, code: normalizedCode });
  if (!result.created && normalizeReference(result.value) !== normalizeReference(normalizedName)) {
    throw new HttpError(409, `编码已被“${result.value || "其他记录"}”使用，请修改编码`);
  }
  return { kind, ...result };
}

function plateSearchKey(plate) {
  return normalizeIdentifier(plate).replace(/[·•.－—–]/g, "");
}

export function resolveVehicleCandidates(candidates, normalizedPlate, normalizedVin, confirmedPlate) {
  const vinRows = normalizedVin ? candidates.filter(row => normalizeIdentifier(row.vin) === normalizedVin) : [];
  const keys = new Set(normalizedPlate && candidates.some(row => plateSearchKey(row.plate) === normalizedPlate)
    ? [normalizedPlate] : vinRows.map(row => plateSearchKey(row.plate)));
  const plateChoices = [...new Set(candidates.filter(row => keys.has(plateSearchKey(row.plate))).map(row => row.plate).filter(Boolean))];
  if (confirmedPlate !== undefined || plateChoices.length > 1) {
    if (!plateChoices.includes(confirmedPlate)) {
      return { status: "conflict", plateChoices, message: "请选择润丰档案中的车牌原文" };
    }
    candidates = candidates.filter(row => row.plate === confirmedPlate);
    if (normalizedVin && candidates.some(row => normalizeIdentifier(row.vin)) &&
        !candidates.some(row => normalizeIdentifier(row.vin) === normalizedVin)) {
      return { status: "conflict", plateChoices, message: "所选车牌与当前 VIN 不符，请核对车牌或 VIN" };
    }
    normalizedPlate = plateSearchKey(confirmedPlate);
    candidates = candidates.map(row => ({ ...row, plateMatched: true }));
  }
  const plateMatch = normalizedPlate ? candidates.find((item) => item.plateMatched ?? plateSearchKey(item.plate) === normalizedPlate) : undefined;
  const vinMatch = normalizedVin ? candidates.find((item) => item.vinMatched ?? normalizeIdentifier(item.vin) === normalizedVin) : undefined;
  const exact = normalizedPlate && normalizedVin && candidates.find(row =>
    plateSearchKey(row.plate) === normalizedPlate && normalizeIdentifier(row.vin) === normalizedVin);
  const plateVins = new Set(candidates.filter(row => plateSearchKey(row.plate) === normalizedPlate)
    .map(row => normalizeIdentifier(row.vin)).filter(Boolean));
  if (!exact && plateMatch && (vinMatch || plateVins.size > 1)) {
    return {
      status: "conflict",
      message: vinMatch ? undefined : "该车牌对应多个 VIN，请核对并输入 VIN",
      conflicts: [
        { identifier: "plate", plate: plateMatch.plate, vin: plateMatch.vin },
        ...(vinMatch ? [{ identifier: "vin", plate: vinMatch.plate, vin: vinMatch.vin }] : [])
      ]
    };
  }
  const vehicle = exact || vinMatch || plateMatch;
  if (!vehicle) return { status: "new" };
  const vin = normalizeIdentifier(vehicle.vin) || [...plateVins][0];
  const organizations = new Map();
  const models = new Map();
  for (const row of candidates) {
    const rowVin = normalizeIdentifier(row.vin);
    const sameVehicle = rowVin ? rowVin === vin : plateSearchKey(row.plate) === plateSearchKey(vehicle.plate) && plateVins.size <= 1;
    if (!sameVehicle) continue;
    const modelCode = row.modelLegacyCode?.trim();
    if (modelCode && !models.has(modelCode.toUpperCase())) {
      models.set(modelCode.toUpperCase(), { code: modelCode, name: row.model });
    }
    const code = row.organization?.code?.trim().toUpperCase();
    if (code && !organizations.has(code)) organizations.set(code, row.organization);
  }
  return { status: "found", vehicle, models: [...models.values()], organizations: [...organizations.values()] };
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
  return mockVehicles
    .filter((item) =>
      (normalizedPlate && plateSearchKey(item.plate) === normalizedPlate) ||
      (normalizedVin && normalizeIdentifier(item.vin) === normalizedVin)
    )
    .map((item) => ({
      ...item,
      plateMatched: Boolean(normalizedPlate && plateSearchKey(item.plate) === normalizedPlate),
      vinMatched: Boolean(normalizedVin && normalizeIdentifier(item.vin) === normalizedVin)
    }));
}

function configuredVehicleDatabase() {
  const configured = hasSqlServerConfig();
  if (!configured && process.env.APP_ENV === "production") {
    throw new HttpError(503, "公司车辆数据库未配置");
  }
  return configured;
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

export function normalizeNewReferenceCode(value, maxLength) {
  const code = typeof value === "string" ? value.normalize("NFKC").trim() : "";
  if (!code) throw new HttpError(400, "编码不能为空");
  if (!/^[A-Za-z0-9]+$/.test(code)) throw new HttpError(400, "编码只能包含英文字母和数字");
  if (code.length > maxLength) throw new HttpError(400, `编码最多 ${maxLength} 个字符`);
  return code;
}
