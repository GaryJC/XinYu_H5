import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { capturePrintTypography, freezePrintTypography, markPrintCaptureNodes } from "./freezePrintTypography";
import { fitSinglePage, preparePrintDocument } from "./printDocument";

export async function createPrintPdf(element: HTMLElement, styles: string, title: string): Promise<Blob> {
  markPrintCaptureNodes(element);
  const typography = capturePrintTypography(element);
  const { frame, page, doc } = await preparePrintDocument(element, styles, title);
  try {
    // Keep the canvas below four megapixels for mobile WebView memory limits.
    await freezePrintTypography(element, page, doc, typography);
    const paper = page.querySelector<HTMLElement>(".work-order-print");
    if (!paper) throw new Error("无法读取打印内容，请重试。");
    fitSinglePage(paper, page);
    const canvas = await html2canvas(page, {
      scale: 2,
      backgroundColor: "#ffffff",
      windowWidth: 794,
      windowHeight: 1123,
      scrollX: 0,
      scrollY: 0,
      useCORS: true,
      logging: false,
      onclone: async (document, clonedPage) => {
        // html2canvas creates another iframe. Keep that second layout's text
        // metrics identical to the prepared print page, including on iOS.
        await freezePrintTypography(element, clonedPage, document, typography);
      }
    });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    pdf.setProperties({ title });
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 0, 0, 210, 296);
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}
