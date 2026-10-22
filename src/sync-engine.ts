import { getGoogleColorId, type GCalClient } from "./gcal-client.js";
import type { CalendarEvent, SyncDiff, SyncResult, SyncedEvent } from "./types.js";

export class SyncEngine {
  constructor(private gcal: GCalClient) {}

  computeDiff(sourceEvents: CalendarEvent[], syncedEvents: SyncedEvent[]): SyncDiff {
    const syncedMap = new Map<string, SyncedEvent>();
    for (const se of syncedEvents) syncedMap.set(se.timetreeUid, se);
    const sourceUids = new Set<string>();
    const toCreate: CalendarEvent[] = [];
    const toUpdate: SyncDiff["toUpdate"] = [];

    for (const event of sourceEvents) {
      sourceUids.add(event.uid);
      const existing = syncedMap.get(event.uid);
      if (!existing) {
        toCreate.push(event);
      } else {
        const sourceModified = event.lastModified?.toISOString() ?? "";
        const desiredColor = getGoogleColorId(event);
        const colorChanged = desiredColor !== undefined && desiredColor !== existing.colorId;
        if (sourceModified !== existing.lastModified || colorChanged) {
          toUpdate.push({ source: event, googleEventId: existing.googleEventId });
        }
      }
    }

    const toDelete: SyncDiff["toDelete"] = [];
    for (const se of syncedEvents) {
      if (!sourceUids.has(se.timetreeUid)) {
        toDelete.push({ googleEventId: se.googleEventId, timetreeUid: se.timetreeUid });
      }
    }
    return { toCreate, toUpdate, toDelete };
  }

  async applyDiff(diff: SyncDiff): Promise<SyncResult> {
    const result: SyncResult = { created: 0, updated: 0, deleted: 0, errors: 0 };
    for (const event of diff.toCreate) {
      try {
        await this.gcal.createEvent(event);
        result.created++;
        console.log(`  Created: ${event.summary}`);
      } catch (err) {
        result.errors++;
        console.error(`  Failed to create "${event.summary}":`, err);
      }
    }
    for (const { source, googleEventId } of diff.toUpdate) {
      try {
        await this.gcal.updateEvent(googleEventId, source);
        result.updated++;
        console.log(`  Updated: ${source.summary}`);
      } catch (err) {
        result.errors++;
        console.error(`  Failed to update "${source.summary}":`, err);
      }
    }
    // Las eliminaciones solo se habilitan explícitamente tras validar el primer ensayo.
    if (process.env.ALLOW_DELETIONS === "true") {
      for (const { googleEventId, timetreeUid } of diff.toDelete) {
        try {
          await this.gcal.deleteEvent(googleEventId);
          result.deleted++;
          console.log(`  Deleted: ${timetreeUid}`);
        } catch (err) {
          result.errors++;
          console.error(`  Failed to delete "${timetreeUid}":`, err);
        }
      }
    } else if (diff.toDelete.length) {
      console.log(`  Skipped ${diff.toDelete.length} deletions (ALLOW_DELETIONS is not true).`);
    }
    return result;
  }
}
