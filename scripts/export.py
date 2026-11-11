"""Harden the existing exporter without changing its authentication.
No event data is printed by this wrapper (the caller captures library output).
"""
import os
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from timetree_exporter.__main__ import select_calendar
from timetree_exporter.exporter import Exporter

# All library calls must have a timeout and reject unsuccessful HTTP responses.
_original_request = requests.Session.request

def request(self, method, url, **kwargs):
    kwargs.setdefault("timeout", (10, 40))
    response = _original_request(self, method, url, **kwargs)
    response.raise_for_status()
    return response

requests.Session.request = request
_original_init = requests.Session.__init__

def init(self):
    _original_init(self)
    adapter = HTTPAdapter(max_retries=Retry(
        total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"], respect_retry_after_header=True,
    ))
    self.mount("https://", adapter)

requests.Session.__init__ = init
calendar = select_calendar(os.environ["TIMETREE_EMAIL"], os.environ["TIMETREE_PASSWORD"], os.environ["TIMETREE_CALENDAR_CODE"])
original_events = calendar.api.get_events

def get_events(*args, **kwargs):
    events = original_events(*args, **kwargs)
    if not isinstance(events, list):
        raise ValueError("Invalid source collection")
    seen = set()
    for event in events:
        uid = event.get("uuid")
        if not uid or uid in seen:
            raise ValueError("Missing or duplicate source ID")
        seen.add(uid)
        if any(key not in event for key in ("note", "location", "recurrences")):
            raise ValueError("Incomplete source content")
        # Exporter can omit or flatten these fields. Fail before conversion.
        if event.get("recurrences") or event.get("recurring_uuid") or event.get("parent_id"):
            raise ValueError("Unsupported recurring source")
        for key in ("title", "start_at", "end_at", "all_day", "start_timezone", "end_timezone", "updated_at", "created_at"):
            if event.get(key) is None:
                raise ValueError("Incomplete source record")
    return events

calendar.api.get_events = get_events
Exporter(calendar, os.environ.get("ICS_FILE_PATH", "/tmp/timetree.ics")).export()
