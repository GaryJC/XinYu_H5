import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import datePickerZhCN from "antd/es/date-picker/locale/zh_CN";
import { lazy, Suspense, useState } from "react";
import { Button, DatePicker, Modal, Radio } from "antd";
import { Printer } from "lucide-react";
import type { WorkOrder } from "../../../../shared/types";
import "./work-order-print-controls.css";

import { LoadingState } from "../../shared/ui/LoadingState";

const PrintPreview = lazy(() => import("./PrintPreview").then(module => ({ default: module.PrintPreview })));

export function WorkOrderPrintButton({ order }: { order: WorkOrder }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [printSignature, setPrintSignature] = useState(true);
  const [arrivalDate, setArrivalDate] = useState("");
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate);

  function openSettings() {
    setArrivalDate(order.arrivalDate?.slice(0, 10) || "");
    setPrintSignature(true);
    setSettingsOpen(true);
  }

  return <>
    <Button icon={<Printer size={16}/>} onClick={openSettings}>打印委托单</Button>
    <Modal rootClassName="work-order-print-modal work-order-print-settings-modal" open={settingsOpen} title="打印设置" okText="生成打印预览" cancelText="取消"
      onCancel={() => setSettingsOpen(false)} okButtonProps={{disabled:!validDate}}
      onOk={() => { setSettingsOpen(false); setOpen(true); }}>
      <div className="wop-print-settings">
      <label htmlFor={`print-arrival-${order.id}`}>进厂日期</label>
      <DatePicker id={`print-arrival-${order.id}`} className="wop-arrival-input" aria-label="打印进厂日期"
        locale={datePickerZhCN} format="YYYY-MM-DD" inputReadOnly allowClear={false}
        value={arrivalDate && dayjs(arrivalDate).isValid() ? dayjs(arrivalDate).locale("zh-cn") : null}
        onChange={value => setArrivalDate(value?.format("YYYY-MM-DD") || "")} style={{marginTop:8}}/>
      <p style={{color:"#657085",fontSize:13}}>仅用于本次打印，不修改已保存的委托单。</p>
      <div role="group" aria-labelledby={`print-signature-label-${order.id}`} style={{marginTop:16}}>
        <div id={`print-signature-label-${order.id}`} style={{marginBottom:8}}>打印签字</div>
        <Radio.Group aria-label="打印签字" value={printSignature} onChange={event => setPrintSignature(event.target.value)}>
          <Radio value={true}>是</Radio><Radio value={false}>否</Radio>
        </Radio.Group>
      </div>
      </div>
    </Modal>
    {open && <Suspense fallback={<Modal open title="委托单打印预览" onCancel={() => setOpen(false)} footer={null}><LoadingState label="正在加载打印预览…" /></Modal>}>
      <PrintPreview key={order.id} order={order} arrivalDate={arrivalDate} printSignature={printSignature} onClose={() => setOpen(false)}/>
    </Suspense>}
  </>;
}
