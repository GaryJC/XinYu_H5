import {Button, type ButtonProps} from 'antd';
import {RefreshCw} from 'lucide-react';
import './refresh-button.css';

export function RefreshButton({label='刷新',loading,disabled,className,...props}:Omit<ButtonProps,'children'|'icon'> & {label?:string}) {
 return <Button {...props} type="text" className={`compact-refresh ${className||''}`} aria-label={props['aria-label']||label} title={props.title||label} icon={<RefreshCw size={18} aria-hidden="true"/>} loading={loading} disabled={disabled||!!loading}/>;
}
