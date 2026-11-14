import { useEffect, useRef, useState } from "preact/hooks";
import * as perksData from "../../ai/perks.ts";
import * as tasks from "../../ai/tasks.ts";
import * as storage from "../../storage.ts";
import type { CompanyPerks, JobAnalysis, JobPosting, SalaryEstimate } from "../../types.ts";
import * as aiContext from "../shared/aiContext.ts";
import * as trackedJobs from "./trackedJobs.ts";
import { useTask } from "../shared/useTask.ts";

/** Analysis + salary for one job: cached results first, auto-analyze if enabled, salary runs in parallel. */
export function useAnalysis(job: JobPosting | null, hasResume: boolean) {
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [salary, setSalary] = useState<SalaryEstimate | null>(null);
  const [perks, setPerks] = useState<CompanyPerks | null>(null);
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

  async function analyze() {
    if (!job) return;
    const [nextAnalysis, nextSalary, nextPerks] = await Promise.all([analysisTask.run(job), salaryTask.run(job), perksTask.run(job)]);
    if (nextAnalysis) await trackedJobs.saveAnalysis(job, { ...nextAnalysis, salary: nextSalary ?? null, perks: nextPerks ?? null });
  }

  async function estimate() {
    if (!job) return;
    const nextSalary = await salaryTask.run(job);
    if (nextSalary && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary: nextSalary, perks });
  }

  async function findPerks() {
    if (!job) return;
    const nextPerks = await perksTask.run(job);
    if (nextPerks && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary, perks: nextPerks });
  }

  useEffect(() => {
    shownJobId.current = job?.id;
    setAnalysis(null);
    setSalary(null);
    setPerks(null);
    analysisTask.reset();
    salaryTask.reset();
    perksTask.reset();
    if (!job) return;
    let isAlive = true;
    void (async () => {
      const [jobs, analyses, settings] = await Promise.all([storage.get("jobs"), storage.get("analyses"), storage.get("settings")]);
      if (!isAlive) return;
      const cached = jobs[job.id]?.analysis ?? analyses[job.id];
      if (cached) {
        setAnalysis(cached);
        setSalary(cached.salary);
        setPerks(cached.perks ?? null);
      } else if (settings.autoAnalyze && hasResume) void analyze();
    })();
    return () => {
      isAlive = false;
    };
  }, [job?.id, hasResume]);

  return {
    analysis,
    salary,
    perks,
    isAnalyzing: analysisTask.isBusy,
    isEstimating: salaryTask.isBusy,
    isFindingPerks: perksTask.isBusy,
    error: analysisTask.error,
    salaryError: salaryTask.error,
    perksError: perksTask.error,
    analyze,
    estimate,
    findPerks,
  };
}
