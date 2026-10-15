import { useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { Printer } from "lucide-react";
import type { WorkOrder } from "../../../../shared/types";
import { WorkOrderPrintDocument } from "./WorkOrderPrintDocument";
import { useWorkOrderPrint } from "./useWorkOrderPrint";
import { printDocument } from "./printDocument";
import printStyles from "./work-order-print.css?inline";

export function WorkOrderPrintButton({ order }: { order: WorkOrder }) {
  const [open, setOpen] = useState(false);
  return <><Button icon={<Printer size={16}/>} onClick={() => setOpen(true)}>打印委托单</Button>{open && <PrintPreview key={order.id} order={order} onClose={() => setOpen(false)}/>}</>;
}

function PrintPreview({ order, onClose }: { order: WorkOrder; onClose: () => void }) {
  const { source, loading, error, retry } = useWorkOrderPrint(order);
  const [previewReady, setPreviewReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const documentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const preview = documentRef.current;
    const paper = preview?.querySelector<HTMLElement>(".work-order-print");
    if (!preview || !paper) return;
    function resize() {
      if (!preview || !paper) return;
      const width = Math.max(0, preview.clientWidth - 32);
      preview.style.setProperty("--wop-preview-scale", String(Math.min(1, width / paper.offsetWidth)));
      preview.style.setProperty("--wop-page-height", `${paper.offsetHeight}px`);
    }
    resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(preview);
    observer?.observe(paper);
    window.addEventListener("resize", resize);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, [previewReady]);

  async function handlePrint() {
    const element = documentRef.current?.querySelector<HTMLElement>(".work-order-print");
    if (!element || loading || error) return;
    setPrinting(true);
    setPrintError("");
    try { await printDocument(element, printStyles, `${order.id}-机动车修理委托书`); }
    catch (reason) { setPrintError(reason instanceof Error ? reason.message : "打印失败，请在电脑浏览器重试。"); }
    finally { setPrinting(false); }
  }
  return <Modal open afterOpenChange={setPreviewReady} title="委托单打印预览" width={860} styles={{body:{maxHeight:"calc(100vh - 220px)",overflowY:"auto"}}} onCancel={onClose} footer={<><Button onClick={onClose}>关闭</Button><Button type="primary" icon={<Printer size={16}/>} onClick={handlePrint} loading={printing} disabled={loading || Boolean(error)}>打印 / 另存为 PDF</Button></>}>
    <style>{printStyles}</style>
    {error && <Alert type="error" showIcon title="签名加载失败，暂不能打印" description={error} action={<Button onClick={retry}>重试</Button>} style={{marginBottom:12}}/>}
    {printError && <Alert type="error" showIcon title={printError} style={{marginBottom:12}}/>}
    <Spin spinning={loading} description="正在加载客户签名"><div ref={documentRef} className="work-order-print-preview"><div className="wop-print-sheet"><WorkOrderPrintDocument order={order} signatureSource={source}/></div></div></Spin>
  </Modal>;
}
