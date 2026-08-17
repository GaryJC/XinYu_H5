import { useEffect, useRef, useState } from "react";
import { Alert, Button, Form, Input, Modal } from "antd";
import { Plus } from "lucide-react";
import { pinyin } from "pinyin-pro";
import { VehicleReferenceCandidate, VehicleReferenceKind } from "../../../../shared/types";
import { workOrderApi } from "../work-orders/api/workOrderApi";

type Props = {
  kind: VehicleReferenceKind;
  currentName: string;
  currentCode: string;
  disabled?: boolean;
  onCreate: (candidate: VehicleReferenceCandidate) => void;
};

type CheckState = {
  status: "idle" | "checking" | "available" | "duplicate" | "error";
  message: string;
};

export function CreateVehicleReferenceButton({ kind, currentName, currentCode, disabled, onCreate }: Props) {
  const label = kind === "model" ? "车型" : "所属单位";
  const maxLength = kind === "model" ? 10 : 50;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [check, setCheck] = useState<CheckState>({ status: "idle", message: "" });
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!open) return;
    if (!codeEdited) setCode(generateLegacyReferenceCode(name, kind));
  }, [name, kind, open, codeEdited]);

  useEffect(() => {
    if (!open) return;
    const sequence = ++requestSequence.current;
    const localError = validateCode(code, maxLength);
    if (localError) {
      setCheck({ status: "error", message: localError });
      return;
    }
    setCheck({ status: "checking", message: "正在查询润丰编码…" });
    const timer = window.setTimeout(async () => {
      try {
        const result = await workOrderApi.checkVehicleReferenceCode(kind, code);
        if (sequence !== requestSequence.current) return;
        setCheck(result.available
          ? { status: "available", message: "编码可用" }
          : {
              status: "duplicate",
              message: `编码已被“${result.existing?.value || "其他记录"}”使用，请修改编码`
            });
      } catch (error) {
        if (sequence === requestSequence.current) {
          setCheck({ status: "error", message: error instanceof Error ? error.message : "编码查询失败" });
        }
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [code, kind, maxLength, open]);

  function showModal() {
    const nextName = currentName.trim();
    setName(nextName);
    setCode(currentCode.trim() || generateLegacyReferenceCode(nextName, kind));
    setCodeEdited(Boolean(currentCode.trim()));
    setCheck({ status: "idle", message: "" });
    setOpen(true);
  }

  async function submit() {
    const normalizedName = name.trim();
    if (!normalizedName) {
      setCheck({ status: "error", message: `${label}名称不能为空` });
      return;
    }
    const localError = validateCode(code, maxLength);
    if (localError) {
      setCheck({ status: "error", message: localError });
      return;
    }
    setSubmitting(true);
    try {
      const result = await workOrderApi.checkVehicleReferenceCode(kind, code);
      if (!result.available) {
        setCheck({
          status: "duplicate",
          message: `编码已被“${result.existing?.value || "其他记录"}”使用，请修改编码`
        });
        return;
      }
      onCreate({ value: normalizedName, code: result.code, usageCount: 0 });
      setOpen(false);
    } catch (error) {
      setCheck({ status: "error", message: error instanceof Error ? error.message : "编码查询失败" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="vehicle-reference-create">
      <Button type="link" icon={<Plus size={15} />} disabled={disabled} onClick={showModal}>
        新增{label}
      </Button>
      {currentCode ? <span>当前编码：{currentCode}</span> : <span>未选择已有编码时，请新增{label}</span>}
      <Modal
        open={open}
        title={`新增${label}`}
        okText="确认使用"
        cancelText="取消"
        confirmLoading={submitting}
        okButtonProps={{ disabled: check.status !== "available" }}
        onOk={submit}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          title="系统默认生成中文拼音首字母编码"
          description="编码重复时请在下方手动修改。保存草稿只记录编码，客户签字写入润丰时才会正式创建主数据。"
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical">
          <Form.Item label={`${label}名称`} required>
            <Input value={name} maxLength={kind === "model" ? 100 : 150} onChange={(event) => setName(event.target.value)} />
          </Form.Item>
          <Form.Item
            label="润丰编码"
            required
            validateStatus={check.status === "duplicate" || check.status === "error" ? "error" : check.status === "available" ? "success" : "validating"}
            help={check.message || `最多 ${maxLength} 个字符，只能使用英文字母和数字`}
          >
            <Input
              value={code}
              maxLength={maxLength}
              onChange={(event) => {
                setCodeEdited(true);
                setCode(event.target.value);
              }}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export function generateLegacyReferenceCode(name: string, kind: VehicleReferenceKind) {
  const maxLength = kind === "model" ? 10 : 50;
  const initials = pinyin(name.normalize("NFKC"), {
    pattern: "first",
    toneType: "none",
    type: "array"
  }).join("").replace(/[^A-Za-z0-9]/g, "");
  const conventionalCase = kind === "model" ? initials.toUpperCase() : initials.toLowerCase();
  return conventionalCase.slice(0, maxLength);
}

function validateCode(code: string, maxLength: number) {
  const normalized = code.trim();
  if (!normalized) return "编码不能为空";
  if (!/^[A-Za-z0-9]+$/.test(normalized)) return "编码只能包含英文字母和数字";
  if (normalized.length > maxLength) return `编码最多 ${maxLength} 个字符`;
  return "";
}
