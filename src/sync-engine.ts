
import {
  getGoogleColorId,
  getSourceSyncVersion,
  type GCalClient,
} from "./gcal-client.js";

import type {
  CalendarEvent,
  SyncDiff,
  SyncResult,
  SyncedEvent,
} from "./types.js";

export class SyncEngine {
  constructor(private gcal: GCalClient) {}

  computeDiff(
    sourceEvents: CalendarEvent[],
    syncedEvents: SyncedEvent[]
  ): SyncDiff {
    const syncedMap = new Map<string, SyncedEvent>();

    for (const event of syncedEvents) {
      if (syncedMap.has(event.timetreeUid)) throw new Error("Duplicate destination UID; manual review required.");
      syncedMap.set(event.timetreeUid, event);
    }

    const sourceUids = new Set<string>();
    const toCreate: CalendarEvent[] = [];
    const toUpdate: SyncDiff["toUpdate"] = [];

    for (const event of sourceEvents) {
      if (sourceUids.has(event.uid)) throw new Error("Duplicate source UID.");
      sourceUids.add(event.uid);

      const existing = syncedMap.get(event.uid);

      if (!existing) {
        toCreate.push(event);
        continue;
      }

      const sourceModified =
        getSourceSyncVersion(event);

      const desiredColor = getGoogleColorId(event);

      const colorChanged =
        desiredColor !== undefined &&
        desiredColor !== existing.colorId;

      const eventChanged =
        sourceModified !== existing.lastModified;

      if (eventChanged || colorChanged) {
        toUpdate.push({
          source: event,
          googleEventId: existing.googleEventId,
        });
      }
    }

    const toDelete: SyncDiff["toDelete"] = [];

    for (const event of syncedEvents) {
      if (!sourceUids.has(event.timetreeUid)) {
        toDelete.push({
          googleEventId: event.googleEventId,
          timetreeUid: event.timetreeUid,
        });
      }
    }

    return {
      toCreate,
      toUpdate,
      toDelete,
    };
  }

  async applyDiff(diff: SyncDiff): Promise<SyncResult> {
    if (
      process.env.SYNC_DRY_RUN !== "false" ||
      process.env.SYNC_ENABLE_WRITE !== "YES_I_APPROVE"
    ) {
      console.log("DRY RUN: no changes made.");

      return {
        created: 0,
        updated: 0,
        deleted: 0,
        errors: 0,
      };
    }

    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      errors: 0,
    };

    for (const event of diff.toCreate) {
      try {
        await this.gcal.createEvent(event);
        result.created++;

      } catch (error) {
        result.errors++;
        console.error("Create failed; details suppressed for privacy.");
      }
    }

    for (const item of diff.toUpdate) {
      try {
        await this.gcal.updateEvent(
          item.googleEventId,
          item.source
        );

        result.updated++;

      } catch (error) {
        result.errors++;
        console.error("Update failed; details suppressed for privacy.");
      }
    }

    // Las eliminaciones están desactivadas por seguridad.
    if (diff.toDelete.length > 0) {
      console.log(
        `Skipped ${diff.toDelete.length} deletions.`
      );
    }

    return result;
  }
}
