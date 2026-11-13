import { LinkedinButton } from "./linkedinButton.tsx";
import { ProfileEditor } from "./profileEditor.tsx";
import { ResumeSection } from "./resumeSection.tsx";
import { useStored } from "../shared/useStored.ts";

export function ProfileTab() {
  const profile = useStored("profile");
  return (
    <div class="stack">
      <ResumeSection />
      <LinkedinButton />
      {/* remount when the stored profile changes (extraction, import) so the draft resyncs */}
      {profile && <ProfileEditor key={JSON.stringify(profile)} initial={profile} />}
    </div>
  );
}
