import { type Dispatch, type SetStateAction, useState } from "react";
import { OcrFieldKey, OcrFieldState, VehicleLicenseOcrResult, WorkOrderDraft } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { fileToBase64, formatVehicleLicenseSummary, normalizeOcrDate } from "./ocrUtils";

const initialOcrState: Record<OcrFieldKey, OcrFieldState> = {
  vehicleLicense: { source: "行驶证照片", status: "未识别", value: "" }
};

type Options = {
  orderId?: string;
  actor: string;
  setDraft: Dispatch<SetStateAction<WorkOrderDraft>>;
};

export function useVehicleLicenseOcr({ orderId, actor, setDraft }: Options) {
  const [ocrState, setOcrState] = useState(initialOcrState);
  const [ocrRecordIds, setOcrRecordIds] = useState<Partial<Record<OcrFieldKey, string>>>({});
  const [vehicleLicenseOcr, setVehicleLicenseOcr] = useState<VehicleLicenseOcrResult>();

  function resetOcr() {
    setOcrState(initialOcrState);
    setOcrRecordIds({});
    setVehicleLicenseOcr(undefined);
  }

  async function scanVehicleLicense(file: File) {
    setOcrState((current) => ({
      ...current,
      vehicleLicense: { ...current.vehicleLicense, status: "识别中", error: undefined }
    }));
    setVehicleLicenseOcr(undefined);

    try {
      const imageBase64 = await fileToBase64(file);
      const uploadedFile = await workOrderApi.uploadFile({
        orderId,
        kind: "vehicle_license",
        fileName: file.name || "vehicle-license.jpg",
        mimeType: file.type || "image/jpeg",
        imageBase64
      });
      const result = await workOrderApi.recognizeVehicleLicense(imageBase64);
      const record = await workOrderApi.createOcrRecord(
        orderId,
        "vehicleLicense",
        initialOcrState.vehicleLicense.source,
        JSON.stringify(result),
        result.confidence,
        uploadedFile.id
      );

      setOcrRecordIds((current) => ({ ...current, vehicleLicense: record.id }));
      setVehicleLicenseOcr(result);
      setOcrState((current) => ({
        ...current,
        vehicleLicense: {
          ...current.vehicleLicense,
          status: "待确认",
          value: formatVehicleLicenseSummary(result)
        }
      }));
      setDraft((current) => ({
        ...current,
        vehicle: {
          ...current.vehicle,
          plate: result.plate || current.vehicle.plate,
          vin: result.vin || current.vehicle.vin,
          model: result.model || current.vehicle.model,
          purchaseDate: normalizeOcrDate(result.registerDate) || current.vehicle.purchaseDate
        },
        customer: {
          ...current.customer,
          name: result.owner || current.customer.name,
          contact: result.owner || current.customer.contact,
          address: result.address || current.customer.address
        }
      }));
    } catch (error) {
      setOcrState((current) => ({
        ...current,
        vehicleLicense: {
          ...current.vehicleLicense,
          status: "未识别",
          value: "",
          error: error instanceof Error ? error.message : "行驶证识别失败"
        }
      }));
    }
  }

  function confirmVehicleLicenseOcr() {
    const recordId = ocrRecordIds.vehicleLicense;
    const value = vehicleLicenseOcr ? JSON.stringify(vehicleLicenseOcr) : ocrState.vehicleLicense.value;
    if (recordId) void workOrderApi.confirmOcrRecord(recordId, value, actor);
    setOcrState((current) => ({
      ...current,
      vehicleLicense: { ...current.vehicleLicense, status: "已确认" }
    }));
  }

  return {
    ocrState,
    vehicleLicenseOcr,
    resetOcr,
    scanVehicleLicense,
    confirmVehicleLicenseOcr
  };
}
