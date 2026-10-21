import { Modal } from "antd";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { OcrFieldKey, OcrFieldState, OcrRecord, VehicleLicenseOcrResult, WorkOrderDraft } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";
import { formatVehicleLicenseSummary, normalizeOcrDate } from "./ocrUtils";
import { prepareOcrImage } from "../../shared/images/prepareOcrImage";

const initialOcrState: Record<OcrFieldKey, OcrFieldState> = {
  vehicleLicense: { source: "行驶证照片", status: "未识别", value: "" }
};

type Options = {
  actor: string;
  draft: WorkOrderDraft;
  setDraft: Dispatch<SetStateAction<WorkOrderDraft>>;
  onRecognized?: (result: VehicleLicenseOcrResult) => Promise<void>;
};

export function useVehicleLicenseOcr({ actor, draft, setDraft, onRecognized }: Options) {
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const generation = useRef(0);
  const scanning = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  const [ocrState, setOcrState] = useState(initialOcrState);
  const [ocrRecordIds, setOcrRecordIds] = useState<Partial<Record<OcrFieldKey, string>>>({});
  const [vehicleLicenseOcr, setVehicleLicenseOcr] = useState<VehicleLicenseOcrResult>();
  const [vehicleLicenseFileId, setVehicleLicenseFileId] = useState<string>();

  function resetOcr(records: OcrRecord[] = [], savedFileId?: string) {
    generation.current++;
    scanning.current = false;
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
    setVehicleLicenseFileId(savedFileId || record?.fileId);
  }

  async function scanVehicleLicense(file: File) {
    if (scanning.current) return;
    scanning.current = true;
    const session = generation.current;
    setOcrState((current) => ({
      ...current,
      vehicleLicense: { ...current.vehicleLicense, status: "识别中", error: undefined }
    }));
    setVehicleLicenseOcr(undefined);

    try {
      const image = await prepareOcrImage(file);
      if (session !== generation.current) return;
      const uploadedFile = await workOrderApi.uploadFile({
        kind: "vehicle_license",
        ...image
      });
      if (session !== generation.current) return;
      setVehicleLicenseFileId(uploadedFile.id);
      setDraft(current => ({...current, inspection:{...current.inspection,vehicleLicenseFileId:uploadedFile.id}}));
      const recognized = await workOrderApi.recognizeVehicleLicense({ fileId: uploadedFile.id });
      if (session !== generation.current) return;
      const result = { ...recognized };
      const normalize = (value:string) => value.replace(/\s/g, '').toUpperCase();
      for (const key of ['plate','vin'] as const) {
        const existing = draftRef.current.vehicle[key];
        if (existing && result[key] && normalize(existing) !== normalize(result[key])) {
          const useRecognized = await new Promise<boolean>(resolve => Modal.confirm({
            title: `${key === 'plate' ? '车牌号码' : '车架号'}识别结果不一致，请核对`,
            content: `当前已录入：${existing}；行驶证识别：${result[key]}。照片模糊可能识别错误，请核对原件后选择。`,
            okText: '使用行驶证结果', cancelText: '保留已录入值', closable: false, mask: { closable: false },
            onOk: () => { resolve(true); }, onCancel: () => { resolve(false); }
          }));
          if (session !== generation.current) return;
          if (!useRecognized || draftRef.current.vehicle[key] !== existing) result[key] = draftRef.current.vehicle[key];
        }
      }
      if (session !== generation.current) return;
      const record = await workOrderApi.createOcrRecord(
        undefined,
        "vehicleLicense",
        initialOcrState.vehicleLicense.source,
        JSON.stringify(result),
        result.confidence,
        uploadedFile.id
      );

      if (session !== generation.current) return;
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
          modelLegacyCode: result.model ? "" : current.vehicle.modelLegacyCode,
          purchaseDate: normalizeOcrDate(result.registerDate) || current.vehicle.purchaseDate
        },
        customer: {
          ...current.customer,
          name: result.owner || current.customer.name,
          legacyCode: "",
          contact: result.owner || current.customer.contact,
          address: result.address || current.customer.address
        }
      }));
      await onRecognized?.(result);
    } catch (error) {
      if (session !== generation.current) return;
      setOcrState((current) => ({
        ...current,
        vehicleLicense: {
          ...current.vehicleLicense,
          status: "未识别",
          value: "",
          error: error instanceof Error ? error.message : "行驶证识别失败"
        }
      }));
    } finally {
      if (session === generation.current) scanning.current = false;
    }
  }

  async function confirmVehicleLicenseOcr() {
    const session = generation.current;
    const recordId = ocrRecordIds.vehicleLicense;
    const value = vehicleLicenseOcr ? JSON.stringify(vehicleLicenseOcr) : ocrState.vehicleLicense.value;
    if (!recordId) return;
    try {
      await workOrderApi.confirmOcrRecord(recordId, value, actor);
      if (session !== generation.current) return;
      setOcrState((current) => ({
        ...current,
        vehicleLicense: { ...current.vehicleLicense, status: "已确认", error: undefined }
      }));
    } catch (error) {
      if (session !== generation.current) return;
      setOcrState((current) => ({
        ...current,
        vehicleLicense: { ...current.vehicleLicense, error: error instanceof Error ? error.message : "确认 OCR 结果失败" }
      }));
    }
  }

  return {
    ocrState,
    isUploading: () => scanning.current,
    vehicleLicenseOcr,
    vehicleLicenseFileId,
    resetOcr,
    scanVehicleLicense,
    confirmVehicleLicenseOcr
  };
}
