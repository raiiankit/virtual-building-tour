"""Universal Building Model (UBM) — the single, format-independent source of truth.

Every supported input (raster / vector PDF / SVG / DXF / DWG / IFC / RVT→IFC) is
normalised into this one schema. All geometry is in **canonical metres**; a `scale`
(metres-per-source-unit) is captured so the 2D editor and 3D generator never guess.

Domain-driven: each element is a small value object. Nothing here depends on how the
file was parsed — that is the extractors' job (see backend/ubm/extractors)."""
from __future__ import annotations

from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

Point = List[float]          # [x, y] in metres
Polygon = List[Point]        # closed ring (first != last; closure implied)

UBM_VERSION = "ubm-1.0"


class Material(BaseModel):
    id: str
    name: str
    kind: str = "plaster"                      # plaster | wood | aluminium | glass | tile | marble | concrete | stone
    color: Optional[str] = None


class Dimension(BaseModel):
    id: str
    a: Point
    b: Point
    length_m: float
    label: Optional[str] = None


class Annotation(BaseModel):
    id: str
    text: str
    at: Point
    kind: str = "label"                        # label | note | room-name | dimension-text


class Room(BaseModel):
    id: str
    name: str
    type: str = "room"                         # bedroom | kitchen | bathroom | powder | utility | pantry | closet | store | foyer | hall | balcony | garage | stair | lift ...
    polygon: Polygon
    height_m: float = 2.9
    area_m2: float = 0.0
    floor: int = 0
    confidence: float = 0.7                     # 0..1 — rooms < 0.9 are flagged for review
    status: str = "detected"                    # detected | estimated | unknown | missing
    ocrText: Optional[str] = None               # raw label read from the drawing (never discarded)
    connectedRooms: List[str] = Field(default_factory=list)
    doors: List[str] = Field(default_factory=list)
    windows: List[str] = Field(default_factory=list)


class Wall(BaseModel):
    id: str
    startPoint: Point
    endPoint: Point
    length_m: float
    height_m: float = 2.9
    thickness_m: float = 0.12                   # 0.20 exterior / 0.12 interior
    exterior: bool = False
    material: str = "plaster"
    floor: int = 0
    connectedRooms: List[str] = Field(default_factory=list)


class Door(BaseModel):
    id: str
    position: Point
    rotation: float = 0.0                       # radians, along-wall orientation
    wallId: Optional[str] = None
    width_m: float = 0.9
    height_m: float = 2.1
    openingDirection: Literal["in", "out", "left", "right", "slide"] = "in"
    entrance: bool = False
    material: str = "wood"
    floor: int = 0


class Window(BaseModel):
    id: str
    position: Point
    wallId: Optional[str] = None
    width_m: float = 1.2
    height_m: float = 1.2
    sill_m: float = 0.9
    glassType: str = "clear"
    frameType: str = "aluminium"
    floor: int = 0


class Stair(BaseModel):
    id: str
    polygon: Polygon
    floor: int = 0
    direction: Optional[str] = None
    connectsTo: List[int] = Field(default_factory=list)   # floor levels


class Balcony(BaseModel):
    id: str
    polygon: Polygon
    floor: int = 0
    railing: bool = True
    connectedRooms: List[str] = Field(default_factory=list)


class Column(BaseModel):
    id: str
    at: Point
    width_m: float = 0.3
    depth_m: float = 0.3
    floor: int = 0


class Beam(BaseModel):
    id: str
    startPoint: Point
    endPoint: Point
    floor: int = 0


class Slab(BaseModel):
    id: str
    polygon: Polygon
    floor: int = 0
    thickness_m: float = 0.15
    kind: str = "floor"                         # floor | roof


class Floor(BaseModel):
    level: int
    name: str
    height_m: float = 3.0                       # floor-to-floor
    rooms: List[str] = Field(default_factory=list)   # room ids on this floor


class Building(BaseModel):
    id: str = "b1"
    name: str = "Building"
    type: str = "apartment"                     # apartment | villa
    floor_count: int = 1
    entrances: List[Point] = Field(default_factory=list)


class ProjectMeta(BaseModel):
    id: Optional[int] = None
    name: str = "Project"
    location: Optional[str] = None
    builder: Optional[str] = None


class UBMMetadata(BaseModel):
    version: str = UBM_VERSION
    source_format: str = "unknown"              # raster | vector-pdf | svg | dxf | dwg | ifc | rvt
    source_file: Optional[str] = None
    extractor: Optional[str] = None
    unit: str = "m"                             # display unit (canonical geometry is metres)
    scale_m_per_unit: float = 1.0               # source-unit → metres (px→m for raster)
    orientation_deg: float = 0.0
    bounds: Optional[Dict[str, float]] = None   # {minx, minz, maxx, maxz} metres
    confidence: float = 0.7
    extra: Dict[str, Any] = Field(default_factory=dict)


class UniversalBuildingModel(BaseModel):
    """One format-independent building. The single source of truth for 3D / tour / video."""
    project: ProjectMeta = Field(default_factory=ProjectMeta)
    building: Building = Field(default_factory=Building)
    floors: List[Floor] = Field(default_factory=list)
    rooms: List[Room] = Field(default_factory=list)
    walls: List[Wall] = Field(default_factory=list)
    doors: List[Door] = Field(default_factory=list)
    windows: List[Window] = Field(default_factory=list)
    stairs: List[Stair] = Field(default_factory=list)
    balconies: List[Balcony] = Field(default_factory=list)
    columns: List[Column] = Field(default_factory=list)
    beams: List[Beam] = Field(default_factory=list)
    slabs: List[Slab] = Field(default_factory=list)
    roof: Optional[Slab] = None
    materials: List[Material] = Field(default_factory=list)
    dimensions: List[Dimension] = Field(default_factory=list)
    annotations: List[Annotation] = Field(default_factory=list)
    metadata: UBMMetadata = Field(default_factory=UBMMetadata)


class ValidationIssue(BaseModel):
    level: Literal["blocking", "warning", "info"]
    code: str
    message: str
    element_id: Optional[str] = None


class ValidationReport(BaseModel):
    ok: bool
    blocking: int = 0
    warnings: int = 0
    issues: List[ValidationIssue] = Field(default_factory=list)
