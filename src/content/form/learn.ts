// After a fill, watches what the user does to the fields SmartJob filled or could not answer, and hands it to the learning log.
import * as learning from "../../fill/learning.ts";
import type { FieldDescriptor, FillSource } from "../../types.ts";
import * as highlight from "./highlight.ts";
import * as scanner from "./scanner.ts";

interface Watched {
  field: FieldDescriptor;
  source: FillSource | "none";
  lastValue: string;
}

const watched = new Map<string, Watched>();
let isListening = false;

/** `source` is "none" for a field SmartJob had no answer for (or failed to fill). */
export function watch(field: FieldDescriptor, source: FillSource | "none", value: string): void {
  if (!learning.isLoggable(field)) return;
  watched.set(field.id, { field, source, lastValue: value });
  if (isListening) return;
  isListening = true;
  // change covers selects and radios, focusout covers text and custom comboboxes that never fire change
  for (const type of ["change", "focusout"]) document.addEventListener(type, (event) => onEdit(event).catch(() => {}), true);
}

/** A radio or checkbox click lands on one member of a group, but only the first member carries the field id. */
function watchedIdOf(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined;
  const candidates = [target, target.closest<HTMLElement>("[data-sj-id]")];
  if (target instanceof HTMLInputElement && target.type === "radio") candidates.push(...scanner.radioGroup(target));
  if (target instanceof HTMLInputElement && target.type === "checkbox") candidates.push(...scanner.sameNameCheckboxes(target));
  return candidates.map((candidate) => candidate?.dataset.sjId).find((id) => id !== undefined && watched.has(id));
}

async function onEdit(event: Event): Promise<void> {
  if (!event.isTrusted) return;
  const id = watchedIdOf(event.target);
  const element = id ? scanner.findElement(id) : null;
  const entry = id ? watched.get(id) : undefined;
  if (!element || !entry) return;
  const value = scanner.readValue(element, entry.field.kind);
  if (!value.trim() || value === entry.lastValue) return;
  const previous = entry.lastValue;
  entry.lastValue = value;
  if (entry.source === "none") {
    highlight.answered(element);
  }
  await learning.recordEdit(location.hostname, entry.field, entry.source, previous, value);
}
