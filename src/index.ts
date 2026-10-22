import { execSync } from "node:child_process";
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
  if (!existsSync(config.icsFilePath)) throw new Error(`ICS file not found: ${config.icsFilePath}`);

  console.log("Parsing ICS file...");
  const events = parseIcsFile(config.icsFilePath);
  console.log(`  Found ${events.length} events in ICS.`);
  if (events.length === 0) throw new Error("Empty ICS export: synchronization aborted.");
  const withoutCategory = events.filter((e) => !e.category || !e.color).length;
  if (withoutCategory) console.warn(`  WARNING: ${withoutCategory} events lack category or color.`);

  const gcal = new GCalClient(config.googleCredentials, config.googleCalendarId);
  console.log("Fetching synced events from Google Calendar...");
  const syncedEvents = await gcal.listSyncedEvents();
  console.log(`  Found ${syncedEvents.length} synced events in Google Calendar.`);

  const engine = new SyncEngine(gcal);
  const diff = engine.computeDiff(events, syncedEvents);
  console.log(`\nDiff: ${diff.toCreate.length} to create, ${diff.toUpdate.length} to update, ${diff.toDelete.length} to delete`);

  // Seguridad: el modo prueba está ACTIVADO por defecto.
  if (process.env.SYNC_DRY_RUN !== "false") {
    console.log("\nDRY RUN: no changes were made. Set SYNC_DRY_RUN=false to apply.");
    console.log("Deletions remain disabled unless ALLOW_DELETIONS=true.");
    return;
  }

  if (diff.toCreate.length === 0 && diff.toUpdate.length === 0 && diff.toDelete.length === 0) {
    console.log("\nNo changes to sync.");
    return;
  }
if (process.env.SYNC_DRY_RUN !== "false") {
  console.log("\nDRY RUN: simulación completada. No se ha modificado Google Calendar.");
  return;
}
  console.log("\nApplying changes...");
  const result = await engine.applyDiff(diff);
  console.log(`\nSync complete: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, errors=${result.errors}`);
  if (result.errors > 0) process.exitCode = 1;
}

function exportFromTimeTree(config: {
  timetreeEmail: string;
  timetreePassword: string;
  timetreeCalendarCode: string;
  icsFilePath: string;
}): void {
  const cmd = [
    "timetree-exporter",
    "-e", config.timetreeEmail,
    "-c", config.timetreeCalendarCode,
    "-o", config.icsFilePath,
  ].join(" ");
  execSync(cmd, {
    env: { ...process.env, TIMETREE_PASSWORD: config.timetreePassword },
    stdio: "inherit",
  });
}

main().catch((err) => {
  console.error("::error::Sync failed:", err);
  process.exitCode = 1;
});
