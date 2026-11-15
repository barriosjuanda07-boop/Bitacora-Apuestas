"""Descarga partidos de ESPN (de 4 días atrás a 10 adelante) y los guarda en partidos.json.

Lo corre GitHub Actions cada 15 minutos. Así la página lee los datos desde su propio
dominio y el navegador no bloquea la consulta (ESPN no permite CORS).
"""
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone

LEAGUES = [
    ("soccer", "eng.1", "Premier League", "Fútbol"),
    ("soccer", "esp.1", "LaLiga", "Fútbol"),
    ("soccer", "ita.1", "Serie A", "Fútbol"),
    ("soccer", "ger.1", "Bundesliga", "Fútbol"),
    ("soccer", "fra.1", "Ligue 1", "Fútbol"),
    ("soccer", "uefa.champions", "Champions League", "Fútbol"),
    ("soccer", "uefa.europa", "Europa League", "Fútbol"),
    ("soccer", "mex.1", "Liga MX", "Fútbol"),
    ("soccer", "usa.1", "MLS", "Fútbol"),
    ("soccer", "por.1", "Liga Portugal", "Fútbol"),
    ("soccer", "ned.1", "Eredivisie", "Fútbol"),
    ("soccer", "conmebol.libertadores", "Libertadores", "Fútbol"),
    ("soccer", "concacaf.champions", "Concachampions", "Fútbol"),
    ("basketball", "nba", "NBA", "Básquet"),
    ("football", "nfl", "NFL", "Fútbol americano"),
    ("baseball", "mlb", "MLB", "Béisbol"),
    ("hockey", "nhl", "NHL", "Hockey"),
    ("football", "college-football", "NCAA Football", "Fútbol americano"),
]
BASE = "https://site.api.espn.com/apis/site/v2/sports"
UA = {"User-Agent": "Mozilla/5.0 (bitacora-apuestas)"}


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def team(c):
    t = c.get("team") or {}
    logo = t.get("logo") or ((t.get("logos") or [{}])[0].get("href", ""))
    score = c.get("score")
    if isinstance(score, dict):
        score = score.get("displayValue")
    return {"name": t.get("displayName") or t.get("name", ""), "short": t.get("shortDisplayName") or t.get("name", ""),
            "abbr": t.get("abbreviation", ""), "loc": t.get("location", ""), "logo": logo, "score": score}


def parse(ev, sport, key, name, dep):
    comp = (ev.get("competitions") or [{}])[0]
    cs = comp.get("competitors") or []
    home = next((c for c in cs if c.get("homeAway") == "home"), cs[0] if cs else None)
    away = next((c for c in cs if c.get("homeAway") == "away"), cs[1] if len(cs) > 1 else None)
    if not home or not away:
        return None
    st = ((comp.get("status") or ev.get("status") or {}).get("type") or {})
    return {"id": str(ev.get("id")), "sport": sport, "league": key, "leagueName": name, "dep": dep,
            "date": comp.get("date") or ev.get("date"), "state": st.get("state"), "completed": bool(st.get("completed")),
            "detail": st.get("shortDetail") or st.get("detail") or "", "home": team(home), "away": team(away)}


def main():
    now = datetime.now(timezone.utc)
    rng = f"{(now - timedelta(days=4)):%Y%m%d}-{(now + timedelta(days=10)):%Y%m%d}"
    events, errors = [], []
    for sport, key, name, dep in LEAGUES:
        try:
            data = get(f"{BASE}/{sport}/{key}/scoreboard?dates={rng}&limit=500")
            for ev in data.get("events") or []:
                p = parse(ev, sport, key, name, dep)
                if p:
                    events.append(p)
        except Exception as e:  # una liga caída no detiene las demás
            errors.append(f"{key}: {e}")
        time.sleep(0.4)
    events.sort(key=lambda e: e["date"] or "")
    out = {"actualizado": now.isoformat(timespec="seconds"), "errores": errors, "eventos": events}
    with open("partidos.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(events)} partidos, {len(errors)} errores")
    for e in errors:
        print("  ", e)
    if not events:
        raise SystemExit("ESPN no devolvió partidos")


if __name__ == "__main__":
    main()
