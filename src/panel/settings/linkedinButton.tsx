import { useState } from "preact/hooks";
import * as linkedinImport from "../../profile/linkedinImport.ts";
import * as aiClient from "../shared/aiClient.ts";
import { Button, ErrorNote } from "../shared/controls.tsx";
import { useStored } from "../shared/useStored.ts";
import { useTask } from "../shared/useTask.ts";

export function runImport(onStatus: linkedinImport.StatusListener): Promise<void> {
  return aiClient.withClient((client) => linkedinImport.run(client, onStatus));
}

export function LinkedinButton() {
  const importedAt = useStored("linkedinImportedAt");
  const [status, setStatus] = useState("");
  const importProfile = useTask(async () => {
    await runImport(setStatus);
    setStatus("");
  });
  return (
    <div class="stack tight">
      <div class="row between">
        <strong>LinkedIn</strong>
        <Button isBusy={importProfile.isBusy} onClick={() => void importProfile.run()}>
          {importedAt ? "Refresh" : "Import"}
        </Button>
      </div>
      <span class="muted small">
        {importProfile.isBusy && status
          ? status
          : importedAt
            ? `Last imported ${new Date(importedAt).toLocaleString()}`
            : "Reads your profile in a background tab (you must be logged in). Your resume and typed values are never overwritten."}
      </span>
      <ErrorNote message={importProfile.error} />
    </div>
  );
}
