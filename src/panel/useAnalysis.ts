import { useEffect, useRef, useState } from "preact/hooks";
import * as tasks from "../ai/tasks.ts";
import * as storage from "../storage.ts";
import type { JobAnalysis, JobPosting, SalaryEstimate } from "../types.ts";
import * as aiContext from "./aiContext.ts";
import * as trackedJobs from "./trackedJobs.ts";
import { useTask } from "./useTask.ts";

/** Analysis + salary for one job: cached results first, auto-analyze if enabled, salary runs in parallel. */
export function useAnalysis(job: JobPosting | null, hasResume: boolean) {
  const [analysis, setAnalysis] = useState<JobAnalysis | null>(null);
  const [salary, setSalary] = useState<SalaryEstimate | null>(null);
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

  async function analyze() {
    if (!job) return;
    const [nextAnalysis, nextSalary] = await Promise.all([analysisTask.run(job), salaryTask.run(job)]);
    if (nextAnalysis) await trackedJobs.saveAnalysis(job, { ...nextAnalysis, salary: nextSalary ?? null });
  }

  async function estimate() {
    if (!job) return;
    const nextSalary = await salaryTask.run(job);
    if (nextSalary && analysis) await trackedJobs.saveAnalysis(job, { ...analysis, salary: nextSalary });
  }

  useEffect(() => {
    shownJobId.current = job?.id;
    setAnalysis(null);
    setSalary(null);
    analysisTask.reset();
    salaryTask.reset();
    if (!job) return;
    let isAlive = true;
    void (async () => {
      const [jobs, analyses, settings] = await Promise.all([storage.get("jobs"), storage.get("analyses"), storage.get("settings")]);
      if (!isAlive) return;
      const cached = jobs[job.id]?.analysis ?? analyses[job.id];
      if (cached) {
        setAnalysis(cached);
        setSalary(cached.salary);
      } else if (settings.autoAnalyze && hasResume) void analyze();
    })();
    return () => {
      isAlive = false;
    };
  }, [job?.id, hasResume]);

  return {
    analysis,
    salary,
    isAnalyzing: analysisTask.isBusy,
    isEstimating: salaryTask.isBusy,
    error: analysisTask.error,
    salaryError: salaryTask.error,
    analyze,
    estimate,
  };
}
