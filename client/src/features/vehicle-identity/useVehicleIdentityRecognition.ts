import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import {
  VehicleHistoryLookupResult,
  VehicleLicenseOcrResult,
  VehicleLookupInput,
  VehicleReferenceCandidate,
  WorkOrderDraft
} from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { prepareOcrImage } from "../../shared/images/prepareOcrImage";

export type IdentifierKind = "plate" | "vin";
export type IdentifierRecognitionState = {
  status: "未识别" | "识别中" | "已识别" | "识别失败";
  value: string;
  error?: string;
};

const initialRecognitionState: Record<IdentifierKind, IdentifierRecognitionState> = {
  plate: { status: "未识别", value: "" },
  vin: { status: "未识别", value: "" }
};

type Options = {
  setDraft: Dispatch<SetStateAction<WorkOrderDraft>>;
};

export function useVehicleIdentityRecognition({ setDraft }: Options) {
  const [identifierRecognition, setIdentifierRecognition] = useState(initialRecognitionState);
  const [vehicleHistory, setVehicleHistory] = useState<VehicleHistoryLookupResult>();
  const [vehicleHistoryLoading, setVehicleHistoryLoading] = useState(false);
  const [vehicleHistoryError, setVehicleHistoryError] = useState("");

  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);

  function beginRequest() {
    const current = ++generation.current;
    setVehicleHistoryLoading(false);
    setIdentifierRecognition(previous => ({
      plate: previous.plate.status === "识别中" ? initialRecognitionState.plate : previous.plate,
      vin: previous.vin.status === "识别中" ? initialRecognitionState.vin : previous.vin
    }));
    return current;
  }

  function resetVehicleIdentityRecognition() {
    generation.current += 1;
    setIdentifierRecognition(initialRecognitionState);
    setVehicleHistory(undefined);
    setVehicleHistoryLoading(false);
    setVehicleHistoryError("");
  }

  async function scanVehicleIdentifier(kind: IdentifierKind, file: File) {
    const current = beginRequest();
    setIdentifierRecognition((current) => ({
      ...current,
      [kind]: { status: "识别中", value: "" }
    }));
    setVehicleHistory(undefined);
    setVehicleHistoryError("");

    let value: string;
    try {
      const { imageBase64 } = await prepareOcrImage(file);
      if (current !== generation.current) return;
      const result = kind === "plate"
        ? await workOrderApi.recognizeLicensePlate(imageBase64)
        : await workOrderApi.recognizeVin(imageBase64);
      if (current !== generation.current) return;
      value = normalizeIdentifier(result.value);
      setIdentifierRecognition((current) => ({
        ...current,
        [kind]: { status: "已识别", value }
      }));
      setDraft((current) => ({
        ...current,
        vehicle: { ...current.vehicle, [kind]: value }
      }));
    } catch (error) {
      if (current !== generation.current) return;
      setIdentifierRecognition((current) => ({
        ...current,
        [kind]: {
          status: "识别失败",
          value: "",
          error: error instanceof Error ? error.message : `${kind === "plate" ? "车牌" : "VIN"}识别失败`
        }
      }));
      return;
    }

    await runVehicleLookup({ [kind]: value }, current);
  }

  async function lookupVehicleIdentifier(kind: IdentifierKind, rawValue: string) {
    const current = beginRequest();
    const value = normalizeIdentifier(rawValue);
    if (!value) {
      setVehicleHistory(undefined);
      setVehicleHistoryError(`请输入${kind === "plate" ? "车牌号码" : "VIN 码"}`);
      return;
    }

    setIdentifierRecognition((current) => ({
      ...current,
      [kind]: { status: "已识别", value }
    }));
    setDraft((current) => ({
      ...current,
      vehicle: { ...current.vehicle, [kind]: value }
    }));
    await runVehicleLookup({ [kind]: value }, current);
  }

  async function lookupVehicleLicense(result: VehicleLicenseOcrResult) {
    const current = beginRequest();
    const plate = normalizeIdentifier(result.plate);
    const vin = normalizeIdentifier(result.vin);
    setIdentifierRecognition((current) => ({
      plate: plate ? { status: "已识别", value: plate } : current.plate,
      vin: vin ? { status: "已识别", value: vin } : current.vin
    }));
    await runVehicleLookup({ plate, vin, model: result.model, owner: result.owner }, current);
  }

  async function lookupVehicleLicenseForDevelopment(input: VehicleLookupInput) {
    const current = beginRequest();
    const plate = normalizeIdentifier(input.plate || "");
    const vin = normalizeIdentifier(input.vin || "");
    setIdentifierRecognition((current) => ({
      plate: plate ? { status: "已识别", value: plate } : current.plate,
      vin: vin ? { status: "已识别", value: vin } : current.vin
    }));
    setDraft((current) => ({
      ...current,
      vehicle: {
        ...current.vehicle,
        plate: plate || current.vehicle.plate,
        vin: vin || current.vehicle.vin,
        model: input.model?.trim() || current.vehicle.model,
        modelLegacyCode: input.model?.trim() ? "" : current.vehicle.modelLegacyCode
      },
      customer: input.owner?.trim()
        ? {
            ...current.customer,
            name: input.owner.trim(),
            legacyCode: "",
            contact: input.owner.trim()
          }
        : current.customer
    }));
    await runVehicleLookup({ plate, vin, model: input.model, owner: input.owner }, current);
  }

  function selectVehicleReference(kind: "model" | "organization", candidate: VehicleReferenceCandidate) {
    setDraft((current) => applyReferenceCandidate(current, kind, candidate));
    setVehicleHistory((current) => {
      if (!current?.references?.[kind]) return current;
      return {
        ...current,
        references: {
          ...current.references,
          [kind]: {
            ...current.references[kind],
            status: "matched",
            selected: candidate
          }
        }
      };
    });
  }

  async function runVehicleLookup(input: VehicleLookupInput, current: number) {
    setVehicleHistory(undefined);
    setVehicleHistoryError("");
    setVehicleHistoryLoading(true);
    try {
      const history = await workOrderApi.lookupVehicle(input);
      if (current !== generation.current) return;
      setVehicleHistory(history);
      if (history.status !== "conflict") setDraft((current) => applyVehicleLookup(current, history));
    } catch (error) {
      if (current === generation.current) setVehicleHistoryError(error instanceof Error ? error.message : "公司系统车辆查询失败");
    } finally {
      if (current === generation.current) setVehicleHistoryLoading(false);
    }
  }

  return {
    identifierRecognition,
    vehicleHistory,
    vehicleHistoryLoading,
    vehicleHistoryError,
    resetVehicleIdentityRecognition,
    scanVehicleIdentifier,
    lookupVehicleIdentifier,
    lookupVehicleLicense,
    lookupVehicleLicenseForDevelopment,
    selectVehicleReference
  };
}

export function applyVehicleLookup(draft: WorkOrderDraft, history: VehicleHistoryLookupResult) {
  if (history.found && history.vehicle) {
    const organizationName = history.vehicle.organization?.name?.trim() || "";
    const model = history.vehicle.model?.trim() || "";
    return {
      ...draft,
      vehicle: {
        ...draft.vehicle,
        plate: history.vehicle.plate || draft.vehicle.plate,
        vin: history.vehicle.vin || draft.vehicle.vin,
        model: model || draft.vehicle.model,
        modelLegacyCode: model ? history.vehicle.modelLegacyCode || "" : draft.vehicle.modelLegacyCode || ""
      },
      customer: organizationName
        ? {
            ...draft.customer,
            name: organizationName,
            legacyCode: history.vehicle.organization?.code || "",
            contact: draft.customer.contact || organizationName
          }
        : draft.customer
    };
  }

  let next = draft;
  const model = history.references?.model?.selected;
  const organization = history.references?.organization?.selected;
  if (model) next = applyReferenceCandidate(next, "model", model);
  if (organization) next = applyReferenceCandidate(next, "organization", organization);
  return next;
}

function applyReferenceCandidate(draft: WorkOrderDraft, kind: "model" | "organization", candidate: VehicleReferenceCandidate) {
  if (kind === "model") {
    return {
      ...draft,
      vehicle: {
        ...draft.vehicle,
        model: candidate.value,
        modelLegacyCode: candidate.code || ""
      }
    };
  }
  return {
    ...draft,
    customer: {
      ...draft.customer,
      name: candidate.value,
      legacyCode: candidate.code || "",
      contact: draft.customer.contact || candidate.value
    }
  };
}

function normalizeIdentifier(value: string) {
  return value.trim().replace(/[\s-]/g, "").toUpperCase();
}
