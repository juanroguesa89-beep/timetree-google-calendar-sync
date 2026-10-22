/** Evento procedente de TimeTree Exporter */
export interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  allDay: boolean;
  recurrence: string[];
  lastModified: Date | null;
  category: string;
  color: string;
}

export interface SyncedEvent {
  googleEventId: string;
  timetreeUid: string;
  lastModified: string;
  colorId: string;
}

export interface SyncDiff {
  toCreate: CalendarEvent[];
  toUpdate: { source: CalendarEvent; googleEventId: string }[];
  toDelete: { googleEventId: string; timetreeUid: string }[];
}

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  errors: number;
}

export interface Config {
  timetreeEmail: string;
  timetreePassword: string;
  timetreeCalendarCode: string;
  googleCalendarId: string;
  googleCredentials: Record<string, unknown>;
  icsFilePath: string;
}
