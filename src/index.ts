
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

const MAX_OPERATIONS = 100;

async function main(): Promise<void> {
  console.log("=== TimeTree → Google Calendar Sync ===\n");

  const config = loadConfig();

  console.log("Exporting events from TimeTree...");
  execFileSync(
    "timetree-exporter",
    [
      "-e", config.timetreeEmail,
      "-c", config.timetreeCalendarCode,
      "-o", config.icsFilePath,
    ],
    {
      env: {
        ...process.env,
        TIMETREE_PASSWORD: config.timetreePassword,
      },
      stdio: "inherit",
    }
  );

  if (!existsSync(config.icsFilePath)) {
    throw new Error("ICS file not found.");
  }

  const events = parseIcsFile(config.icsFilePath);

  if (events.length === 0) {
    throw new Error("Empty ICS export. Aborting.");
  }

  console.log(`TimeTree events: ${events.length}`);

  const gcal = new GCalClient(
    config.googleCredentials,
    config.googleCalendarId
  );

  const syncedEvents = await gcal.listSyncedEvents();
  console.log(`Google synced events: ${syncedEvents.length}`);

  const engine = new SyncEngine(gcal);
  const diff = engine.computeDiff(events, syncedEvents);

  console.log(
    `Pending: ${diff.toCreate.length} creates, ` +
    `${diff.toUpdate.length} updates, ` +
    `${diff.toDelete.length} deletions`
  );

  if (process.env.SYNC_DRY_RUN !== "false") {
    console.log("DRY RUN: no changes made.");
    return;
  }

  if (process.env.SYNC_ENABLE_WRITE !== "YES_I_APPROVE") {
    throw new Error("Write authorization missing.");
  }

  // Se procesan como máximo 100 operaciones por ejecución.
  // Las eliminaciones permanecen desactivadas.
  const toCreate = diff.toCreate.slice(0, MAX_OPERATIONS);

  const remainingCapacity =
    MAX_OPERATIONS - toCreate.length;

  const toUpdate = diff.toUpdate.slice(
    0,
    remainingCapacity
  );

  const batch = {
    toCreate,
    toUpdate,
    toDelete: [],
  };

  console.log(
    `Processing batch: ${toCreate.length} creates, ` +
    `${toUpdate.length} updates, 0 deletions`
  );

  const result = await engine.applyDiff(batch);

  console.log(
    `Completed: created=${result.created}, ` +
    `updated=${result.updated}, ` +
    `deleted=${result.deleted}, errors=${result.errors}`
  );

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("::error::Sync failed:", error);
  process.exitCode = 1;
});
