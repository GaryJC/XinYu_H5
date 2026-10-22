import type { PrintPdfDownload, PrintPdfUpload } from "../../../../shared/types";
import { request } from "../../shared/api/httpClient";

export async function preparePdfDownload(orderId: string, file: File): Promise<PrintPdfDownload> {
  const pdfBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("无法读取 PDF，请重新生成。"));
    reader.readAsDataURL(file);
  });
  return request<PrintPdfDownload>(`/api/work-orders/${encodeURIComponent(orderId)}/print-pdf`, {
    method: "POST", body: { pdfBase64, fileName: file.name } satisfies PrintPdfUpload
  });
}
