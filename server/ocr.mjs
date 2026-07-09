import { Readable } from "node:stream";
import * as OpenApiClient from "@alicloud/openapi-client";
import * as OcrApi from "@alicloud/ocr-api20210707";
import { RuntimeOptions } from "@darabonba/typescript";
import { HttpError } from "./db.mjs";

const DEFAULT_ALIYUN_OCR_ENDPOINT = "ocr-api.cn-hangzhou.aliyuncs.com";

let aliyunClient;

export async function recognizeVehicleLicense(imageBase64) {
  if (!imageBase64 || typeof imageBase64 !== "string") {
    throw new HttpError(400, "请上传行驶证照片");
  }

  const provider = process.env.OCR_PROVIDER || "aliyun";
  if (provider !== "aliyun") {
    throw new HttpError(400, `当前只支持阿里云 OCR，请将 OCR_PROVIDER 配置为 aliyun`);
  }

  return recognizeVehicleLicenseWithAliyun(stripDataUrlPrefix(imageBase64));
}

async function recognizeVehicleLicenseWithAliyun(imageBase64) {
  const image = Buffer.from(imageBase64, "base64");
  if (!image.length) throw new HttpError(400, "行驶证照片内容为空");

  const request = new OcrApi.RecognizeVehicleLicenseRequest({
    body: Readable.from(image)
  });

  let response;
  try {
    response = await getAliyunClient().recognizeVehicleLicenseWithOptions(request, new RuntimeOptions({
      connectTimeout: Number(process.env.ALIYUN_OCR_CONNECT_TIMEOUT_MS || 10000),
      readTimeout: Number(process.env.ALIYUN_OCR_READ_TIMEOUT_MS || 30000)
    }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, `阿里云行驶证识别失败：${formatSdkError(error)}`);
  }

  const body = response?.body;
  if (!body || (body.code && body.code !== "200")) {
    throw new HttpError(502, `阿里云行驶证识别失败：${body?.message || body?.code || "无返回内容"}`);
  }

  return normalizeAliyunVehicleLicense(body.data);
}

function getAliyunClient() {
  if (aliyunClient) return aliyunClient;

  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new HttpError(500, "未配置 ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET");
  }

  const Client = OcrApi.default.default;
  aliyunClient = new Client(new OpenApiClient.Config({
    accessKeyId,
    accessKeySecret,
    endpoint: process.env.ALIYUN_OCR_ENDPOINT || DEFAULT_ALIYUN_OCR_ENDPOINT
  }));
  return aliyunClient;
}

function normalizeAliyunVehicleLicense(data) {
  const parsed = parseAliyunData(data);
  const flat = flattenValues(parsed);
  return {
    plate: pickValue(flat, ["plateNumber", "plateNo", "licensePlateNumber", "number", "号牌号码"]),
    vehicleType: pickValue(flat, ["vehicleType", "type", "车辆类型"]),
    owner: pickValue(flat, ["owner", "所有人"]),
    address: pickValue(flat, ["address", "住址", "地址"]),
    useCharacter: pickValue(flat, ["useCharacter", "useNature", "使用性质"]),
    model: pickValue(flat, ["model", "brandModel", "vehicleModel", "品牌型号"]),
    vin: pickValue(flat, ["vin", "vinCode", "vehicleIdentificationCode", "vehicleIdentifyCode", "车辆识别代号", "车辆识别代码", "车架号"]),
    engineNo: pickValue(flat, ["engineNo", "engineNumber", "发动机号码", "发动机号"]),
    registerDate: pickValue(flat, ["registerDate", "registrationDate", "注册日期"]),
    issueDate: pickValue(flat, ["issueDate", "发证日期"]),
    confidence: confidence(flat)
  };
}

function parseAliyunData(data) {
  if (!data) return {};
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return { rawText: data };
  }
}

function flattenValues(value, prefix = "", result = {}) {
  if (value == null) return result;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenValues(item, `${prefix}.${index}`, result));
    return result;
  }
  if (typeof value !== "object") {
    if (prefix) result[prefix] = String(value);
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (isValueObject(child)) {
      result[key] = String(child.value ?? child.text ?? child.words ?? child.content ?? "").trim();
      result[nextPrefix] = result[key];
      if (child.score != null || child.probability != null || child.confidence != null) {
        result[`${nextPrefix}.__confidence`] = Number(child.score ?? child.probability ?? child.confidence);
      }
    } else {
      flattenValues(child, nextPrefix, result);
      if (typeof child !== "object" || child == null) result[key] = String(child ?? "").trim();
    }
  }
  return result;
}

function isValueObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      ("value" in value || "text" in value || "words" in value || "content" in value)
  );
}

function pickValue(flat, keys) {
  for (const key of keys) {
    const direct = flat[key];
    if (direct) return String(direct).trim();
    const suffixKey = Object.keys(flat).find((candidate) => candidate.toLowerCase().endsWith(`.${key.toLowerCase()}`));
    if (suffixKey && flat[suffixKey]) return String(flat[suffixKey]).trim();
  }
  return "";
}

function confidence(flat) {
  const values = Object.entries(flat)
    .filter(([key]) => key.endsWith(".__confidence"))
    .map(([, value]) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function stripDataUrlPrefix(value) {
  const index = value.indexOf(",");
  return value.startsWith("data:") && index >= 0 ? value.slice(index + 1) : value;
}

function formatSdkError(error) {
  if (!error || typeof error !== "object") return String(error || "未知错误");
  return error.message || error.description || error.code || "未知错误";
}
