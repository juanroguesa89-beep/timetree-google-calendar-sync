
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, appendFileSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

// Máximo de operaciones por ejecución automática.
const MAX_OPERATIONS = 250;
let stage = "configuration";

async function main(): Promise<void> {
  console.log("=== TimeTree → Google Calendar Sync ===\n");

  const config = loadConfig();

  console.log("Exporting events from TimeTree...");

  stage = "source-export";
  rmSync(config.icsFilePath, { force: true });
  execFileSync(
    "python",
    ["scripts/export.py"],
    {
      env: {
        ...process.env,
        TIMETREE_PASSWORD: config.timetreePassword,
        ICS_FILE_PATH: config.icsFilePath,
        TIMETREE_EXPORTER_DEVELOPER: "0",
      },
      stdio: "pipe",
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    }
  );

  if (!existsSync(config.icsFilePath)) {
    throw new Error("ICS file not found.");
  }

  console.log("Parsing ICS file...");

  stage = "source-validation";
  const events = parseIcsFile(config.icsFilePath);

  if (events.length === 0) {
    throw new Error(
      "Empty ICS export. Synchronization aborted."
    );
  }

  console.log(`TimeTree events: ${events.length}`);

  const withoutCategory = events.filter(
    (event) => !event.category || !event.color
  ).length;

  if (withoutCategory > 0) {
    console.warn(
      `WARNING: ${withoutCategory} events lack category or color.`
    );
  }

  const gcal = new GCalClient(
    config.googleCredentials,
    config.googleCalendarId
  );

  console.log("Fetching synced events from Google Calendar...");

  stage = "destination-read";
  const syncedEvents = await gcal.listSyncedEvents();

  console.log(
    `Google synced events: ${syncedEvents.length}`
  );

  const engine = new SyncEngine(gcal);

  stage = "planning";
  const diff = engine.computeDiff(
    events,
    syncedEvents
  );

  console.log(
    `Pending: ${diff.toCreate.length} creates, ` +
    `${diff.toUpdate.length} updates, ` +
    `${diff.toDelete.length} deletions`
  );

  // Simulación activada por defecto.
  if (process.env.SYNC_DRY_RUN !== "false") {
    report(0, 0, 0, events.length + diff.toDelete.length, 0);
    console.log("DRY RUN: no changes made.");
    return;
  }

  // Autorización adicional para modificar Google Calendar.
  if (
    process.env.SYNC_ENABLE_WRITE !== "YES_I_APPROVE"
  ) {
    throw new Error(
      "Writes blocked: authorization missing."
    );
  }

  if (diff.toCreate.length + diff.toUpdate.length > MAX_OPERATIONS) throw new Error("Operation limit exceeded; no writes applied.");

  // Limitar el número de operaciones por ejecución.
  const toCreate = diff.toCreate.slice(
    0,
    MAX_OPERATIONS
  );

  const remainingCapacity =
    MAX_OPERATIONS - toCreate.length;

  const toUpdate = diff.toUpdate.slice(
    0,
    remainingCapacity
  );

  // Nunca eliminar eventos automáticamente.
  const batch = {
    toCreate,
    toUpdate,
    toDelete: [],
  };

  console.log("\n=== AUTOMATIC SYNC BATCH ===");

  console.log(
    `Processing batch: ${toCreate.length} creates, ` +
    `${toUpdate.length} updates, 0 deletions`
  );

  if (
    toCreate.length === 0 &&
    toUpdate.length === 0
  ) {
    report(0, 0, 0, events.length + diff.toDelete.length, 0);
    console.log("Calendar is up to date.");
    return;
  }

  stage = "writing";
  const result = await engine.applyDiff(batch);

  console.log(
    `\nCompleted: created=${result.created}, ` +
    `updated=${result.updated}, ` +
    `deleted=${result.deleted}, ` +
    `errors=${result.errors}`
  );

  report(result.created, result.updated, result.deleted, events.length - diff.toCreate.length - diff.toUpdate.length + diff.toDelete.length, result.errors);

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`::error::Synchronization aborted at ${stage}; sensitive error details suppressed.`);
  report(0, 0, 0, 0, 1);
  process.exitCode = 1;
});

function report(created: number, updated: number, deleted: number, skipped: number, errors: number): void {
  const summary = `created=${created}, updated=${updated}, deleted=${deleted}, skipped=${skipped}, errors=${errors}`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${summary}\n`);
}
