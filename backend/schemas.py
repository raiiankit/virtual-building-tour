"""Pydantic request/response schemas. Kept lightweight; complex nested forms
(building/floor/room) accept flexible dicts so the dynamic apartment/villa forms
(BRD BLD-003) can evolve without schema churn."""
from typing import Optional, Any
from pydantic import BaseModel


# ---- auth ----
class RegisterIn(BaseModel):
    full_name: str
    company: Optional[str] = None
    email: str
    mobile: Optional[str] = None
    password: str


class LoginIn(BaseModel):
    email: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    token: str
    password: str


# ---- projects ----
class ProjectIn(BaseModel):
    name: str
    building_type: Optional[str] = None      # apartment | villa
    location: Optional[str] = None
    property_name: Optional[str] = None
    builder: Optional[str] = None
    description: Optional[str] = None
    unit: Optional[str] = "m"                 # m | mm | cm | ft | in (BLD-002)


class ProjectOut(BaseModel):
    id: int
    name: str
    building_type: Optional[str]
    location: Optional[str]
    status: str
    unit: Optional[str] = "m"
    preview_image: Optional[str] = None

    class Config:
        from_attributes = True


# ---- generic nested payloads ----
class BuildingIn(BaseModel):
    width_m: Optional[float] = None
    length_m: Optional[float] = None
    total_height_m: Optional[float] = None
    floor_to_floor_m: Optional[float] = 3.0
    floor_count: Optional[int] = 1
    basement: Optional[bool] = False
    terrace: Optional[bool] = False
    entrances: Optional[int] = 1
    wings: Optional[int] = 1
    parking_type: Optional[str] = None
    parking_spaces: Optional[int] = 0
    features: Optional[dict] = None


class FloorIn(BaseModel):
    level: int
    name: Optional[str] = None
    height_m: Optional[float] = 3.0
    layout_type: Optional[str] = "unique"


class RoomIn(BaseModel):
    floor_id: int
    name: Optional[str] = None
    room_type: Optional[str] = None
    number: Optional[str] = None
    length_m: Optional[float] = None
    width_m: Optional[float] = None
    height_m: Optional[float] = 2.7
    door_count: Optional[int] = 1
    window_count: Optional[int] = 1
    connected_rooms: Optional[list] = None


class ApprovePlanIn(BaseModel):
    floor_id: Optional[int] = None
    vectors: dict                    # edited walls/rooms/doors/windows
    scale_m_per_px: float = 0.02
    unit: Optional[str] = None       # calibrated display unit (BLD-002/EDT-004)


class TourIn(BaseModel):
    scenes: Optional[list] = None
    branding: Optional[dict] = None
    settings: Optional[dict] = None
    access_level: Optional[str] = "private"


class RenderIn(BaseModel):
    ratio: str = "16:9"
    resolution: str = "1080p"


class Msg(BaseModel):
    detail: str
    data: Optional[Any] = None
