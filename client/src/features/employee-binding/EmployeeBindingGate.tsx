import { Alert, Button, Modal, Radio, Space, Spin } from "antd";
import type { UserProfile } from "../../../../shared/types";
import { useEmployeeBinding } from "./useEmployeeBinding";

export function EmployeeBindingGate({ user, onBound, onDefer }: { user: UserProfile; onBound: (user: UserProfile) => void; onDefer?: () => void }) {
  const binding = useEmployeeBinding(user, onBound);
  const candidates = binding.status?.candidates || [];
  return <div className="app-shell">
    <Modal title="匹配润丰员工编码" open closable={false} maskClosable={false} keyboard={false}
      width={520} footer={<Space wrap>
        {onDefer && <Button onClick={onDefer}>先使用出车申请</Button>}
        <Button loading={binding.loading} onClick={() => void binding.retry()}>重新匹配</Button>
        <Button type="primary" disabled={!binding.selected || binding.loading} loading={binding.loading}
          onClick={() => void binding.confirm()}>确认绑定并继续</Button>
      </Space>}>
      <p>你好，{user.name}。请先确认润丰员工档案，绑定后即可使用维修工功能，下次登录无需重复匹配。</p>
      {binding.loading && <Spin aria-label="正在匹配润丰员工" />}
      {binding.error && <Alert type="error" showIcon title={binding.error} />}
      {!binding.loading && binding.status?.required && candidates.length === 0 &&
        <Alert type="warning" showIcon title="未找到同名、在职且带维修工标记的员工档案"
          description="请联系管理员核对钉钉姓名与润丰档案，修正后点击重新匹配。" />}
      {candidates.length > 0 && <>
        <p>润丰存在多条同名档案，请选择本人所属部门的员工编码：</p>
        <Radio.Group aria-label="选择润丰员工档案" value={binding.selected} disabled={binding.loading}
          onChange={e => binding.setSelected(e.target.value)} style={{ width: "100%" }}>
          <Space orientation="vertical" style={{ width: "100%" }}>
            {candidates.map(employee => <Radio key={employee.code} value={employee.code}>
              {employee.name} · {employee.code} · {employee.departmentCode} {employee.departmentName} · {employee.status}
            </Radio>)}
          </Space>
        </Radio.Group>
      </>}
    </Modal>
  </div>;
}
