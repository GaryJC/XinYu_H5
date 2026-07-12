import { type Dispatch, type SetStateAction, useState } from "react";
import { OcrFieldKey, OcrFieldState, OcrRecord, VehicleLicenseOcrResult, WorkOrderDraft } from "../../../../shared/types";
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
  const [vehicleLicenseFileId, setVehicleLicenseFileId] = useState<string>();

  function resetOcr(records: OcrRecord[] = []) {
    const record = records.find((item) => item.field === "vehicleLicense");
    let parsed: VehicleLicenseOcrResult | undefined;
    if (record?.value) {
      try {
        parsed = JSON.parse(record.value) as VehicleLicenseOcrResult;
      } catch {
        parsed = undefined;
      }
    }
    setOcrState(record ? {
      vehicleLicense: {
        source: "行驶证照片",
        status: record.status === "已确认" ? "已确认" : record.status === "待确认" ? "待确认" : "未识别",
        value: parsed ? formatVehicleLicenseSummary(parsed) : record.value,
        error: record.error
      }
    } : initialOcrState);
    setOcrRecordIds(record ? { vehicleLicense: record.id } : {});
    setVehicleLicenseOcr(parsed);
    setVehicleLicenseFileId(record?.fileId);
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
      setVehicleLicenseFileId(uploadedFile.id);
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

  async function confirmVehicleLicenseOcr() {
    const recordId = ocrRecordIds.vehicleLicense;
    const value = vehicleLicenseOcr ? JSON.stringify(vehicleLicenseOcr) : ocrState.vehicleLicense.value;
    if (!recordId) return;
    try {
      await workOrderApi.confirmOcrRecord(recordId, value, actor);
      setOcrState((current) => ({
        ...current,
        vehicleLicense: { ...current.vehicleLicense, status: "已确认", error: undefined }
      }));
    } catch (error) {
      setOcrState((current) => ({
        ...current,
        vehicleLicense: { ...current.vehicleLicense, error: error instanceof Error ? error.message : "确认 OCR 结果失败" }
      }));
    }
  }

  return {
    ocrState,
    vehicleLicenseOcr,
    vehicleLicenseFileId,
    resetOcr,
    scanVehicleLicense,
    confirmVehicleLicenseOcr
  };
}
