import type {SignatureRepairItem} from '../../../../shared/types';
import './signature-repair-items.css';

const labels = {pending: '待客户确认', approved: '已同意，待安排', inspection: '检验待定'};

export function SignatureRepairItems({items, showFees = false}: {items: SignatureRepairItem[]; showFees?: boolean}) {
  return <section className="signature-repair-items" aria-label="维修项目">
    <h2>维修项目</h2>
    <div className="signature-repair-list">
      {items.map((item, index) => <div className="signature-repair-row" key={index}>
        <span className="signature-repair-name">{item.name}</span>
        {item.confirmation ? <span className="signature-repair-status">{labels[item.confirmation]}</span>
          : showFees ? <strong>¥{item.laborFee.toFixed(2)}</strong> : null}
      </div>)}
    </div>
    {items.some(item => item.confirmation === 'pending') && <p className="signature-repair-note">标为“待客户确认”的项目，须经您另行确认后才会安排维修。</p>}
  </section>;
}
