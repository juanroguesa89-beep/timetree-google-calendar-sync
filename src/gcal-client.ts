import { createHash } from "node:crypto";

import { google, type calendar_v3 } from "googleapis";
import { GoogleAuth } from "googleapis-common";
import type { CalendarEvent, SyncedEvent } from "./types.js";

const SYNC_TAG = "timetree-gcal-sync";
const SYNC_VERSION = "2";
const VERSION_SUFFIX = "|category-v2";

const CATEGORY_COLORS: Record<string, string> = {
  "BODAS/EVENTOS": "10",
  "VIAJES": "7",
  "DEPORTE": "9",
  "TRABAJO JUANITO": "8",
  "BASKET JUANI": "6",
  "COSAS CASA / FURGOS": "3",
  "TRABAJO CRIS": "4",
  "CITAS": "11",
  "GUARDIAS CRIS": "5",
  "VACAS/FESTIVOS": "1",
};

export function getGoogleColorId(
  event: CalendarEvent
): string | undefined {
  return CATEGORY_COLORS[
    (event.category ?? "").trim().toUpperCase()
  ];
}

export function getSourceSyncVersion(
  event: CalendarEvent
): string {
  return createHash("sha256").update(JSON.stringify([event.summary, event.description, event.location, event.start.toISOString(), event.end.toISOString(), event.allDay, event.startTimeZone ?? "UTC", event.endTimeZone ?? "UTC", event.recurrence, event.category])).digest("hex");
}

export class GCalClient {
  private calendar: calendar_v3.Calendar;
  private calendarId: string;

  constructor(
    credentials: Record<string, unknown>,
    calendarId: string
  ) {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar.events"],
    });

    this.calendar = google.calendar({
      version: "v3",
      auth,
      timeout: 30000, retry: true, retryConfig: { retry: 3 },
    });

    this.calendarId = calendarId;
  }

  async listSyncedEvents(): Promise<SyncedEvent[]> {
    const events: SyncedEvent[] = [];
    let pageToken: string | undefined;

    do {
      const res = await this.calendar.events.list({
        calendarId: this.calendarId,
        privateExtendedProperty: [`syncedBy=${SYNC_TAG}`],
        maxResults: 2500,
        pageToken,
        showDeleted: false,
        singleEvents: false,
      });

      for (const item of res.data.items ?? []) {
        const props = item.extendedProperties?.private ?? {};

        if (props.timetreeUid && item.id) {
          const modified = props.timetreeLastModified ?? "";

          const versionedModified =
            props.syncSchemaVersion === SYNC_VERSION
              ? modified + VERSION_SUFFIX
              : modified;

          events.push({
            googleEventId: item.id,
            timetreeUid: props.timetreeUid,
            lastModified: props.contentHash ?? versionedModified,
            colorId: item.colorId ?? "",
          });
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return events;
  }

  async createEvent(event: CalendarEvent): Promise<string> {
    const res = await this.calendar.events.insert({
      calendarId: this.calendarId,
      requestBody: { ...this.toGCalEvent(event), id: createHash("sha256").update(event.uid).digest("hex") },
    });

    if (!res.data.id) {
      throw new Error("Google Calendar returned no event ID.");
    }

    return res.data.id;
  }

  async updateEvent(
    googleEventId: string,
    event: CalendarEvent
  ): Promise<void> {
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId: googleEventId,
      requestBody: this.toGCalEvent(event),
    });
  }

  async deleteEvent(googleEventId: string): Promise<void> {
    await this.calendar.events.delete({
      calendarId: this.calendarId,
      eventId: googleEventId,
    });
  }

  private toGCalEvent(
    event: CalendarEvent
  ): calendar_v3.Schema$Event {
    const category = (event.category ?? "").trim();

    const description = [
      event.description,
      category ? `Categoría TimeTree: ${category}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const body: calendar_v3.Schema$Event = {
      summary: event.summary,
      description: description || "",
      location: event.location || "",
      colorId: getGoogleColorId(event) ?? null,

      extendedProperties: {
        private: {
          syncedBy: SYNC_TAG,
          contentHash: getSourceSyncVersion(event),
          timetreeUid: event.uid,
          timetreeLastModified:
            event.lastModified?.toISOString() ?? "",
          syncSchemaVersion: SYNC_VERSION,
        },
      },
    };

    if (event.allDay) {
      body.start = { date: formatDate(event.start) };
      body.end = { date: formatDate(event.end) };
    } else {
      body.start = {
        dateTime: event.start.toISOString(),
        timeZone: event.startTimeZone ?? "UTC",
      };

      body.end = {
        dateTime: event.end.toISOString(),
        timeZone: event.endTimeZone ?? "UTC",
      };
    }

    body.recurrence = event.recurrence;

    return body;
  }
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}
