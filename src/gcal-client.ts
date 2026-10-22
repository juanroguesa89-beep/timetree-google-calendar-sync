import { google, type calendar_v3 } from "googleapis";
import { GoogleAuth } from "googleapis-common";
import type { CalendarEvent, SyncedEvent } from "./types.js";

const SYNC_TAG = "timetree-gcal-sync";

/** Google Calendar admite 11 colores de evento, no HEX arbitrarios. */
const CATEGORY_COLORS: Record<string, string> = {
  "BODAS/EVENTOS": "10",       // Basil
  "VIAJES": "7",              // Peacock
  "DEPORTE": "9",             // Blueberry
  "TRABAJO JUANITO": "8",     // Graphite
  "BASKET JUANI": "6",        // Tangerine
  "COSAS CASA / FURGOS": "3", // Grape
  "TRABAJO CRIS": "4",        // Flamingo
  "CITAS": "11",              // Tomato
  "GUARDIAS CRIS": "5",      // Banana
  "VACAS/FESTIVOS": "1",     // Lavender
};

export function getGoogleColorId(event: CalendarEvent): string | undefined {
  return CATEGORY_COLORS[event.category.trim().toUpperCase()];
}

export class GCalClient {
  private calendar: calendar_v3.Calendar;
  private calendarId: string;

  constructor(credentials: Record<string, unknown>, calendarId: string) {
    const auth = new GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
    this.calendar = google.calendar({ version: "v3", auth });
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
          events.push({
            googleEventId: item.id,
            timetreeUid: props.timetreeUid,
            lastModified: props.timetreeLastModified ?? "",
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
      requestBody: this.toGCalEvent(event),
    });
    return res.data.id!;
  }

  async updateEvent(googleEventId: string, event: CalendarEvent): Promise<void> {
    await this.calendar.events.patch({
      calendarId: this.calendarId,
      eventId: googleEventId,
      requestBody: this.toGCalEvent(event),
    });
  }

  async deleteEvent(googleEventId: string): Promise<void> {
    await this.calendar.events.delete({ calendarId: this.calendarId, eventId: googleEventId });
  }

  private toGCalEvent(event: CalendarEvent): calendar_v3.Schema$Event {
    const body: calendar_v3.Schema$Event = {
      summary: event.summary,
      description: event.description || undefined,
      location: event.location || undefined,
      colorId: getGoogleColorId(event),
      extendedProperties: {
        private: {
          syncedBy: SYNC_TAG,
          timetreeUid: event.uid,
          timetreeLastModified: event.lastModified?.toISOString() ?? "",
        },
      },
    };
    if (event.allDay) {
      body.start = { date: formatDate(event.start) };
      body.end = { date: formatDate(event.end) };
    } else {
  body.start = {
    dateTime: event.start.toISOString(),
    timeZone: "Europe/Madrid",
  };
  body.end = {
    dateTime: event.end.toISOString(),
    timeZone: "Europe/Madrid",
  };
}
    }
    if (event.recurrence.length > 0) body.recurrence = event.recurrence;
      const colorId = getGoogleColorId(event.category ?? "");

if (colorId) {
  body.colorId = colorId;
}
    return body;
  }
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function getGoogleColorId(category: string): string | undefined {
  const colors: Record<string, string> = {
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

  return colors[category.trim().toUpperCase()];
}
