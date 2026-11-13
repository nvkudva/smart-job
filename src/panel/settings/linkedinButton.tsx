import { useState } from "preact/hooks";
import * as linkedinImport from "../../profile/linkedinImport.ts";
import * as aiClient from "../shared/aiClient.ts";
import { Button, Card, ErrorNote } from "../shared/controls.tsx";
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
    <Card title="LinkedIn">
      <div class="stack tight">
        <p class="muted small">Opens your LinkedIn profile in a background tab (you must be logged in), reads a few pages, then closes it. Your resume and typed values are never overwritten.</p>
        <div class="row wrap">
          <Button isBusy={importProfile.isBusy} onClick={() => void importProfile.run()}>
            {importedAt ? "Refresh from LinkedIn" : "Import from LinkedIn"}
          </Button>
          {importProfile.isBusy && status && <span class="muted small">{status}</span>}
        </div>
        {!!importedAt && <span class="muted small">Last imported {new Date(importedAt).toLocaleString()}</span>}
        <ErrorNote message={importProfile.error} />
      </div>
    </Card>
  );
}
