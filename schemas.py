from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UserPublic(BaseModel):
    id: int
    username: str
    email: str
    is_vip: bool = False


class SystemStatusResponse(BaseModel):
    is_active: bool = True
    message: str = "Canlı sistem aktivdir"
    checked_at: datetime = Field(default_factory=datetime.utcnow)


class LandingStat(BaseModel):
    key: str
    label: str
    value: str
    description: Optional[str] = None
    icon: Optional[str] = None


class LandingStatsResponse(BaseModel):
    items: list[LandingStat]


class ProductCategory(BaseModel):
    id: int
    slug: str
    name: str
    description: Optional[str] = None
    image_url: Optional[str] = None
    is_active: bool = True
    sort_order: int = 0


class ProductCategoriesResponse(BaseModel):
    items: list[ProductCategory]
    total: int


class NavbarResponse(BaseModel):
    is_authenticated: bool
    user: Optional[UserPublic] = None
    login_label: str = "Giriş"
