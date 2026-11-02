import { forwardRef, type ComponentRef } from 'react';
import { Button, type ButtonProps } from 'antd';
import { Trash2 } from 'lucide-react';
import './photo-remove-button.css';

export const PhotoRemoveButton = forwardRef<ComponentRef<typeof Button>, Omit<ButtonProps, 'type' | 'danger' | 'icon'>>(
  function PhotoRemoveButton({ children = '删除照片', className, ...props }, ref) {
    return <Button {...props} ref={ref} type="text" danger icon={<Trash2 size={15} aria-hidden="true"/>}
      className={['photo-remove-button', className].filter(Boolean).join(' ')}>{children}</Button>;
  }
);
