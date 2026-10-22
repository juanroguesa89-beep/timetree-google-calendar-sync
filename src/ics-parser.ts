
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

  const parsed = ical.sync.parseICS(content);
  const labels = readLabels(content);
  const events: CalendarEvent[] = [];

  for (const component of Object.values(parsed)) {
    if (!component || component.type !== "VEVENT") continue;

    const vevent = component as VEvent;

    if (!vevent.end) continue;

    const allDay = vevent.datetype === "date";
    const label = labels.get(vevent.uid);

    events.push({
      uid: vevent.uid,
      summary: parameterValueToString(vevent.summary),
      description: parameterValueToString(vevent.description),
      location: parameterValueToString(vevent.location),
      start: new Date(vevent.start),
      end: new Date(vevent.end),
      allDay,
      recurrence: extractRecurrence(vevent),
      lastModified: vevent.lastmodified
        ? new Date(vevent.lastmodified)
        : null,
      category: label?.category ?? "",
      color: label?.color ?? "",
    });
  }

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
