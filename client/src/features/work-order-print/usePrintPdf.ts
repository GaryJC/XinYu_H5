import { isDingTalkMobile, savePrintFile } from "../../integrations/dingtalk/printFile";
import { preparePdfDownload } from "./preparePdfDownload";
import { useCallback, useEffect, useRef, useState } from "react";

export function usePrintPdf(orderId: string) {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing] = useState(false);
  const sharingRef = useRef(false);
  const [downloadUrl, setDownloadUrl] = useState("");
  const generatingRef = useRef(false);
  const [error, setError] = useState("");
  const urlRef = useRef("");
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    setUrl("");
    setFile(undefined);
    return () => {
      active.current = false;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const generate = useCallback(async (element: HTMLElement, styles: string, title: string) => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setError("");
    setDownloadUrl("");
    try {
      // PDF libraries are loaded only when the user requests a PDF.
      const { createPrintPdf } = await import("./createPrintPdf");
      const blob = await createPrintPdf(element, styles, title);
      if (!active.current) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setUrl(urlRef.current);
      setFile(new File([blob], `${title}.pdf`, { type: "application/pdf" }));
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : "PDF 生成失败，请重试。");
    } finally {
      generatingRef.current = false;
      if (active.current) setGenerating(false);
    }
  }, []);

  const dingTalk = isDingTalkMobile();
  let canShare = false;
  try {
    canShare = Boolean(file && typeof navigator.share === "function" && navigator.canShare?.({ files: [file] }));
  } catch { /* Some WebViews expose a canShare implementation that throws. */ }
  async function share() {
    if (!file || sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setError("");
    try {
      if (canShare) {
        await navigator.share({ files: [file], title: file.name });
      } else {
        const download = await preparePdfDownload(orderId, file);
        if (!active.current) return;
        const fileUrl = new URL(download.path, window.location.origin).href;
        setDownloadUrl(fileUrl);
        if (dingTalk) await savePrintFile(fileUrl, file.name);
      }
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      if (active.current) setError(reason instanceof Error ? reason.message : "文件保存或发送未完成，请重试；也可使用下方链接下载 PDF。");
    } finally {
      sharingRef.current = false;
      if (active.current) setSharing(false);
    }
  }
  return { url, file, generating, error, generate, canShare, share, sharing, dingTalk, downloadUrl };
}
