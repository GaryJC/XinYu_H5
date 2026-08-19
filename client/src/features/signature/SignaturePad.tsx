import { type PointerEvent, useEffect, useRef } from "react";
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
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context?.scale(ratio, ratio);
    if (context) {
      context.lineWidth = 2.4;
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#141414";
      if (value) {
        const image = new Image();
        image.onload = () => context.drawImage(image, 0, 0, width, height);
        image.src = value;
      }
    }
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
    drawingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.beginPath();
    context?.moveTo(next.x, next.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || disabled) return;
    const context = event.currentTarget.getContext("2d");
    const next = point(event);
    context?.lineTo(next.x, next.y);
    context?.stroke();
  }

  function finish(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onChange(event.currentTarget.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
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
      />
      <Button type="text" size="small" icon={<Eraser size={15} />} onClick={clear} disabled={disabled}>清空重签</Button>
    </div>
  );
}
