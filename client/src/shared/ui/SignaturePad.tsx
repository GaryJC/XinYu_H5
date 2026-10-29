import { type PointerEvent, useLayoutEffect, useRef } from "react";
import { Button } from "antd";
import { Eraser } from "lucide-react";

export function SignaturePad({
  disabled,
  value,
  onChange,
  landscapeMode = false,
}: {
  disabled?: boolean;
  value?: string;
  onChange: (imageDataUrl: string) => void;
  landscapeMode?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const displayedValueRef = useRef<string | undefined>(undefined);
  const imageRevisionRef = useRef(0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function resize() {
      if (!canvas) return;
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) return;
      const bitmapWidth = Math.round(width * ratio);
      const bitmapHeight = Math.round(height * ratio);
      if (canvas.width === bitmapWidth && canvas.height === bitmapHeight) return;

      // Resizing clears the bitmap. Preserve current ink synchronously so a
      // delayed image decode cannot overwrite a new stroke after rotation.
      const previous = document.createElement("canvas");
      previous.width = canvas.width;
      previous.height = canvas.height;
      previous.getContext("2d")?.drawImage(canvas, 0, 0);
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
      const context = canvas.getContext("2d");
      if (context) {
        context.setTransform(bitmapWidth / width, 0, 0, bitmapHeight / height, 0, 0);
        context.lineWidth = 2.4;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "#141414";
        context.drawImage(previous, 0, 0, width, height);
      }
      // Resizing resets the current path too, so the next move starts at
      // its new position instead of connecting to an old coordinate.
    }

    resize();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);
    observer?.observe(canvas);
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || value === displayedValueRef.current) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const revision = ++imageRevisionRef.current;
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (value) {
      const image = new Image();
      image.onload = () => {
        if (revision !== imageRevisionRef.current) return;
        context.drawImage(image, 0, 0, canvas.clientWidth, canvas.clientHeight);
        displayedValueRef.current = value;
      };
      image.src = value;
    } else {
      displayedValueRef.current = value;
    }
    return () => { imageRevisionRef.current++; };
  }, [value]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const visualX = event.clientX - rect.left;
    const visualY = event.clientY - rect.top;

    // On narrow portrait devices, the landscape dialog is rotated 90 degrees
    // with CSS. Pointer events remain in viewport coordinates, so transform
    // them back into the canvas's unrotated coordinate space before drawing.
    const rotated = landscapeMode && window.matchMedia("(max-width: 760px) and (orientation: portrait)").matches;
    const x = rotated
      ? visualY * (canvas.clientWidth / rect.height)
      : visualX * (canvas.clientWidth / rect.width);
    const y = rotated
      ? (rect.width - visualX) * (canvas.clientHeight / rect.width)
      : visualY * (canvas.clientHeight / rect.height);

    return {
      x: Math.min(Math.max(x, 0), canvas.clientWidth),
      y: Math.min(Math.max(y, 0), canvas.clientHeight),
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    if (!event.isPrimary || event.button !== 0 || activePointerRef.current !== null) return;
    imageRevisionRef.current++;
    activePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.beginPath();
    context?.moveTo(next.x, next.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId || disabled) return;
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.lineTo(next.x, next.y);
    context?.stroke();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    if (event.type === "pointerup") draw(event);
    activePointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextValue = event.currentTarget.toDataURL("image/png");
    displayedValueRef.current = nextValue;
    onChange(nextValue);
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    imageRevisionRef.current++;
    displayedValueRef.current = "";
    if (canvas && context) context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    onChange("");
  }

  return (
    <div className="signature-pad-wrap">
      <canvas
        ref={canvasRef}
        className="signature-canvas"
        aria-label="手写签名区域"
        onPointerDown={start}
        onPointerMove={draw}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
      <Button type="text" size="small" icon={<Eraser size={15} />} onClick={clear} disabled={disabled}>清空重签</Button>
    </div>
  );
}
