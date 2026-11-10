import type { FillReportItem } from "../fill/session.ts";
import type { FillSource } from "../types.ts";

const sourceLabel: Record<FillSource, string> = { profile: "Profile", answers: "Saved answer", ai: "AI", resume: "Resume", user: "You" };
const choiceKinds = ["select", "radio", "combobox"];

function ValueInput({ item, value, onValue }: { item: FillReportItem; value: string; onValue: (value: string) => void }) {
  const { field } = item;
  const label = field.label || field.name || field.id;
  if (field.kind === "file") return <span class="muted">{value || "file input"}</span>;
  if (field.kind === "checkbox") {
    return (
      <select aria-label={label} value={value} onChange={(event) => onValue(event.currentTarget.value)}>
        <option value="">(unchanged)</option>
        <option value="true">Checked</option>
        <option value="false">Unchecked</option>
      </select>
    );
  }
  if (choiceKinds.includes(field.kind) && field.options.length > 0) {
    const options = value && !field.options.includes(value) ? [value, ...field.options] : field.options;
    return (
      <select aria-label={label} value={value} onChange={(event) => onValue(event.currentTarget.value)}>
        <option value="">(none)</option>
        {options.map((option) => (
          <option value={option}>{option}</option>
        ))}
      </select>
    );
  }
  const isLong = field.kind === "textarea" || field.kind === "contenteditable" || value.length > 80;
  if (isLong) return <textarea aria-label={label} rows={4} value={value} onInput={(event) => onValue(event.currentTarget.value)} />;
  return <input aria-label={label} value={value} onInput={(event) => onValue(event.currentTarget.value)} />;
}

interface ReportRowProps {
  item: FillReportItem;
  value: string;
  onValue: (value: string) => void;
  onFocusField: () => void;
}

export function ReportRow({ item, value, onValue, onFocusField }: ReportRowProps) {
  const { field, fill, result } = item;
  return (
    <div class="report-row">
      <div class="row between">
        <button type="button" class="link" onClick={onFocusField} title="Scroll to this field on the page">
          {field.label || field.name || field.id}
          {field.required && <span class="required"> *</span>}
        </button>
        {fill && <span class={`badge source-${fill.source}`}>{sourceLabel[fill.source]}</span>}
      </div>
      <ValueInput item={item} value={value} onValue={onValue} />
      {result && !result.ok && <div class="field-error">{result.error || "Could not fill this field"}</div>}
    </div>
  );
}
