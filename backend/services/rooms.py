"""Architectural room understanding (BRD 8). Turns a raw label — read by OCR
from the drawing, entered by the user in the Rooms step, or produced by the
template fallback — into a canonical room *type* with a confidence score.

This is what lets the system name a space "Master Bedroom" / "Kitchen" / "Garage"
instead of "Room 1 / Room 2 / Room 3", and it is the key the 3D furnisher uses to
decide what belongs in each room. Pure standard library — no model download."""
from __future__ import annotations

import re
from typing import Optional, Tuple

from .. import config

def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower())).strip()


# Pre-compute (type, normalised-keyword) pairs sorted longest-first so that
# "master bedroom" wins over "bed" and "master bath" wins over "bath".
_KEYWORDS: list[tuple[str, str]] = sorted(
    ((rtype, _norm(kw)) for rtype, spec in config.ROOM_CATALOG.items() for kw in spec["keywords"]),
    key=lambda pair: len(pair[1]), reverse=True,
)


def classify(label: str) -> Tuple[str, float]:
    """Map a free-text label to (room_type, confidence 0..1).

    Confidence reflects how cleanly the label matched: an exact catalog keyword
    scores high; a substring match a little lower; no match falls back to the
    generic "room" type at low confidence."""
    text = _norm(label)
    if not text:
        return "room", 0.30
    for rtype, kw in _KEYWORDS:
        if text == kw:
            return rtype, 0.98
    for rtype, kw in _KEYWORDS:
        # word-boundary match so "bath" hits "master bath" but not "bathrobe"
        if re.search(rf"\b{re.escape(kw)}\b", text):
            return rtype, 0.90
    for rtype, kw in _KEYWORDS:
        if kw in text:
            return rtype, 0.78
    return "room", 0.35


def name_for(room_type: str, label: Optional[str] = None, index: Optional[int] = None) -> str:
    """A clean architect-style room name from the catalog (Master Bedroom, Kitchen,
    Garage…), disambiguating repeats (Bedroom, Bedroom 2) via the caller's index.
    OCR text is used to pick the *type*, not the visible name, so noisy reads like
    "Family A {" or "9' Ceiling" never surface as a room name."""
    base = config.room_display_name(room_type)
    return f"{base} {index}" if index and index > 1 else base


# Typical relative footprint of each room type, used only as a *last-resort*
# heuristic namer when there is no OCR text and no user-entered rooms — so even a
# blind detection yields plausible architect-style names instead of "Room N".
_HEURISTIC_ORDER = [
    ("living_room", 1.00), ("kitchen", 0.62), ("master_bedroom", 0.80),
    ("bedroom", 0.70), ("dining", 0.55), ("bathroom", 0.30), ("utility", 0.28),
]


def heuristic_types(n: int) -> list[str]:
    """Guess a sensible mix of room types for n unlabelled rooms (largest first)."""
    seq = [t for t, _ in _HEURISTIC_ORDER]
    out, i = [], 0
    while len(out) < n:
        out.append(seq[i] if i < len(seq) else "bedroom")
        i += 1
    return out[:n]


def annotate_rooms(rooms: list[dict], hints: Optional[list[dict]] = None) -> list[dict]:
    """Give every detected room a real type, name and confidence.

    Priority of the naming signal (best first):
      1. a label already on the room (e.g. read by OCR from the drawing),
      2. a user-entered room from the project's Rooms step (matched by area order),
      3. a geometry heuristic so we still avoid generic "Room N".
    Rooms are mutated in place and returned."""
    hints = list(hints or [])
    # biggest rooms first — pairs most reliably with how people list/enter rooms
    ordered = sorted(range(len(rooms)), key=lambda i: rooms[i].get("w", 0) * rooms[i].get("h", 0),
                     reverse=True)
    heur = heuristic_types(len(rooms))
    seen: dict[str, int] = {}
    for rank, idx in enumerate(ordered):
        r = rooms[idx]
        label = r.get("label") or r.get("name")
        # a bare auto-generated "Room 3" is not a real label
        if label and re.match(r"^room\s*\d*$", label.strip().lower()):
            label = None
        source_conf = None
        if not label and rank < len(hints):
            label = hints[rank].get("name")
            if hints[rank].get("room_type"):
                r["type"] = hints[rank]["room_type"]
        if label:
            rtype, conf = classify(label)
            if r.get("type") in (None, "", "room"):
                r["type"] = rtype
            source_conf = conf
        else:
            r["type"] = r.get("type") if r.get("type") not in (None, "", "room") else heur[rank]
            source_conf = 0.55            # geometry-only guess
            label = None
        rtype = r["type"]
        seen[rtype] = seen.get(rtype, 0) + 1
        r["name"] = name_for(rtype, label, seen[rtype])
        r["floor_material"] = config.room_floor_material(rtype)
        # keep the strongest confidence we can justify
        r["confidence"] = round(max(r.get("confidence", 0) or 0, source_conf or 0.5), 2)
    return rooms
