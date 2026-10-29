import { useEffect, useId, useState, type PropsWithChildren, type ReactNode } from "react";
import { App as AntApp, Card, ConfigProvider, Grid, Modal, type ModalProps } from "antd";
import zhCN from "antd/locale/zh_CN";
import "./business-form.css";

export function BusinessThemeProvider({ children }: PropsWithChildren) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  return <ConfigProvider locale={zhCN} theme={{
    token: {
      colorPrimary: "#1677ff", colorBgLayout: "#f4f6f8", colorBorder: "#dce2ea",
      colorText: "#243247", colorTextSecondary: "#657085",
      borderRadius: 8, borderRadiusLG: 12,
      controlHeight: mobile ? 44 : 36, controlHeightLG: 44,
      fontSize: mobile ? 16 : 14,
    },
    components: {
      Message: { zIndexPopup: 4000 },
      Card: { borderRadiusLG: 12 },
      Form: { itemMarginBottom: 16, verticalLabelPadding: "0 0 8px" },
    },
  }}><AntApp message={{ maxCount: 3, top: mobile ? 20 : 32 }}>{children}</AntApp></ConfigProvider>;
}

export function FormSurface({ children, className = "" }: PropsWithChildren<{ className?: string }>) {
  return <Card className={`business-form-surface ${className}`}>{children}</Card>;
}

export function FormSection({ title, description, extra, children, className = "" }: PropsWithChildren<{
  title: string; description?: string; extra?: ReactNode; className?: string;
}>) {
  const id = useId();
  return <section className={`business-form-section ${className}`} aria-labelledby={id}>
    <div className="business-form-section-heading">
      <div><h3 id={id}>{title}</h3>{description && <p>{description}</p>}</div>
      {extra}
    </div>
    {children}
  </section>;
}

export function FormActionBar({ children, label }: PropsWithChildren<{ label: string }>) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardOpen(window.innerHeight - viewport.height > 150);
    update();
    viewport.addEventListener("resize", update);
    return () => viewport.removeEventListener("resize", update);
  }, []);
  return <div className={`business-form-action-bar${keyboardOpen ? " keyboard-open" : ""}`} role="group" aria-label={label}>{children}</div>;
}

export function FormDialog({ children, rootClassName = "", styles, ...props }: ModalProps) {
  const screens = Grid.useBreakpoint();
  const mobile = !screens.md;
  return <Modal width={mobile ? "calc(100vw - 24px)" : 640}
    style={mobile ? { top: 12, paddingBottom: 12 } : undefined}
    {...props} rootClassName={`business-form-modal ${rootClassName}`}
    styles={typeof styles === "function" ? styles : {
      ...styles, body: { maxHeight: mobile ? "calc(100dvh - 172px)" : "72vh", overflowY: "auto", ...styles?.body },
    }}>
    {children}
  </Modal>;
}
