"""Authentication & accounts — BRD 7.1 (AUTH-001..006)."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, Organisation
from ..schemas import RegisterIn, LoginIn, TokenOut, Msg, ForgotPasswordIn, ResetPasswordIn
from ..security import (hash_password, verify_password, create_token, current_user,
                       create_scoped_token, decode_scoped_token)
from ..utils import audit, token_hex

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=Msg)
def register(body: RegisterIn, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == body.email.lower()).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    org = Organisation(name=body.company or f"{body.full_name}'s workspace")
    db.add(org)
    db.flush()
    # first user of a workspace is its company admin
    user = User(
        organisation_id=org.id, full_name=body.full_name, company=body.company,
        email=body.email.lower(), mobile=body.mobile,
        password_hash=hash_password(body.password),
        role="company_admin", verify_token=token_hex(),
    )
    db.add(user)
    db.commit()
    audit(db, user.id, "register", "user", user.id)
    # Email verification is required before AI processing (AUTH-002). In this local
    # build we return the token instead of sending an email.
    return Msg(detail="Registered. Verify email before generating projects.",
               data={"verify_token": user.verify_token, "user_id": user.id})


@router.post("/verify", response_model=Msg)
def verify_email(token: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.verify_token == token).first()
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid verification token")
    user.email_verified = True
    user.verify_token = None
    db.commit()
    return Msg(detail="Email verified. You can now create and process projects.")


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        # generic error — do not reveal which part failed (BRD AUTH-003)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    audit(db, user.id, "login", "user", user.id)
    return TokenOut(access_token=create_token(user.id), role=user.role, full_name=user.full_name)


@router.post("/forgot-password", response_model=Msg)
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.lower()).first()
    # never reveal whether the email exists (AUTH-003)
    data = {}
    if user:
        # 1-hour, scope-limited reset token. This local build returns it instead of
        # emailing a reset link (same pattern as register's verify_token).
        data = {"reset_token": create_scoped_token(user.id, "pwreset", 3600)}
        audit(db, user.id, "forgot_password", "user", user.id)
    return Msg(detail="If that email is registered, a password-reset link has been created.", data=data)


@router.post("/reset-password", response_model=Msg)
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    uid = decode_scoped_token(body.token, "pwreset")
    user = db.get(User, uid) if uid else None
    if not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")
    if len(body.password) < 8:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password must be at least 8 characters")
    user.password_hash = hash_password(body.password)
    db.commit()
    audit(db, user.id, "reset_password", "user", user.id)
    return Msg(detail="Password updated. You can now sign in.")


@router.get("/me", response_model=Msg)
def me(user: User = Depends(current_user)):
    return Msg(detail="ok", data={
        "id": user.id, "full_name": user.full_name, "email": user.email,
        "role": user.role, "email_verified": user.email_verified,
    })
