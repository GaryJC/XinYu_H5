import { type Dispatch, type SetStateAction, useState } from "react";
import { VehicleHistoryLookupResult, WorkOrderDraft } from "../../../../shared/types";
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

    setVehicleHistoryLoading(true);
    try {
      const history = await workOrderApi.lookupVehicle({ [kind]: value });
      setVehicleHistory(history);
      if (history.found && history.vehicle) {
        setDraft((current) => ({
          ...current,
          vehicle: {
            ...current.vehicle,
            plate: history.vehicle!.plate || current.vehicle.plate,
            vin: history.vehicle!.vin || current.vehicle.vin,
            model: history.vehicle!.model || current.vehicle.model
          }
        }));
      }
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
    scanVehicleIdentifier
  };
}
