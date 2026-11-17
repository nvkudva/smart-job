import { useEffect, useRef, useState } from "preact/hooks";
import * as officeData from "../../ai/office.ts";
import * as perksData from "../../ai/perks.ts";
import * as tasks from "../../ai/tasks.ts";
import * as storage from "../../storage.ts";
import type { StoreShape } from "../../storage.ts";
import type { CompanyOffice, CompanyPerks, JobAnalysis, JobPosting, SalaryEstimate } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import * as trackedJobs from "./trackedJobs.ts";
import { useTask } from "../shared/useTask.ts";

async function readSavedResults(jobId: string) {
  const [jobs, analyses, lookups, settings] = await Promise.all([storage.get("jobs"), storage.get("analyses"), storage.get("lookups"), storage.get("settings")]);
  return { cached: jobs[jobId]?.analysis ?? analyses[jobId], known: lookups[jobId], settings };
}

/** Analysis + salary for one job: cached results first, auto-analyze if enabled, salary runs in parallel. */
export function useAnalysis(job: JobPosting | null, hasResume: boolean) {
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [salary, setSalary] = useState<SalaryEstimate | null>(null);
  const [perks, setPerks] = useState<CompanyPerks | null>(null);
  const [office, setOffice] = useState<CompanyOffice | null>(null);
  const shownJobId = useRef<string | undefined>(undefined);

  const analysisTask = useTask(async (target: JobPosting) => {
    const partial = await aiContext.run(({ client, candidate }) => tasks.analyzeJob(client, target, candidate));
    const result: JobAnalysis = { ...partial, salary: null, analyzedAt: Date.now() };
    if (shownJobId.current === target.id) setAnalysis(result);
    return result;
  });
  const salaryTask = useTask(async (target: JobPosting) => {
    const result = await aiContext.run(({ client, settings }) => tasks.estimateSalary(client, target, { webSearch: settings.salarySearch }));
    if (shownJobId.current === target.id) setSalary(result);
    return result;
  });

  const perksTask = useTask(async (target: JobPosting) => {
    const result = await aiContext.run(({ client, settings }) => perksData.find(client, target, { webSearch: settings.salarySearch }));
    if (shownJobId.current === target.id) setPerks(result);
    return result;
  });

  const officeTask = useTask(async (target: JobPosting) => {
    const result = await aiContext.run(({ client, settings }) => officeData.find(client, target, { webSearch: settings.salarySearch }));
    if (shownJobId.current === target.id) setOffice(result);
    return result;
  });

  /** `known` holds salary, perks and office stored from an earlier run whose analysis failed, so they are not paid for twice. */
  async function runAll(known?: StoreShape["lookups"][string]) {
    if (!job) return;
    const [nextAnalysis, nextSalary, nextPerks, nextOffice] = await Promise.all([
      analysisTask.run(job),
      known?.salary ?? salaryTask.run(job),
      known?.perks ?? perksTask.run(job),
      known?.office ?? officeTask.run(job),
    ]);
    if (nextAnalysis) return trackedJobs.saveAnalysis(job, { ...nextAnalysis, salary: nextSalary ?? null, perks: nextPerks ?? null, office: nextOffice ?? null });
    if (nextSalary || nextPerks || nextOffice) {
      await storage.update("lookups", (lookups) => ({ ...lookups, [job.id]: { salary: nextSalary ?? null, perks: nextPerks ?? null, office: nextOffice ?? null } }));
    }
  }

  const analyze = () => runAll();

  async function estimate() {
    if (!job) return;
    const nextSalary = await salaryTask.run(job);
    if (nextSalary && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary: nextSalary, perks, office });
  }

  async function findPerks() {
    if (!job) return;
    const nextPerks = await perksTask.run(job);
    if (nextPerks && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary, perks: nextPerks, office });
  }

  async function findOffice() {
    if (!job) return;
    const nextOffice = await officeTask.run(job);
    if (nextOffice && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary, perks, office: nextOffice });
  }

  useEffect(() => {
    shownJobId.current = job?.id;
    setAnalysis(null);
    setSalary(null);
    setPerks(null);
    setOffice(null);
    analysisTask.reset();
    salaryTask.reset();
    perksTask.reset();
    officeTask.reset();
    if (!job) return;
    let isAlive = true;
    void (async () => {
      const { cached, known, settings } = await readSavedResults(job.id);
      if (!isAlive) return;
      if (cached) {
        setAnalysis(cached);
        setSalary(cached.salary);
        setPerks(cached.perks ?? null);
        setOffice(cached.office ?? null);
      } else {
        if (known) {
          setSalary(known.salary);
          setPerks(known.perks);
          setOffice(known.office ?? null);
        }
        if (settings.autoAnalyze && hasResume) void runAll(known);
      }
    })();
    return () => {
      isAlive = false;
    };
  }, [job?.id, hasResume]);

  return {
    analysis,
    salary,
    perks,
    office,
    isAnalyzing: analysisTask.isBusy,
    isEstimating: salaryTask.isBusy,
    isFindingPerks: perksTask.isBusy,
    isFindingOffice: officeTask.isBusy,
    error: analysisTask.error,
    salaryError: salaryTask.error,
    perksError: perksTask.error,
    officeError: officeTask.error,
    analyze,
    estimate,
    findPerks,
    findOffice,
  };
}
