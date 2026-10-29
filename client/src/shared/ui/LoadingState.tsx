import { Spin } from 'antd';
import './loading-state.css';

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return <div className="loading-state" role="status" aria-live="polite" aria-busy="true">
    <Spin /><span>{label}</span>
  </div>;
}
