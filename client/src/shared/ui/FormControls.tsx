import { useId } from "react";
import { Checkbox, Form, Input } from "antd";

type FieldProps = {
  label: string;
  value: string;
  suffix?: string;
  disabled?: boolean;
  required?: boolean;
  error?: string;
  onChange: (value: string) => void;
};

export function Field({ label, value, suffix, disabled, required, error, onChange }: FieldProps) {
  const id = useId();
  return (
    <Form.Item className="field" label={label} htmlFor={id} required={required} validateStatus={error ? "error" : undefined} help={error}>
      <Input id={id} aria-required={required} status={error ? "error" : undefined} value={value} disabled={disabled} suffix={suffix} onChange={(event) => onChange(event.target.value)} />
    </Form.Item>
  );
}

export function TextArea({ label, value, disabled, required, error, onChange }: Omit<FieldProps, "suffix">) {
  const id = useId();
  return (
    <Form.Item className="field textarea-field" label={label} htmlFor={id} required={required} validateStatus={error ? "error" : undefined} help={error}>
      <Input.TextArea id={id} aria-required={required} status={error ? "error" : undefined} value={value} disabled={disabled} autoSize={{ minRows: 3 }} onChange={(event) => onChange(event.target.value)} />
    </Form.Item>
  );
}

type ChecklistProps = {
  title: string;
  items: string[];
  selected: string[];
  disabled?: boolean;
  onToggle: (value: string) => void;
};

export function Checklist({ title, items, selected, disabled, onToggle }: ChecklistProps) {
  return (
    <div className="checklist">
      <strong>{title}</strong>
      <div>
        {items.map((item) => (
          <Checkbox key={item} disabled={disabled} checked={selected.includes(item)} onChange={() => onToggle(item)}>{item}</Checkbox>
        ))}
      </div>
    </div>
  );
}

export function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
