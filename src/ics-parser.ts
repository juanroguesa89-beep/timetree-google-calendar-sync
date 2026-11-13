
import { readFileSync } from "node:fs";
import ical, { type VEvent, type ParameterValue } from "node-ical";
import type { CalendarEvent } from "./types.js";

/**
 * Extrae las etiquetas y colores directamente del ICS.
 * No depende de cómo node-ical interpreta estas propiedades.
 */
function readLabels(
  content: string
): Map<string, { category: string; color: string }> {
  const labels = new Map<
    string,
    { category: string; color: string }
  >();

  for (const block of content.split("BEGIN:VEVENT").slice(1)) {
    const section = block.split("END:VEVENT", 1)[0];

    const uid = /^UID:(.*)$/m.exec(section)?.[1]?.trim();

    if (!uid) continue;

    const category =
      /^CATEGORIES:(.*)$/m.exec(section)?.[1]?.trim() ?? "";

    const color =
      /^COLOR:(#[0-9a-fA-F]{6})\s*$/m
        .exec(section)?.[1]?.toLowerCase() ?? "";

    labels.set(uid, { category, color });
  }

  return labels;
}

/**
 * Lee el archivo ICS y devuelve los eventos
 * preparados para Google Calendar.
 */
export function parseIcsFile(
  filePath: string
): CalendarEvent[] {
  const content = readFileSync(filePath, "utf-8")
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "");

  if (!content.startsWith("BEGIN:VCALENDAR\n") || !content.trimEnd().endsWith("END:VCALENDAR")) throw new Error("Invalid or truncated ICS.");
  // Fail closed: never silently lose recurrence exceptions or cancellations.
  if (/^(RECURRENCE-ID|RELATED-TO|RRULE|RDATE|EXDATE|STATUS:CANCELLED)[;:]/m.test(content) || /^STATUS:CANCELLED$/m.test(content)) throw new Error("Unsupported recurrence or cancellation; no changes applied.");
  if (/^DT(?:START|END):\d{8}T\d{6}$/m.test(content)) throw new Error("Floating date-time without timezone.");
  const parsed = ical.sync.parseICS(content);
  const labels = readLabels(content);
  const dayDates = new Map<string, {start: Date; end: Date}>();
  for (const block of content.split("BEGIN:VEVENT").slice(1)) {
    const uid = /^UID:(.*)$/m.exec(block)?.[1]?.trim();
    const start = /^DTSTART;VALUE=DATE:(\d{4})(\d{2})(\d{2})$/m.exec(block);
    const end = /^DTEND;VALUE=DATE:(\d{4})(\d{2})(\d{2})$/m.exec(block);
    if (uid && start && end) dayDates.set(uid, {
      start: new Date(`${start[1]}-${start[2]}-${start[3]}T00:00:00Z`),
      end: new Date(`${end[1]}-${end[2]}-${end[3]}T00:00:00Z`),
    });
  }
  const events: CalendarEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;

    const vevent = component as VEvent;

    if (!vevent.uid || !vevent.start || !vevent.end || !Number.isFinite(+vevent.start) || !Number.isFinite(+vevent.end) || +vevent.end <= +vevent.start) throw new Error("Invalid event; no changes applied.");

    const allDay = vevent.datetype === "date";
    const label = labels.get(vevent.uid);

    events.push({
      uid: vevent.uid,
      summary: parameterValueToString(vevent.summary),
      description: parameterValueToString(vevent.description),
      location: parameterValueToString(vevent.location),
      start: allDay ? dayDates.get(vevent.uid)?.start ?? new Date(NaN) : new Date(vevent.start),
      end: allDay ? dayDates.get(vevent.uid)?.end ?? new Date(NaN) : new Date(vevent.end),
      allDay,
      startTimeZone: (vevent.start as Date & { tz?: string }).tz || "UTC",
      endTimeZone: (vevent.end as Date & { tz?: string }).tz || "UTC",
      recurrence: extractRecurrence(vevent),
      lastModified: vevent.lastmodified
        ? new Date(vevent.lastmodified)
        : null,
      category: label?.category ?? "",
      color: label?.color ?? "",
    });
  }

  if (events.some(e => !Number.isFinite(+e.start) || !Number.isFinite(+e.end))) throw new Error("Invalid calendar date.");
  if (events.length !== (content.match(/^BEGIN:VEVENT$/gm) ?? []).length) throw new Error("ICS event count mismatch.");
  return events;
}

/**
 * Convierte los valores del ICS a texto.
 */
function parameterValueToString(
  value: ParameterValue | undefined
): string {
  if (!value) return "";

  if (typeof value === "string") {
    return value;
  }

  return value.val;
}

/**
 * Extrae únicamente las reglas RRULE.
 * Evita enviar DTSTART dentro de recurrence,
 * que Google Calendar puede rechazar.
 */
function extractRecurrence(vevent: VEvent): string[] {
  if (!vevent.rrule) return [];

  const raw = vevent.rrule.toString();

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("RRULE:"));
}
