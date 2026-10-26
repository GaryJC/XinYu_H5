const profiles = {
  ocr: { targetBytes: 1400 * 1024, maxEdge: 2560, qualities: [0.92, 0.86, 0.8] },
  photo: { targetBytes: 500 * 1024, maxEdge: 1600, qualities: [0.84, 0.76, 0.68] }
};

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
export function prepareOcrImage(file: File) { return prepareImage(file, 'ocr'); }
export function prepareUploadPhoto(file: File, uploadedAt?: Date, extraLines: string[] = []) {
  const watermark = uploadedAt ? [`上传时间：${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(uploadedAt).replace(/\//g, '-')}`, ...extraLines.map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean)] : undefined;
  return prepareImage(file, 'photo', watermark);
}

function drawWatermark(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, lines: string[]) {
  const padding = Math.max(2, Math.round(Math.min(canvas.width, canvas.height) * 0.015));
  let fontSize = Math.max(1, Math.round(Math.min(canvas.width, canvas.height) * 0.032));
  context.save();
  context.font = `${fontSize}px sans-serif`;
  const availableWidth = Math.max(1, canvas.width - padding * 4);
  const textWidth = () => Math.max(...lines.map(line => context.measureText(line).width));
  if (textWidth() > availableWidth) {
    fontSize *= availableWidth / textWidth();
    context.font = `${fontSize}px sans-serif`;
  }
  const lineHeight = fontSize * 1.4;
  const height = fontSize + lineHeight * (lines.length - 1) + padding * 2;
  const top = canvas.height - height - padding;
  context.fillStyle = 'rgba(0, 0, 0, 0.6)';
  context.fillRect(padding, top, textWidth() + padding * 2, height);
  context.fillStyle = '#fff';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  lines.forEach((line, index) => context.fillText(line, padding * 2, top + padding + index * lineHeight));
  context.restore();
}

async function prepareImage(file: File, profile: keyof typeof profiles, watermark?: string[]) {
  const { targetBytes, maxEdge, qualities } = profiles[profile];
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
    if (watermark || file.size > targetBytes || edge > maxEdge || !supported) {
      const scale = Math.min(1, maxEdge / edge);
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("图片压缩不可用");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      if (watermark) drawWatermark(context, canvas, watermark);
      // OCR keeps small characters readable; ordinary record photos use smaller files.
      for (const quality of qualities) {
        const candidate = await encodeJpeg(canvas, quality);
        if (!converted || candidate.size < output.size) {
          output = candidate;
          converted = true;
        }
        if (output.size <= targetBytes) break;
      }
      // Detailed photos can still be large at low quality. Reduce dimensions only
      // for record photos; documents retain their OCR resolution.
      if (profile === 'photo') {
        while (output.size > targetBytes && Math.max(canvas.width, canvas.height) > 960) {
          const scale = Math.max(960 / Math.max(canvas.width, canvas.height), 0.8);
          canvas.width = Math.max(1, Math.round(canvas.width * scale));
          canvas.height = Math.max(1, Math.round(canvas.height * scale));
          context.fillStyle = '#fff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          if (watermark) drawWatermark(context, canvas, watermark);
          output = await encodeJpeg(canvas, 0.76);
        }
      }
      if (!watermark && supported && edge <= maxEdge && output.size >= file.size) {
        output = file;
        converted = false;
      }
    }
  } catch {
    if (watermark) throw new Error('照片时间水印添加失败，请重新选择照片或重试');
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
    profile,
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
