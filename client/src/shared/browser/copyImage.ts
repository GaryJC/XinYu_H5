function imageAsPng(source: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (!/^data:image\/[\w.+-]+;base64,/i.test(source)) {
      reject(new Error("图片尚未加载完成，请重新打开预览。"));
      return;
    }
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context || !canvas.width || !canvas.height) throw new Error("图片处理失败，请保存图片后使用。");
        context.drawImage(image, 0, 0);
        canvas.toBlob(blob => {
          canvas.width = canvas.height = 0;
          if (blob) resolve(blob);
          else reject(new Error("图片处理失败，请保存图片后使用。"));
        }, "image/png");
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error("图片读取失败，请重新打开预览。"));
    image.src = source;
  });
}

export function canCopyImage(): boolean {
  return window.isSecureContext && typeof navigator.clipboard?.write === "function"
    && typeof ClipboardItem === "function" && (ClipboardItem.supports?.("image/png") ?? true);
}

export class ImageClipboardUnavailableError extends Error {}

export async function copyImage(source: string): Promise<void> {
  if (!canCopyImage()) {
    throw new ImageClipboardUnavailableError("当前窗口无法直接写入图片。请右键照片，用客户端的菜单复制或保存图片。");
  }
  // Pass the conversion promise directly: clipboard.write must start inside
  // the original click activation, before image decoding or canvas conversion.
  const png = imageAsPng(source);
  void png.catch(() => {}); // A denied write may never consume the image promise.
  try {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    } catch (error) {
      // Older Chromium clients may accept a Blob but reject promise-valued data.
      // Keep the immediate promise write above for Safari's click activation.
      if (!(error instanceof Error) || error.name !== "TypeError") throw error;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await png })]);
    }
  } catch (error) {
    if (error instanceof Error && ["NotAllowedError", "SecurityError", "NotSupportedError"].includes(error.name)) {
      throw new ImageClipboardUnavailableError("当前窗口未允许写入剪贴板。请再次右键照片，选择「复制图片」或「拷贝图像」。");
    }
    throw error;
  }
}
