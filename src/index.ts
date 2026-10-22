
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

// Máximo de operaciones por ejecución automática.
const MAX_OPERATIONS = 250;

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

  console.log("Parsing ICS file...");

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

  const syncedEvents = await gcal.listSyncedEvents();

  console.log(
    `Google synced events: ${syncedEvents.length}`
  );

  const engine = new SyncEngine(gcal);

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
    console.log("Calendar is up to date.");
    return;
  }

  const result = await engine.applyDiff(batch);

  console.log(
    `\nCompleted: created=${result.created}, ` +
    `updated=${result.updated}, ` +
    `deleted=${result.deleted}, ` +
    `errors=${result.errors}`
  );

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("::error::Sync failed:", error);
  process.exitCode = 1;
});
