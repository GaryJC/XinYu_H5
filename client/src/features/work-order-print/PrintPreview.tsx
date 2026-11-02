import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, Button, Modal, Spin } from "antd";
import { Printer } from "lucide-react";
import type { WorkOrder } from "../../../../shared/types";
import { WorkOrderPrintDocument } from "./WorkOrderPrintDocument";
import { usePrintPdf } from "./usePrintPdf";
import { useWorkOrderPrint } from "./useWorkOrderPrint";
import { fitSinglePage, printDocument } from "./printDocument";
import printStyles from "./work-order-print.css?inline";

export function PrintPreview({ order, arrivalDate, printSignature, onClose }: { order: WorkOrder; arrivalDate: string; printSignature: boolean; onClose: () => void }) {
  const { source, loading, error, retry } = useWorkOrderPrint(order, printSignature);
  const [previewReady, setPreviewReady] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState("");
  const documentRef = useRef<HTMLDivElement>(null);
  const pdf = usePrintPdf(order.id);
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || window.matchMedia("(pointer: coarse)").matches;
  const busy = printing || pdf.generating;
  async function handlePdf() {
    const element = documentRef.current?.querySelector<HTMLElement>(".work-order-print");
    if (!element || loading || error || busy) return;
    await pdf.generate(element, printStyles, `${order.id}-机动车修理委托书`);
  }
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

  useEffect(() => {
    if (!mobile || !previewReady || loading || error) return;
    const element = documentRef.current?.querySelector<HTMLElement>(".work-order-print");
    if (element) void pdf.generate(element, printStyles, `${order.id}-机动车修理委托书`);
  }, [mobile, previewReady, loading, error, source, order.id, arrivalDate, printSignature, pdf.generate]);

  async function handlePrint() {
    const element = documentRef.current?.querySelector<HTMLElement>(".work-order-print");
    if (!element || loading || error) return;
    setPrinting(true);
    setPrintError("");
    try { await printDocument(element, printStyles, `${order.id}-机动车修理委托书`); }
    catch (reason) { setPrintError(reason instanceof Error ? reason.message : "打印失败，请在电脑浏览器重试。"); }
    finally { setPrinting(false); }
  }
  return <Modal rootClassName="work-order-print-modal" open afterOpenChange={setPreviewReady} title="委托单打印预览" width={860} styles={{body:{maxHeight:"calc(100vh - 220px)",overflowY:"auto"}}} onCancel={onClose} footer={<div className="wop-print-actions">
    <Button onClick={onClose}>关闭</Button>
    {!mobile && <Button icon={<Printer size={16}/>} onClick={handlePrint} loading={printing} disabled={loading || Boolean(error) || pdf.generating}>打印</Button>}
    {mobile ? <Button type="primary" onClick={pdf.share} loading={pdf.generating || pdf.sharing}
      disabled={loading || Boolean(error) || !pdf.file || pdf.generating}>{pdf.canShare ? "发送到" : pdf.dingTalk ? "保存到钉盘" : "下载 PDF"}</Button>
      : <Button type="primary" icon={<Printer size={16}/>} onClick={handlePdf} loading={pdf.generating} disabled={loading || Boolean(error) || printing}>导出 PDF</Button>}
  </div>}>
    <style>{printStyles}</style>
    {error && <Alert type="error" showIcon title="签名加载失败，暂不能打印" description={error} action={<Button onClick={retry}>重试</Button>} style={{marginBottom:12}}/>}
    {pdf.error && <Alert type="error" showIcon title={mobile ? "文件准备或发送失败" : "PDF 生成或分享失败"} description={pdf.error} action={<Button onClick={pdf.file ? pdf.share : handlePdf} loading={pdf.generating || pdf.sharing}>重试</Button>} style={{marginBottom:12}}/>}
    {mobile && pdf.file && !pdf.canShare && <Alert type="info" showIcon title={pdf.dingTalk ? "通过钉盘保存 PDF" : "下载 PDF 后打印"}
      description={pdf.dingTalk ? "点击“保存到钉盘”，选择位置后打开文件，可转发或下载后使用打印应用打印。文件会临时上传，下载链接 5 分钟后失效。" : "点击“下载 PDF”准备下载链接，保存文件后使用手机的 PDF 或打印应用打开。下载链接 5 分钟后失效。"} style={{marginBottom:12}}/>}
    {mobile && pdf.downloadUrl && <Alert type="success" showIcon title="PDF 下载链接已准备好" description={<>
      <p>链接 5 分钟内有效。钉钉内无法下载时，可复制链接到手机浏览器打开。</p>
      <Button href={pdf.downloadUrl} target="_blank" rel="noopener noreferrer">下载 PDF</Button>
      <p style={{wordBreak:"break-all",userSelect:"all",fontSize:12}}>{pdf.downloadUrl}</p>
    </>} style={{marginBottom:12}}/>}
    {!mobile && pdf.url && <Alert type="success" showIcon title="单页 PDF 已生成" description={<>
      <p>打开 PDF 后可通过系统菜单打印或保存。</p>
      <div className="wop-print-actions">
        <Button href={pdf.url} target="_blank" rel="noopener">打开 PDF</Button>
        <Button href={pdf.url} download={pdf.file?.name}>保存 PDF</Button>
        {pdf.canShare && <Button onClick={pdf.share} loading={pdf.sharing}>发送到</Button>}
      </div>
    </>} style={{marginBottom:12}}/>}
    {printError && <Alert type="error" showIcon title={printError} style={{marginBottom:12}}/>}
    <Spin spinning={loading || mobile && pdf.generating} description={loading ? "正在加载客户签名" : "正在准备文件…"}><div ref={documentRef} className="work-order-print-preview"><div className="wop-print-sheet"><main className="wop-print-page"><WorkOrderPrintDocument order={order} signatureSource={source} arrivalDate={arrivalDate} printSignature={printSignature}/></main></div></div></Spin>
  </Modal>;
}
