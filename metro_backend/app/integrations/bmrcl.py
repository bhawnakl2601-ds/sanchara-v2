"""BMRCL adapters. As of writing no public BMRCL GTFS-Realtime endpoint is documented, so these stay AUTH_REQUIRED until URLs (and, if needed, an
API-key header name + key) are supplied via environment variables. Parsing needs `gtfs-realtime-bindings`; without it we report ERROR rather than fake data.
NOTE: the parsing paths below are written against the GTFS-Realtime spec but have NOT been exercised against a live BMRCL feed (none is accessible)."""
from __future__ import annotations
import datetime as dt
from ..core.config import settings
from .base import Adapter, Result

def _pb():
    try: from google.transit import gtfs_realtime_pb2 as pb; return pb
    except Exception: return None

class _RT(Adapter):
    def __init__(self): self.api_key = settings.BMRCL_API_KEY
    def parse(self, result: Result): 
        pb = _pb()
        if pb is None: return None, Result('ERROR', 'Install gtfs-realtime-bindings to decode GTFS-Realtime (pip install gtfs-realtime-bindings).')
        feed = pb.FeedMessage(); feed.ParseFromString(result.payload); ts = dt.datetime.fromtimestamp(feed.header.timestamp, dt.timezone.utc).isoformat(timespec='seconds') if feed.header.timestamp else None
        return (feed, ts), None

class BmrclAlerts(_RT):
    source_id = 'bmrcl_gtfs_rt_alerts'; env_help = 'BMRCL_GTFS_RT_ALERTS_URL'; env_url = settings.BMRCL_GTFS_RT_ALERTS_URL
    def entities(self):
        """Return (Result, [alert dicts]). Route ids in the supplied static GTFS equal SANCHARA line ids; stop ids equal station ids."""
        r = self.fetch()
        if r.status != 'CONNECTED': return r, []
        parsed, err = self.parse(r)
        if err: return err, []
        feed, ts = parsed; out = []
        for e in feed.entity:
            if not e.HasField('alert'): continue
            a = e.alert; txt = lambda ts_: (ts_.translation[0].text if ts_.translation else '')
            out.append(dict(feed_id=e.id, title=txt(a.header_text) or 'Service alert', description=txt(a.description_text), url=txt(a.url) or None, lines=sorted({i.route_id for i in a.informed_entity if i.route_id}), stations=sorted({i.stop_id for i in a.informed_entity if i.stop_id}),
                            effect=a.effect, cause=a.cause, start=a.active_period[0].start if a.active_period else None, end=a.active_period[0].end if a.active_period else None))
        return Result('CONNECTED', f'{len(out)} alerts', data_timestamp=ts), out

class BmrclTrips(_RT):
    source_id = 'bmrcl_gtfs_rt_trips'; env_help = 'BMRCL_GTFS_RT_TRIPS_URL'; env_url = settings.BMRCL_GTFS_RT_TRIPS_URL
    def delays(self):
        """Delay (minutes) = feed-supplied arrival delay. Only real TripUpdates produce delays; the timetable is never used to infer them."""
        r = self.fetch()
        if r.status != 'CONNECTED': return r, []
        parsed, err = self.parse(r)
        if err: return err, []
        feed, ts = parsed; out = []
        for e in feed.entity:
            if e.HasField('trip_update'):
                for u in e.trip_update.stop_time_update:
                    if u.HasField('arrival') and u.arrival.HasField('delay'): out.append(dict(line=e.trip_update.trip.route_id, station=u.stop_id, delay_min=round(u.arrival.delay / 60, 1)))
        return Result('CONNECTED', f'{len(out)} stop updates', data_timestamp=ts), out

class BmrclVehicles(_RT):
    source_id = 'bmrcl_gtfs_rt_vehicles'; env_help = 'BMRCL_GTFS_RT_VEHICLES_URL'; env_url = settings.BMRCL_GTFS_RT_VEHICLES_URL
class Bmtc(Adapter):
    source_id = 'bmtc_transit'; env_help = 'BMTC_API_URL (+ BMTC_API_KEY, BMTC_API_KEY_HEADER)'; env_url = settings.BMTC_API_URL
    def __init__(self): self.api_key = settings.BMTC_API_KEY
class OpenCity(Adapter): source_id = 'opencity'; env_help = 'OPENCITY_URL'; env_url = settings.OPENCITY_URL
