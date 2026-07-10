import { useId } from "react";

type FieldProps = {
  label: string;
  value: string;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function Field({ label, value, suffix, disabled, onChange }: FieldProps) {
  const id = useId();
  return (
    <div className="field">
      <span><label htmlFor={id}>{label}</label></span>
      <div className="input-shell">
        <input id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <em>{suffix}</em> : null}
      </div>
    </div>
  );
}

export function TextArea({ label, value, disabled, onChange }: Omit<FieldProps, "suffix">) {
  const id = useId();
  return (
    <div className="field textarea-field">
      <span><label htmlFor={id}>{label}</label></span>
      <textarea id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </div>
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
          <label key={item}>
            <input type="checkbox" disabled={disabled} checked={selected.includes(item)} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
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
