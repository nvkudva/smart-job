import { useEffect, useRef, useState } from "preact/hooks";
import * as session from "../../fill/session.ts";
import type { FillReport, FillReportItem } from "../../fill/session.ts";
import * as messages from "../../messages.ts";
import * as storage from "../../storage.ts";
import * as selection from "../../superjob/selection.ts";
import type { FieldFill, JobPosting } from "../../types.ts";
import * as activeTab from "../job/activeTab.ts";
import { Button, Card, Check, ErrorNote } from "../shared/controls.tsx";
import { DocumentsSection } from "../documents/documentsSection.tsx";
import * as applyPage from "./openApplyPage.ts";
import { ReportRow } from "./reportRow.tsx";
import * as trackedJobs from "../job/trackedJobs.ts";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

const autoFillDelayMs = 1200;
const afterClickMs = 1500;
const formPollMs = 1000;
const maxFormPolls = 15;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface ApplyTarget {
  tabId: number | null;
  url: string;
}
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
  /** URL of the tracked tab; the page where the user applies */
  tabUrl: string;
  /** current job, or the most recently viewed one */
  job: JobPosting | null;
}

export function ApplyTab({ tabId, tabUrl, job }: ApplyTabProps) {
  const settings = useStored("settings");
  const [report, setReport] = useState<FillReport | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [useAi, setUseAi] = useState(true);
  const [remember, setRemember] = useState(true);

  // the account password is filled only on an explicit click (Fill this page or Start applying), never by auto-fill on a page the user did not choose
  const fillTask = useTask(async (isUserClick: boolean) => {
    if (!tabId) throw new Error("No tab to fill.");
    const next = await session.run(tabId, job, { useAi, includeAccount: isUserClick });
    setReport(next);
    setEdits({});
    if (isUserClick) await rememberApplication(next, { tabId, url: tabUrl });
  });
  const stopRequested = useRef(false);
  const startTask = useTask(async () => {
    if (!tabId) throw new Error("No tab to apply on.");
    stopRequested.current = false;
    setNote("");
    const { portalTabId, click } = await applyPage.open(tabId, tabUrl, job);
    if (portalTabId || click.result !== "none") await sleep(afterClickMs);
    for (let poll = 0; poll < maxFormPolls && !stopRequested.current; poll++) {
      const target: ApplyTarget = portalTabId ? { tabId: portalTabId, url: (await chrome.tabs.get(portalTabId)).url ?? "" } : await activeTab.readCurrentTab();
      // Start is the user's go-ahead to type the job-site account into sign-up forms for this run only
      const next = target.tabId ? await session.run(target.tabId, job, { useAi, includeAccount: true }) : null;
      if (next && next.items.length > 0) {
        setReport(next);
        setEdits({});
        await rememberApplication(next, target);
        setNote("Filled. Review it, then submit yourself.");
        return;
      }
      await sleep(formPollMs);
    }
    if (!stopRequested.current) setNote(click.result === "none" ? "No Apply button or form found here." : "No form appeared. Click Apply on the page, then press Fill this page.");
  });
  const applyTask = useTask(async (items: FillReportItem[]) => {
    if (!tabId || !report) return;
    const fills: FieldFill[] = items.map((item) => ({ id: item.field.id, frameId: item.field.frameId, value: currentValue(item, edits), source: "user" }));
    const results = await session.apply(tabId, fills, remember, report.items.map((item) => item.field), items);
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

  /** Keeps where the user applied (and which login) with the tracked job, and offers a created account to the browser's password manager. */
  const rememberApplication = async (filled: FillReport, target: ApplyTarget) => {
    const hasPasswordFill = filled.items.some((item) => item.field.kind === "password" && item.result?.ok);
    const account = settings?.account;
    if (hasPasswordFill && target.tabId && account?.email && account.password) {
      await messages.sendToFrame(target.tabId, 0, { type: "storeCredential", username: account.email, password: account.password });
    }
    if (!job || filled.filledCount === 0) return;
    const portalUrl = target.url && target.url !== job.url && !selection.isPage(target.url) ? target.url : undefined;
    await trackedJobs.track(job, { ...(portalUrl && { portalUrl }), ...(hasPasswordFill && account?.email && { accountEmail: account.email }) });
  };

  useAutoFillOnFormChange(tabId, { autoFill: !!settings?.autoFillOnPageChange, isBusy: fillTask.isBusy || startTask.isBusy, run: fillTask.run });

  const changedItems = (report?.items ?? []).filter((item) => itemKey(item) in edits && edits[itemKey(item)] !== (item.fill?.value ?? ""));
  const [note, setNote] = useState("");

  return (
    <div class="stack">
      <Card title="Autofill">
        <div class="stack tight">
          <Check label="Use AI for unanswered questions" checked={useAi} onChecked={setUseAi} />
          <p class="muted small">Start applying opens the Apply page and fills the form. SmartJob never submits — review and click Submit yourself.</p>
          <div class="actions">
            <span class="grow muted small">{note}</span>
            <Button disabled={!tabId} title="Copy every scanned field as JSON for bug reports" onClick={() => tabId && void copyFieldScan(tabId).then(setNote, (error) => setNote(String(error)))}>
              Copy field scan
            </Button>
            <Button title="Copy what SmartJob missed, failed or was corrected on, as JSON" onClick={() => void copyFillLog().then(setNote, (error) => setNote(String(error)))}>
              Copy fill log
            </Button>
            <Button isBusy={fillTask.isBusy} disabled={!tabId || startTask.isBusy} onClick={() => void fillTask.run(true)}>
              {fillTask.isBusy ? "Filling…" : "Fill this page"}
            </Button>
            {startTask.isBusy ? (
              <Button onClick={() => (stopRequested.current = true)}>Stop</Button>
            ) : (
              <Button kind="primary" disabled={!tabId || fillTask.isBusy} onClick={() => void startTask.run()}>
                Start applying
              </Button>
            )}
          </div>
        </div>
        <ErrorNote message={fillTask.error || startTask.error} onRetry={() => void (startTask.error ? startTask.run() : fillTask.run(true))} />
      </Card>
      {report && (
        <ReportList report={report} edits={edits} onEdit={(key, value) => setEdits({ ...edits, [key]: value })} tabId={tabId} />
      )}
      {report && (
        <div class="actions">
          <span class="grow">
            <Check label="Remember my answers" checked={remember} onChecked={setRemember} />
          </span>
          <Button onClick={() => tabId && void clearHighlights(tabId)}>Clear highlights</Button>
          <Button kind="primary" isBusy={applyTask.isBusy} disabled={changedItems.length === 0} onClick={() => void applyTask.run(changedItems)}>
            Apply edits{changedItems.length ? ` (${changedItems.length})` : ""}
          </Button>
        </div>
      )}
      <ErrorNote message={applyTask.error} />
      <ApplicationStatus job={job} />
      <h2 class="section-title">Documents</h2>
      <DocumentsSection currentJob={job} />
    </div>
  );
}

function useAutoFillOnFormChange(tabId: number | null, current: { autoFill: boolean; isBusy: boolean; run: (isUserClick: boolean) => Promise<unknown> }) {
  const latest = useRef(current);
  latest.current = current;
  useEffect(() => {
    if (!tabId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (message: messages.ContentEvent, sender: chrome.runtime.MessageSender) => {
      if (message?.type !== "formChanged" || sender.tab?.id !== tabId) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current.autoFill && !latest.current.isBusy && void latest.current.run(false), autoFillDelayMs);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      clearTimeout(timer);
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [tabId]);
}

async function clearHighlights(tabId: number) {
  const frameIds = await messages.listFrameIds(tabId);
  await Promise.all(frameIds.map((frameId) => messages.sendToFrame(tabId, frameId, { type: "clearHighlights" })));
}

function ApplicationStatus({ job }: { job: JobPosting | null }) {
  const [isMarked, setIsMarked] = useState(false);
  const markApplied = async () => {
    if (!job) return;
    await trackedJobs.track(job, { status: "applied", appliedAt: Date.now() });
    setIsMarked(true);
  };
  return (
    <Card title="Application status">
      <div class="row between">
        <span class="muted small">{job ? `${job.title} @ ${job.company}` : "No job detected"}</span>
        <Button disabled={!job || isMarked} onClick={() => void markApplied()}>
          {isMarked ? "Marked as applied" : "Mark as applied"}
        </Button>
      </div>
    </Card>
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

/** Copies the learning log so misses and corrections can be reviewed or used to improve the mapping rules. */
async function copyFillLog(): Promise<string> {
  const log = await storage.get("fillLog");
  await navigator.clipboard.writeText(JSON.stringify(log, null, 1));
  return `Copied ${log.length} log entries.`;
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
