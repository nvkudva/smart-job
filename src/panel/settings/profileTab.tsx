import { useState } from "preact/hooks";
import { AnswerBank } from "./answerBank.tsx";
import { LinkedinButton } from "./linkedinButton.tsx";
import { ProfileEditor } from "./profileEditor.tsx";
import { ResumeFields } from "./resumeSection.tsx";
import { Card } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";

/** One card for both data sources: open until a resume exists, then collapsed so the profile gets the space. */
function SourcesCard({ hasResume }: { hasResume: boolean }) {
  const [isOpen] = useState(!hasResume);
  const resume = useStored("resume");
  const importedAt = useStored("linkedinImportedAt");
  const status = `${resume ? "Resume ✓" : "No resume"} · ${importedAt ? "LinkedIn ✓" : "LinkedIn –"}`;
  return (
    <Card title="Resume & LinkedIn" collapsible isOpen={isOpen} actions={<span class="muted small">{status}</span>}>
      <ResumeFields />
      <hr />
      <LinkedinButton />
    </Card>
  );
}

export function ProfileTab() {
  const profile = useStored("profile");
  const resume = useStored("resume");
  return (
    <div class="stack">
      {resume !== undefined && <SourcesCard hasResume={!!resume} />}
      {/* remount when the stored profile changes (extraction, import) so the draft resyncs */}
      {profile && <ProfileEditor key={JSON.stringify(profile)} initial={profile} />}
      <AnswerBank />
    </div>
  );
}
