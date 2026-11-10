import type { ButtonHTMLAttributes, ComponentChildren } from "preact";

export function Spinner() {
  return <span class="spinner" role="status" aria-label="Working" />;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { isBusy?: boolean; kind?: "primary" | "ghost" | "danger" };

export function Button({ isBusy = false, kind = "ghost", children, disabled, ...rest }: ButtonProps) {
  return (
    <button type="button" class={`btn ${kind}`} disabled={disabled || isBusy} {...rest}>
      {isBusy && <Spinner />}
      {children}
    </button>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div class="error" role="alert">
      <span>{message}</span>
      {onRetry && <Button onClick={onRetry}>Retry</Button>}
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onValue: (value: string) => void;
  type?: "text" | "email" | "tel" | "number" | "password";
  placeholder?: string;
  rows?: number;
}

export function Field({ label, value, onValue, type = "text", placeholder, rows }: FieldProps) {
  return (
    <label class="field">
      <span>{label}</span>
      {rows ? (
        <textarea rows={rows} value={value} placeholder={placeholder} onInput={(event) => onValue(event.currentTarget.value)} />
      ) : (
        <input type={type as "text"} value={value} placeholder={placeholder} onInput={(event) => onValue(event.currentTarget.value)} />
      )}
    </label>
  );
}

export type ChoiceOption = string | readonly [value: string, label: string];

export function Choice({ label, value, options, onValue }: { label: string; value: string; options: ChoiceOption[]; onValue: (value: string) => void }) {
  return (
    <label class="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onValue(event.currentTarget.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option;
          return <option value={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </label>
  );
}

export function Check({ label, checked, onChecked }: { label: string; checked: boolean; onChecked: (checked: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChecked(event.currentTarget.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Card({ title, actions, children }: { title?: string; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="card">
      {(title || actions) && (
        <header class="card-head">
          <h3>{title}</h3>
          <div class="row">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Chips({ items, kind = "" }: { items: string[]; kind?: string }) {
  if (!items.length) return null;
  return (
    <div class="chips">
      {items.map((item) => (
        <span class={`chip ${kind}`}>{item}</span>
      ))}
    </div>
  );
}
