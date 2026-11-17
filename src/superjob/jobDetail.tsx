import type { FoundJob } from "./jobSources.ts";

const viewerSandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export function JobDetail({ job }: { job: FoundJob }) {
  return (
    <article class="sj-detail-pane">
      <div class="sj-view">
        <iframe class="sj-frame" src={job.url} sandbox={viewerSandbox} referrerpolicy="no-referrer" title={`${job.title} listing`} />
      </div>
    </article>
  );
}
