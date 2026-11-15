import type { ButtonHTMLAttributes, ComponentChildren } from "preact";
import * as aiContext from "./aiContext.ts";

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

export function FileButton({ accept, isBusy = false, children, onFile }: { accept: string; isBusy?: boolean; children: ComponentChildren; onFile: (file: File) => void }) {
  return (
    <label class={`btn ghost file-btn${isBusy ? " disabled" : ""}`}>
      {isBusy && <Spinner />}
      {children}
      <input
        type="file"
        accept={accept}
        disabled={isBusy}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
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

/** ErrorNote for AI calls: silent while the header banner already explains that the AI is down. */
export function AiErrorNote(props: { message: string; onRetry?: () => void }) {
  return <ErrorNote {...props} message={aiContext.useCardError(props.message)} />;
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
    <label class={`field${rows ? " area" : ""}`}>
      {rows ? (
        <textarea rows={rows} value={value} placeholder={placeholder ?? " "} onInput={(event) => onValue(event.currentTarget.value)} />
      ) : (
        <input type={type as "text"} value={value} placeholder={placeholder ?? " "} onInput={(event) => onValue(event.currentTarget.value)} />
      )}
      <span>{label}</span>
    </label>
  );
}

type ChoiceOption = string | readonly [value: string, label: string];

export function Choice({ label, value, options, onValue }: { label: string; value: string; options: ChoiceOption[]; onValue: (value: string) => void }) {
  return (
    <label class="field">
      <select value={value} onChange={(event) => onValue(event.currentTarget.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = typeof option === "string" ? [option, option] : option;
          return <option value={optionValue}>{optionLabel}</option>;
        })}
      </select>
      <span>{label}</span>
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

interface CardProps {
  title?: string;
  actions?: ComponentChildren;
  /** renders the card as a disclosure so long forms stay scannable */
  collapsible?: boolean;
  isOpen?: boolean;
  children: ComponentChildren;
}

export function Card({ title, actions, collapsible = false, isOpen = false, children }: CardProps) {
  if (collapsible) {
    return (
      <details class="card collapsible" open={isOpen}>
        <summary>
          <h3>{title}</h3>
          <div class="row">{actions}</div>
        </summary>
        <div class="card-body">{children}</div>
      </details>
    );
  }
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

/** Sticks to the bottom of the panel so Save stays in reach while scrolling a long form. */
export function SaveBar({ isDirty, isSaved, label, onSave }: { isDirty: boolean; isSaved: boolean; label: string; onSave: () => void }) {
  return (
    <div class="save-bar">
      <span class={isDirty ? "dirty-text" : "ok-text"}>{isDirty ? "Unsaved changes" : isSaved ? "Saved" : ""}</span>
      <Button kind="primary" disabled={!isDirty} onClick={onSave}>
        {label}
      </Button>
    </div>
  );
}
