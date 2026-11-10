import { useEffect, useRef, useState } from "preact/hooks";
import * as session from "../fill/session.ts";
import type { FillReport, FillReportItem } from "../fill/session.ts";
import * as messages from "../messages.ts";
import type { FieldFill, JobPosting } from "../types.ts";
import { Button, Card, Check, ErrorNote } from "./controls.tsx";
import { ReportRow } from "./reportRow.tsx";
import * as trackedJobs from "./trackedJobs.ts";
import { useStored } from "./useStored.ts";
import { useTask } from "./useTask.ts";

const autoFillDelayMs = 1200;
const itemKey = (item: FillReportItem) => `${item.field.frameId}:${item.field.id}`;

type Group = "Filled" | "Needs review" | "Skipped";

function groupOf(item: FillReportItem): Group {
  if (item.fill) return item.result?.ok ? "Filled" : "Needs review";
  return item.field.required ? "Needs review" : "Skipped";
}

function currentValue(item: FillReportItem, edits: Record<string, string>): string {
  return edits[itemKey(item)] ?? item.result?.finalValue ?? item.fill?.value ?? "";
}

interface ApplyTabProps {
  tabId: number | null;
  /** current job, or the most recently viewed one */
  job: JobPosting | null;
}

export function ApplyTab({ tabId, job }: ApplyTabProps) {
  const settings = useStored("settings");
  const [report, setReport] = useState<FillReport | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [useAi, setUseAi] = useState(true);
  const [remember, setRemember] = useState(true);
  const [isMarked, setIsMarked] = useState(false);

  const fillTask = useTask(async () => {
    if (!tabId) throw new Error("No tab to fill.");
    const next = await session.run(tabId, job, { useAi });
    setReport(next);
    setEdits({});
  });
  const applyTask = useTask(async (items: FillReportItem[]) => {
    if (!tabId || !report) return;
    const fills: FieldFill[] = items.map((item) => ({ id: item.field.id, frameId: item.field.frameId, value: currentValue(item, edits), source: "user" }));
    const results = await session.apply(tabId, fills, remember, report.items.map((item) => item.field));
    const changedKeys = new Set(items.map(itemKey));
    const fillByKey = new Map(items.map((item, index) => [itemKey(item), fills[index]!]));
    setReport({
      ...report,
      items: report.items.map((item) => {
        if (!changedKeys.has(itemKey(item))) return item;
        return { ...item, fill: fillByKey.get(itemKey(item))!, result: results.find((result) => result.id === item.field.id) ?? item.result };
      }),
    });
    setEdits({});
  });

  const latest = useRef({ autoFill: !!settings?.autoFillOnPageChange, isBusy: fillTask.isBusy, run: fillTask.run });
  latest.current = { autoFill: !!settings?.autoFillOnPageChange, isBusy: fillTask.isBusy, run: fillTask.run };
  useEffect(() => {
    if (!tabId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (message: messages.ContentEvent, sender: chrome.runtime.MessageSender) => {
      if (message?.type !== "formChanged" || sender.tab?.id !== tabId) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current.autoFill && !latest.current.isBusy && void latest.current.run(), autoFillDelayMs);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [tabId]);

  const changedItems = (report?.items ?? []).filter((item) => itemKey(item) in edits && edits[itemKey(item)] !== (item.fill?.value ?? ""));
  const clearHighlights = async () => {
    if (!tabId) return;
    const frameIds = await messages.listFrameIds(tabId);
    await Promise.all(frameIds.map((frameId) => messages.sendToFrame(tabId, frameId, { type: "clearHighlights" })));
  };
  const [scanNote, setScanNote] = useState("");

  const markApplied = async () => {
    if (!job) return;
    await trackedJobs.track(job, { status: "applied" });
    setIsMarked(true);
  };

  return (
    <div class="stack">
      <Card title="Autofill">
        <div class="stack tight">
          <Button kind="primary" isBusy={fillTask.isBusy} disabled={!tabId} onClick={() => void fillTask.run()}>
            {fillTask.isBusy ? "Filling…" : "Fill this page"}
          </Button>
          <Check label="Use AI for unanswered questions" checked={useAi} onChecked={setUseAi} />
          <p class="muted small">SmartJob never submits — review and click Submit yourself.</p>
          <Button disabled={!tabId} onClick={() => tabId && void copyFieldScan(tabId).then(setScanNote, (error) => setScanNote(String(error)))}>
            Copy field scan (for bug reports)
          </Button>
          {scanNote && <span class="muted small">{scanNote}</span>}
        </div>
        <ErrorNote message={fillTask.error} onRetry={() => void fillTask.run()} />
      </Card>
      {report && (
        <ReportList report={report} edits={edits} onEdit={(key, value) => setEdits({ ...edits, [key]: value })} tabId={tabId} />
      )}
      {report && (
        <div class="row wrap">
          <Button kind="primary" isBusy={applyTask.isBusy} disabled={changedItems.length === 0} onClick={() => void applyTask.run(changedItems)}>
            Apply edits{changedItems.length ? ` (${changedItems.length})` : ""}
          </Button>
          <Button onClick={() => void clearHighlights()}>Clear highlights</Button>
          <Check label="Remember my answers" checked={remember} onChecked={setRemember} />
        </div>
      )}
      <ErrorNote message={applyTask.error} />
      <Card title="Application status">
        <div class="row between">
          <span class="muted small">{job ? `${job.title} @ ${job.company}` : "No job detected"}</span>
          <Button disabled={!job || isMarked} onClick={() => void markApplied()}>
            {isMarked ? "Marked as applied" : "Mark as applied"}
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ReportList({ report, edits, onEdit, tabId }: { report: FillReport; edits: Record<string, string>; onEdit: (key: string, value: string) => void; tabId: number | null }) {
  const groups: Group[] = ["Needs review", "Filled", "Skipped"];
  if (report.items.length === 0) return <Card><p class="muted">No fillable fields found on this page.</p></Card>;
  return (
    <>
      {groups.map((group) => {
        const items = report.items.filter((item) => groupOf(item) === group);
        if (!items.length) return null;
        return (
          <Card title={`${group} (${items.length})`}>
            <div class="stack tight">
              {items.map((item) => (
                <ReportRow
                  key={itemKey(item)}
                  item={item}
                  value={currentValue(item, edits)}
                  onValue={(value) => onEdit(itemKey(item), value)}
                  onFocusField={() => tabId && void messages.sendToFrame(tabId, item.field.frameId, { type: "focusField", id: item.field.id })}
                />
              ))}
            </div>
          </Card>
        );
      })}
    </>
  );
}

/** Copies every scanned field as JSON so a user can report what an unsupported form looks like. */
async function copyFieldScan(tabId: number): Promise<string> {
  const frameIds = await messages.listFrameIds(tabId);
  const fields = [];
  for (const frameId of frameIds) {
    const scanned = (await messages.sendToFrame(tabId, frameId, { type: "scanFields" })) ?? [];
    for (const field of scanned) fields.push({ ...field, frameId, options: field.options.slice(0, 15) });
  }
  const tab = await chrome.tabs.get(tabId);
  await navigator.clipboard.writeText(JSON.stringify({ url: tab.url, fields }, null, 1));
  return `Copied ${fields.length} fields from ${frameIds.length} frame(s).`;
}
