"""Seed a ready-to-use demo account so you can log in immediately.
Run:  python -m backend.seed
Login: demo@vbt.local / demo1234  (email pre-verified)"""
from .database import SessionLocal, init_db
from .models import Organisation, User
from .security import hash_password


def run():
    init_db()
    db = SessionLocal()
    try:
        if db.query(User).filter(User.email == "demo@vbt.local").first():
            print("Demo user already exists: demo@vbt.local / demo1234")
            return
        org = Organisation(name="Demo Studio")
        db.add(org)
        db.flush()
        db.add(User(organisation_id=org.id, full_name="Demo Designer", company="Demo Studio",
                    email="demo@vbt.local", password_hash=hash_password("demo1234"),
                    role="company_admin", email_verified=True))
        db.commit()
        print("Seeded demo user -> demo@vbt.local / demo1234")
    finally:
        db.close()


if __name__ == "__main__":
    run()
