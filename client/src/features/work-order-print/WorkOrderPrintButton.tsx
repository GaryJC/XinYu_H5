import { useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { Printer } from "lucide-react";
import type { WorkOrder } from "../../../../shared/types";
import { WorkOrderPrintDocument } from "./WorkOrderPrintDocument";
import { useWorkOrderPrint } from "./useWorkOrderPrint";
import { fitSinglePage, printDocument } from "./printDocument";
import printStyles from "./work-order-print.css?inline";

export function WorkOrderPrintButton({ order }: { order: WorkOrder }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [arrivalDate, setArrivalDate] = useState("");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate);

  function openSettings() {
    setArrivalDate(order.arrivalDate?.slice(0, 10) || "");
    setSettingsOpen(true);
  }

  return <>
    <Button icon={<Printer size={16}/>} onClick={openSettings}>打印委托单</Button>
    <Modal open={settingsOpen} title="打印设置" okText="生成打印预览" cancelText="取消"
      onCancel={() => setSettingsOpen(false)} okButtonProps={{disabled:!validDate}}
      onOk={() => { setSettingsOpen(false); setOpen(true); }}>
      <label htmlFor={`print-arrival-${order.id}`}>进厂日期</label>
      <Input id={`print-arrival-${order.id}`} aria-label="打印进厂日期" type="date" value={arrivalDate}
        onChange={event => setArrivalDate(event.target.value)} style={{marginTop:8}}/>
      <p style={{color:"#657085",fontSize:13}}>仅用于本次打印，不修改已保存的委托单。</p>
    </Modal>
    {open && <PrintPreview key={order.id} order={order} arrivalDate={arrivalDate} onClose={() => setOpen(false)}/>}
  </>;
}

function PrintPreview({ order, arrivalDate, onClose }: { order: WorkOrder; arrivalDate: string; onClose: () => void }) {
  const { source, loading, error, retry } = useWorkOrderPrint(order);
  const [previewReady, setPreviewReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const documentRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const preview = documentRef.current;
    const paper = preview?.querySelector<HTMLElement>(".work-order-print");
    const page = preview?.querySelector<HTMLElement>(".wop-print-page");
    if (!preview || !paper || !page) return;
    function resize() {
      if (!preview || !paper || !page) return;
      fitSinglePage(paper, page);
      const width = Math.max(0, preview.clientWidth - 32);
      preview.style.setProperty("--wop-preview-scale", String(Math.min(1, width / page.offsetWidth)));
      preview.style.setProperty("--wop-page-height", `${page.offsetHeight}px`);
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
    <Spin spinning={loading} description="正在加载客户签名"><div ref={documentRef} className="work-order-print-preview"><div className="wop-print-sheet"><main className="wop-print-page"><WorkOrderPrintDocument order={order} signatureSource={source} arrivalDate={arrivalDate}/></main></div></div></Spin>
  </Modal>;
}
