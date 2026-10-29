import { useActionFeedback } from "../../shared/ui/useActionFeedback";
import { useSignatureMode } from "./useSignatureMode";
import { SignatureShare } from "./SignatureShare";
import { useEffect, useState } from "react";
import { Alert, Button, Form, Grid, Radio, Space } from "antd";
import { FileSignature, Maximize2, Minimize2 } from "lucide-react";
import type { WorkOrder } from "../../../../shared/types";
import { FormDialog } from "../../shared/ui/BusinessForm";
import { Summary } from "../../shared/ui/FormControls";
import { sumLabor } from "../work-orders/domain/workOrderDomain";
import { SignaturePad } from "./SignaturePad";

export type SignatureSession = { token: string; order: WorkOrder };

type Props = {
  session: SignatureSession;
  completeSignature: (order: WorkOrder, token: string, image: string) => Promise<WorkOrder>;
  onClose: () => void;
  onOrderUpdated: (order: WorkOrder) => void;
};

export function WorkOrderSignatureDialog({ session, completeSignature, onClose, onOrderUpdated }: Props) {
  const feedback = useActionFeedback();
  const [signatureSession, setSignatureSession] = useState(session);
  const [signatureImage, setSignatureImage] = useState("");
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);
  const [signatureResult, setSignatureResult] = useState("");
  const [signatureCompleted, setSignatureCompleted] = useState(false);
  const [landscapeSignature, setLandscapeSignature] = useState(false);
  const supplemental = signatureSession.order.signaturePurpose === "supplement";
  const signingMode = useSignatureMode(signatureSession, next => { setSignatureSession(next); setSignatureImage(""); setLandscapeSignature(false); }, onOrderUpdated);
  const remote = !supplemental && signingMode.mode === "remote";
  const busy = signatureSubmitting || signingMode.busy;
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;

  useEffect(() => {
    if (!landscapeSignature) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [landscapeSignature]);

  async function handleCompleteSignature() {
    if (!signatureSession || !signatureImage) return;
    setSignatureSubmitting(true);
    try {
      await completeSignature(signatureSession.order, signatureSession.token, signatureImage);
      feedback.success("签字已保存并确认");
      setSignatureCompleted(true);
      setSignatureResult(supplemental ? "现场补充签名已保存并确认。" : "现场签字已确认，已提交润丰同步及后续流程。");
    } catch (error) {
      feedback.error(error);
      setSignatureResult(error instanceof Error ? error.message : "签字保存失败");
    } finally {
      setSignatureSubmitting(false);
    }
  }

  function closeSignatureModal() {
    if (busy) return;
    onClose();
    setLandscapeSignature(false);
    setSignatureImage("");
    setSignatureResult("");
  }

  return <>
          <FormDialog
            rootClassName="signature-confirm-modal"
            open={Boolean(signatureSession)}
            title="机动车维修委托确认"
            width={isMobile ? "calc(100vw - 24px)" : 760}
            closable={!busy}
            mask={{ closable: false }}
            onCancel={closeSignatureModal}
            footer={[
              <Button key="close" disabled={busy} onClick={closeSignatureModal}>{signatureCompleted ? "完成" : remote ? "稍后发送签字链接" : supplemental ? "取消" : "取消（保留草稿）"}</Button>,
              !remote && <Button key="sign" type="primary" icon={<FileSignature size={16} />} loading={signatureSubmitting} disabled={!signatureImage || signatureCompleted || busy || remote} onClick={handleCompleteSignature}>
                {signatureCompleted ? "已签字" : "确认签字"}
              </Button>
            ]}
          >
            {signatureSession ? (
              <Form layout="vertical" requiredMark>
                {signatureResult ? <Alert className="signature-message" type={signatureCompleted ? "success" : "error"} showIcon title={signatureResult} /> : <Alert className="signature-message" type="info" showIcon title={remote ? "请将签字链接发送给客户，等待客户签字后核对确认。" : "请客户核对委托信息并在下方手写签名。"} />}
                {!supplemental && !signatureCompleted && <Form.Item label="客户签字方式">
                  <Radio.Group aria-label="客户签字方式" value={signingMode.mode} disabled={busy} onChange={event => void signingMode.change(event.target.value)}>
                    <Space orientation="vertical">
                      <Radio value="onsite">车主在现场，现在签字</Radio>
                      <Radio value="remote">车主不在现场，后续发送签字链接</Radio>
                    </Space>
                  </Radio.Group>
                  <p>{remote ? "已保留为待客户签字。客户签字并经服务顾问或管理员确认后，才能进入后续流程。" : "需完成客户签字；取消或关闭时仅保留草稿，不提交委托单。"}</p>
                  {signingMode.error && <Alert type="error" showIcon title={signingMode.error}/>}
                </Form.Item>}
                {!signatureCompleted && (supplemental || remote) && <SignatureShare session={signatureSession} onRenew={setSignatureSession} onUpdated={order => {
                  onOrderUpdated(order);
                  if (order.customerSignatureFileId) {
                    feedback.success("签字已保存并确认");
      setSignatureCompleted(true);
                    setSignatureResult("客户已完成签字，需确认用户签字。请关闭弹窗后核对并确认。");
                  }
                }} />}
                <div className="summary-grid">
                  <Summary label="委托单号" value={signatureSession.order.id} />
                  <Summary label="车牌号码" value={signatureSession.order.vehicle.plate} />
                  <Summary label="车主名称/所属单位" value={signatureSession.order.customer.name} />
                  <Summary label="车型" value={signatureSession.order.vehicle.model || "-"} />
                  <Summary label="预计费用" value={`¥${signatureSession.order.estimatedFee || sumLabor(signatureSession.order.repairItems)}`} />
                  <Summary label="旧件处置" value={signatureSession.order.oldPartsHandling} />
                </div>
                <div className="public-items">
                  {signatureSession.order.repairItems.map((item) => <div key={item.id}><span>{item.name}</span><strong>¥{item.laborFee}</strong></div>)}
                </div>
                {!remote && <Form.Item
                  className="field"
                  label={(
                    <span className="signature-field-label">
                      电子签名
                      <Button type="link" size="small" icon={<Maximize2 size={15} />} disabled={busy || signatureCompleted} onClick={() => setLandscapeSignature(true)}>横屏签字</Button>
                    </span>
                  )}
                  required
                >
                  <SignaturePad value={signatureImage} disabled={busy || signatureCompleted} onChange={setSignatureImage} />
                </Form.Item>}
              </Form>
            ) : null}
          </FormDialog>
          {landscapeSignature && signatureSession ? (
            <div className="signature-landscape-overlay" role="dialog" aria-modal="true" aria-label="横屏签字">
              <div className="signature-landscape-header">
                <div>
                  <strong>请客户横向签名</strong>
                  <span>{signatureSession.order.vehicle.plate} · {signatureSession.order.customer.name}</span>
                </div>
                <Button type="primary" icon={<Minimize2 size={16} />} onClick={() => setLandscapeSignature(false)}>完成横屏签字</Button>
              </div>
              <SignaturePad landscapeMode value={signatureImage} disabled={signatureSubmitting || signatureCompleted} onChange={setSignatureImage} />
            </div>
          ) : null}
  </>;
}
