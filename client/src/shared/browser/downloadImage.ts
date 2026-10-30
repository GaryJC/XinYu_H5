export function downloadImage(source: string): void {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(source);
  if (!match) throw new Error("图片尚未加载完成，请重新打开预览后下载。");
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: match[1] });
  const extension = match[1].split("/")[1].replace("jpeg", "jpg").replace("svg+xml", "svg");
  const name = `照片.${extension}`;
  const legacyNavigator = navigator as Navigator & { msSaveOrOpenBlob?: (blob: Blob, name: string) => boolean };
  if (legacyNavigator.msSaveOrOpenBlob) {
    if (!legacyNavigator.msSaveOrOpenBlob(blob, name)) throw new Error("下载未能启动，请在浏览器中打开照片后保存。");
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  try { link.click(); }
  finally {
    link.remove();
    // Embedded browsers may consume the URL after the click handler returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
