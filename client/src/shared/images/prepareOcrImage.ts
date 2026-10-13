const targetBytes = 1400 * 1024;
const maxEdge = 2560;

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result) : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片无法解码"));
    image.src = url;
  });
}

function encodeJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片压缩失败")), "image/jpeg", quality);
  });
}

// Use Image/canvas rather than createImageBitmap for older DingTalk WebViews.
export async function prepareOcrImage(file: File) {
  const started = performance.now();
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  let output: Blob = file;
  let converted = false;
  let fallback = false;
  try {
    const image = await loadImage(url);
    const edge = Math.max(image.naturalWidth, image.naturalHeight);
    const supported = /image\/(jpeg|png|webp)/i.test(file.type);
    if (file.size > targetBytes || edge > maxEdge || !supported) {
      const scale = Math.min(1, maxEdge / edge);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("图片压缩不可用");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      // Keep small VIN characters readable: retain dimensions and stop at 80% quality.
      for (const quality of [0.92, 0.86, 0.8]) {
        const candidate = await encodeJpeg(canvas, quality);
        if (!converted || candidate.size < output.size) {
          output = candidate;
          converted = true;
        }
        if (output.size <= targetBytes) break;
      }
      if (supported && edge <= maxEdge && output.size >= file.size) {
        output = file;
        converted = false;
      }
    }
  } catch {
    // Preserve existing format handling when a WebView cannot decode/encode an image.
    output = file;
    converted = false;
    fallback = true;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
  const imageBase64 = await readDataUrl(output);
  console.info("[ocr-image]", {
    durationMs: Math.round(performance.now() - started),
    originalBytes: file.size, outputBytes: output.size, fallback,
    targetExceeded: output.size > targetBytes
  });
  return {
    imageBase64,
    mimeType: converted ? "image/jpeg" : file.type || "image/jpeg",
    fileName: converted ? `${file.name.replace(/\.[^.]+$/, "") || "image"}.jpg` : file.name || "image.jpg"
  };
}
