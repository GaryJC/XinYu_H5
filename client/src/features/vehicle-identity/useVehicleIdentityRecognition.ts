import { type Dispatch, type SetStateAction, useState } from "react";
import {
  VehicleHistoryLookupResult,
  VehicleLicenseOcrResult,
  VehicleLookupInput,
  VehicleReferenceCandidate,
  WorkOrderDraft
} from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { fileToBase64 } from "../vehicle-license-ocr/ocrUtils";

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

  function resetVehicleIdentityRecognition() {
    setIdentifierRecognition(initialRecognitionState);
    setVehicleHistory(undefined);
    setVehicleHistoryLoading(false);
    setVehicleHistoryError("");
  }

  async function scanVehicleIdentifier(kind: IdentifierKind, file: File) {
    setIdentifierRecognition((current) => ({
      ...current,
      [kind]: { status: "识别中", value: "" }
    }));
    setVehicleHistory(undefined);
    setVehicleHistoryError("");

    let value: string;
    try {
      const imageBase64 = await fileToBase64(file);
      const result = kind === "plate"
        ? await workOrderApi.recognizeLicensePlate(imageBase64)
        : await workOrderApi.recognizeVin(imageBase64);
      value = result.value.trim().toUpperCase();
      setIdentifierRecognition((current) => ({
        ...current,
        [kind]: { status: "已识别", value }
      }));
      setDraft((current) => ({
        ...current,
        vehicle: { ...current.vehicle, [kind]: value }
      }));
    } catch (error) {
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

    await lookupVehicleIdentifier(kind, value);
  }

  async function lookupVehicleIdentifier(kind: IdentifierKind, rawValue: string) {
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
    await runVehicleLookup({ [kind]: value });
  }

  async function lookupVehicleLicense(result: VehicleLicenseOcrResult) {
    const plate = normalizeIdentifier(result.plate);
    const vin = normalizeIdentifier(result.vin);
    setIdentifierRecognition((current) => ({
      plate: plate ? { status: "已识别", value: plate } : current.plate,
      vin: vin ? { status: "已识别", value: vin } : current.vin
    }));
    await runVehicleLookup({ plate, vin, model: result.model, owner: result.owner });
  }

  async function lookupVehicleLicenseForDevelopment(input: VehicleLookupInput) {
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
        model: input.model?.trim() || current.vehicle.model
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
    await runVehicleLookup({ plate, vin, model: input.model, owner: input.owner });
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

  async function runVehicleLookup(input: VehicleLookupInput) {
    setVehicleHistory(undefined);
    setVehicleHistoryError("");
    setVehicleHistoryLoading(true);
    try {
      const history = await workOrderApi.lookupVehicle(input);
      setVehicleHistory(history);
      if (history.status !== "conflict") setDraft((current) => applyVehicleLookup(current, history));
    } catch (error) {
      setVehicleHistoryError(error instanceof Error ? error.message : "公司系统车辆查询失败");
    } finally {
      setVehicleHistoryLoading(false);
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

function applyVehicleLookup(draft: WorkOrderDraft, history: VehicleHistoryLookupResult) {
  if (history.found && history.vehicle) {
    const organizationName = history.vehicle.organization?.name || "";
    return {
      ...draft,
      vehicle: {
        ...draft.vehicle,
        plate: history.vehicle.plate || draft.vehicle.plate,
        vin: history.vehicle.vin || draft.vehicle.vin,
        model: history.vehicle.model || draft.vehicle.model
      },
      customer: organizationName
        ? {
            ...draft.customer,
            name: organizationName,
            legacyCode: history.vehicle.organization?.code || "",
            contact: organizationName
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
    return { ...draft, vehicle: { ...draft.vehicle, model: candidate.value } };
  }
  return {
    ...draft,
    customer: {
      ...draft.customer,
      name: candidate.value,
      legacyCode: candidate.code || "",
      contact: candidate.value
    }
  };
}

function normalizeIdentifier(value: string) {
  return value.trim().replace(/[\s-]/g, "").toUpperCase();
}
