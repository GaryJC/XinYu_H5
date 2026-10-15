import { useEffect, useRef, useState } from "react";

export function usePrintPdf() {
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File>();
  const [generating, setGenerating] = useState(false);
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

  async function generate(element: HTMLElement, styles: string, title: string) {
    if (generating) return;
    setGenerating(true);
    setError("");
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
      if (active.current) setGenerating(false);
    }
  }

  const canShare = Boolean(file && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] }));
  async function share() {
    if (!file || !canShare) return;
    try { await navigator.share({ files: [file], title: file.name }); }
    catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError("系统分享未能打开，请使用打开 PDF 或保存 PDF。");
    }
  }
  return { url, file, generating, error, generate, canShare, share };
}
