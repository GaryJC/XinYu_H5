import type { WorkOrder } from "../../../../shared/types";

const belongings = ["音响系统", "点烟器", "天窗", "四门玻璃机", "中央门锁", "后视镜", "备胎", "灭火器", "行驶证", "千斤顶", "贵重物品提示"];
const money = (value: number) => Number.isFinite(value) ? value.toFixed(2) : "";
const present = (value: string | undefined) => value || "—";

export function WorkOrderPrintDocument({ order, signatureSource, arrivalDate = order.arrivalDate }: { order: WorkOrder; signatureSource?: string; arrivalDate?: string }) {
  const rows = [...order.repairItems];
  while (rows.length < 9) rows.push({ id: -rows.length - 1, name: "", laborFee: 0, owner: "", startAt: "", finishAt: "", inspector: "", status: "待派工" });
  const selected = order.inspection.belongings;
  const isSigned = Boolean(order.signatures.customer);
  return <article className="work-order-print" aria-label="机动车修理委托书打印版">
    <h1>机动车修理委托书</h1>
    <div className="wop-heading"><span>派工号：<b>{present(order.dispatchNo)}</b></span><span>进厂日期：{present(arrivalDate)}</span></div>
    <div className="wop-customer"><span>车主：{present(order.customer.name)}</span><span>联系人：{present(order.customer.contact)}</span><span>电话：{present(order.customer.phone)}</span></div>
    <div className="wop-address">地址：{present(order.customer.address)}</div>
    <table className="wop-vehicle"><caption>用户车辆信息</caption><thead><tr><th>车牌号码</th><th>车型</th><th>购车日期</th><th>底盘号 / VIN</th><th>进厂里程（km）</th></tr></thead><tbody><tr>
      <td>{present(order.vehicle.plate)}</td><td>{present(order.vehicle.model)}</td><td>{present(order.vehicle.purchaseDate)}</td><td className="wop-vin">{present(order.vehicle.vin)}</td><td>{present(order.vehicle.mileage)}</td>
    </tr></tbody></table>
    <section className="wop-inspection">
      <div className="wop-inspection-left"><div className="wop-belongings"><h2>物品及功能确认</h2><p className="wop-check-note"><CheckBox checked/> 表示已登记的随车物品，功能状态以现场检查为准</p><div>{[...new Set([...belongings, ...selected])].map(item=><span key={item}><CheckBox checked={selected.includes(item)}/>{item}</span>)}</div><p>燃油存量：{order.inspection.fuelLevel}</p></div>
      <div className="wop-fault"><h2>故障描述（用户反映）</h2><p>{present(order.faultDescription)}</p></div></div>
      <div className="wop-condition"><h2>车辆状况</h2><VehicleConditionDiagram /><p>外观记录：{order.inspection.exteriorIssues.join("、") || "未登记外观异常"}</p><small>× 石击　○ 凹凸　△ 划伤　□ 损坏</small></div>
    </section>
    <table className="wop-repairs"><caption>预计修理项目</caption><colgroup><col style={{width:"6%"}}/><col style={{width:"52%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/><col style={{width:"14%"}}/></colgroup><thead><tr><th>序号</th><th>修理内容</th><th>修理工费</th><th>主修人</th><th>过程检查人</th></tr></thead><tbody>{rows.map((item,index)=><tr key={`${item.id}-${index}`}><td>{index+1}</td><td className="wop-repair-name">{item.name}</td><td>{item.name && item.laborFee !== 0 ? money(item.laborFee) : ""}</td><td>{item.owner === "待派工" ? "" : item.owner}</td><td>{item.inspector === "待检验" ? "" : item.inspector}</td></tr>)}</tbody></table>
    <section className="wop-closing"><div className="wop-fees"><span>预计修理费：{order.estimatedFee !== 0 ? `¥${money(order.estimatedFee)}` : ""}</span><span>预计交车时间：{present(order.estimatedDeliveryAt)}</span><span>工号 / 服务顾问：{present(order.advisor)}</span></div>
    <div className="wop-authorization"><p>本人已确认登记无误，同意贵公司维修上述项目，并同意维修必要的厂外试车。本人亦认可维修必要的附料按实际消耗量进行结算，并同意承担全部费用。本人确认无贵重物品。</p><div className="wop-customer-signature"><strong>用户确认：</strong>{signatureSource ? <img src={signatureSource} alt="客户手写签名"/> : <span>{isSigned ? "签名图片待加载" : "未签字"}</span>}</div></div>
    <div className="wop-staff-signatures"><span>服务顾问：{order.signatures.advisor || order.advisor || "____________"}</span><span>总检验员签名：{order.signatures.inspector || "____________"}<small>（完工交检）　　年　　月　　日</small></span></div></section>
    <footer><span>地址：{present(order.shop.address)}</span><span>电话：{present(order.shop.phone)}</span></footer>
  </article>;
}

function VehicleConditionDiagram() {
  return <svg className="wop-car" viewBox="0 0 240 180" fill="none" aria-hidden="true"><g stroke="currentColor" strokeWidth="1.3"><path d="M100 22Q120 12 140 22l9 24v91l-9 21q-20 10-40 0l-9-21V46Z"/><path d="m99 52 5-16q16-7 32 0l5 16-5 13h-32Zm0 69 5 20q16 6 32 0l5-20-6-10h-30Z"/><path d="M99 70v36m42-36v36M106 69h28v40h-28Z"/><rect x="84" y="43" width="7" height="23" rx="2"/><rect x="149" y="43" width="7" height="23" rx="2"/><rect x="84" y="119" width="7" height="23" rx="2"/><rect x="149" y="119" width="7" height="23" rx="2"/><path d="m29 39 8-13h22l8 13v107H29Zm7 11h24v32H36Zm0 45h24v30H36ZM173 39l8-13h22l8 13v107h-38Zm7 11h24v32h-24Zm0 45h24v30h-24Z"/><path d="M100 6h40M99 174h42"/></g></svg>;
}

function CheckBox({ checked }: { checked: boolean }) {
  return <i className="wop-check-box" data-checked={checked} aria-hidden="true"/>;
}
