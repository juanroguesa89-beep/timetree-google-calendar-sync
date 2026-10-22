
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { parseIcsFile } from "./ics-parser.js";
import { GCalClient } from "./gcal-client.js";
import { SyncEngine } from "./sync-engine.js";

async function main(): Promise<void> {
  console.log("=== TimeTree → Google Calendar Sync ===\n");

  const config = loadConfig();
  console.log("Config loaded.");

  console.log("Exporting events from TimeTree...");
  exportFromTimeTree(config);

  if (!existsSync(config.icsFilePath)) {
    throw new Error(`ICS file not found: ${config.icsFilePath}`);
  }

  console.log("Parsing ICS file...");
  const events = parseIcsFile(config.icsFilePath);

  console.log(`  Found ${events.length} events in ICS.`);

  if (events.length === 0) {
    throw new Error("Empty ICS export: synchronization aborted.");
  }

  const withoutCategory = events.filter(
    (e) => !e.category || !e.color
  ).length;

  if (withoutCategory > 0) {
    console.warn(
      `  WARNING: ${withoutCategory} events lack category or color.`
    );
  }

  const gcal = new GCalClient(
    config.googleCredentials,
    config.googleCalendarId
  );

  console.log("Fetching synced events from Google Calendar...");
  const syncedEvents = await gcal.listSyncedEvents();

  console.log(
    `  Found ${syncedEvents.length} synced events in Google Calendar.`
  );

  const engine = new SyncEngine(gcal);
  const diff = engine.computeDiff(events, syncedEvents);

  console.log(
    `\nFull diff: ${diff.toCreate.length} to create, ` +
    `${diff.toUpdate.length} to update, ` +
    `${diff.toDelete.length} to delete`
  );

  const dryRun = process.env.SYNC_DRY_RUN !== "false";
  const writeAuthorized =
    process.env.SYNC_ENABLE_WRITE === "YES_I_APPROVE";

  // La simulación está activada por defecto.
  if (dryRun) {
    console.log("\nDRY RUN: no changes were made.");
    return;
  }

  // Segunda protección independiente.
  if (!writeAuthorized) {
    throw new Error(
      "Writes blocked: SYNC_ENABLE_WRITE must be YES_I_APPROVE."
    );
  }

  // Solo se permiten pruebas de hasta 5 operaciones.
  if (process.env.SYNC_TEST_MODE !== "true") {
    throw new Error(
      "Writes blocked: SYNC_TEST_MODE must be true."
    );
  }

  // Priorizar una creación recurrente, si existe.
  const recurring = diff.toCreate.find(
    (event) => event.recurrence.length > 0
  );

  const selectedCreates = recurring
    ? [
        recurring,
        ...diff.toCreate
          .filter((event) => event.uid !== recurring.uid)
          .slice(0, 4),
      ]
    : diff.toCreate.slice(0, 5);

  const selectedUpdates =
    selectedCreates.length === 0
      ? diff.toUpdate.slice(0, 5)
      : [];

  const testDiff = {
    toCreate: selectedCreates,
    toUpdate: selectedUpdates,
    toDelete: [],
  };

  console.log("\n=== CONTROLLED TEST ===");
  console.log(
    `Creating: ${testDiff.toCreate.length}, ` +
    `updating: ${testDiff.toUpdate.length}, deleting: 0`
  );

  for (const event of testDiff.toCreate) {
    console.log(
      `TEST CREATE: ${event.summary} | ` +
      `category=${event.category} | ` +
      `recurring=${event.recurrence.length > 0}`
    );
  }

  for (const item of testDiff.toUpdate) {
    console.log(
      `TEST UPDATE: ${item.source.summary} | ` +
      `category=${item.source.category}`
    );
  }

  const result = await engine.applyDiff(testDiff);

  console.log(
    `\nTest complete: created=${result.created}, ` +
    `updated=${result.updated}, deleted=${result.deleted}, ` +
    `errors=${result.errors}`
  );

  if (result.errors > 0) {
    process.exitCode = 1;
  }
}

function exportFromTimeTree(config: {
  timetreeEmail: string;
  timetreePassword: string;
  timetreeCalendarCode: string;
  icsFilePath: string;
}): void {
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
}

main().catch((err) => {
  console.error("::error::Sync failed:", err);
  process.exitCode = 1;
});
