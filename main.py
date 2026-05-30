from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import Boolean, Column, Integer, String, create_engine, select
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from schemas import (
    LandingStat,
    LandingStatsResponse,
    NavbarResponse,
    ProductCategoriesResponse,
    ProductCategory,
    SystemStatusResponse,
    UserPublic,
)

DATABASE_URL = "sqlite:///./zelix_topup.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, index=True, nullable=False)
    email = Column(String(190), unique=True, index=True, nullable=False)
    is_vip = Column(Boolean, default=False, nullable=False)


class ProductCategoryModel(Base):
    __tablename__ = "product_categories"

    id = Column(Integer, primary_key=True, index=True)
    slug = Column(String(80), unique=True, index=True, nullable=False)
    name = Column(String(120), nullable=False)
    description = Column(String(255), nullable=True)
    image_url = Column(String(500), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)


app = FastAPI(
    title="ZELIX TOPUP Home API",
    version="1.0.0",
    description="Oyun top-up platformasının ana səhifəsi üçün public FastAPI backend API strukturu.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    seed_placeholder_data()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def decode_jwt_placeholder(token: str) -> Optional[dict]:
    if token == "demo-token":
        return {"sub": "1"}
    return None


async def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
    db: Session = Depends(get_db),
) -> Optional[User]:
    if not authorization or not authorization.startswith("Bearer "):
        return None

    token = authorization.removeprefix("Bearer ").strip()
    payload = decode_jwt_placeholder(token)
    if not payload:
        return None

    user_id = payload.get("sub")
    if not user_id:
        return None

    return db.get(User, int(user_id))


def seed_placeholder_data() -> None:
    db = SessionLocal()
    try:
        demo_user = db.get(User, 1)
        if not demo_user:
            db.add(User(id=1, username="ZelixPlayer", email="player@zelix.az", is_vip=True))

        exists = db.execute(select(ProductCategoryModel.id).limit(1)).first()
        if not exists:
            db.add_all(
                [
                    ProductCategoryModel(
                        slug="pubg-mobile",
                        name="PUBG Mobile",
                        description="UC və oyun balansı top-up kateqoriyası.",
                        image_url="/assets/pubg-mobile.png",
                        is_active=True,
                        sort_order=1,
                    ),
                    ProductCategoryModel(
                        slug="free-fire",
                        name="Free Fire",
                        description="Diamond və hesab yükləmə kateqoriyası.",
                        image_url="/assets/free-fire.png",
                        is_active=True,
                        sort_order=2,
                    ),
                    ProductCategoryModel(
                        slug="roblox",
                        name="Roblox",
                        description="Robux və digital məhsullar.",
                        image_url="/assets/roblox.png",
                        is_active=True,
                        sort_order=3,
                    ),
                    ProductCategoryModel(
                        slug="call-of-duty-mobile",
                        name="Call of Duty Mobile",
                        description="CP paketləri və mobil oyun yükləmələri.",
                        image_url="/assets/call-of-duty-mobile.png",
                        is_active=True,
                        sort_order=4,
                    ),
                ]
            )
        db.commit()
    finally:
        db.close()


@app.get("/api/v1/system/status", response_model=SystemStatusResponse, tags=["Landing"])
def get_system_status() -> SystemStatusResponse:
    return SystemStatusResponse(is_active=True, message="Canlı sistem aktivdir")


@app.get("/api/v1/landing/stats", response_model=LandingStatsResponse, tags=["Landing"])
def get_landing_stats() -> LandingStatsResponse:
    return LandingStatsResponse(
        items=[
            LandingStat(
                key="happy_users",
                label="Məmnun istifadəçi",
                value="10.000+",
                description="ZELIX TOPUP istifadəçi icması",
                icon="users",
            ),
            LandingStat(
                key="load_speed",
                label="Yükləmə sürəti",
                value="1 saniyə",
                description="Sürətli top-up emal müddəti",
                icon="bolt",
            ),
            LandingStat(
                key="active_games",
                label="Aktiv oyun",
                value="25+",
                description="Populyar oyun kateqoriyaları",
                icon="gamepad",
            ),
            LandingStat(
                key="secure_payments",
                label="Təhlükəsiz ödəniş",
                value="100%",
                description="Qorunan istifadəçi əməliyyatları",
                icon="shield",
            ),
        ]
    )


@app.get("/api/v1/products/categories", response_model=ProductCategoriesResponse, tags=["Products"])
def get_product_categories(db: Session = Depends(get_db)) -> ProductCategoriesResponse:
    categories = db.execute(
        select(ProductCategoryModel)
        .where(ProductCategoryModel.is_active.is_(True))
        .order_by(ProductCategoryModel.sort_order.asc(), ProductCategoryModel.name.asc())
    ).scalars().all()

    items = [
        ProductCategory(
            id=category.id,
            slug=category.slug,
            name=category.name,
            description=category.description,
            image_url=category.image_url,
            is_active=category.is_active,
            sort_order=category.sort_order,
        )
        for category in categories
    ]
    return ProductCategoriesResponse(items=items, total=len(items))


@app.get("/api/v1/navbar", response_model=NavbarResponse, tags=["Landing"])
def get_navbar_state(
    current_user: Optional[User] = Depends(get_current_user),
) -> NavbarResponse:
    if not current_user:
        return NavbarResponse(is_authenticated=False, user=None, login_label="Giriş")

    return NavbarResponse(
        is_authenticated=True,
        user=UserPublic(
            id=current_user.id,
            username=current_user.username,
            email=current_user.email,
            is_vip=current_user.is_vip,
        ),
        login_label="Profil",
    )
