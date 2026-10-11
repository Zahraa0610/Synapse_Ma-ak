"""Small admin commands for Ma'ak.

    python manage.py create-admin   Create the first Ministry of Public Health account
    python manage.py reset          Delete ALL data in the Firestore database
"""

import getpass
import sys

from werkzeug.security import generate_password_hash

from app import create_app
from app.extensions import db


def reset():
    answer = input("This deletes ALL Ma'ak data in Firestore. Type DELETE to continue: ")
    if answer.strip() != "DELETE":
        sys.exit("Cancelled.")
    db.drop_all()
    print("All data deleted.")


def create_admin():
    from app.models import User

    name = input("Full name: ").strip()
    email = input("Email: ").strip().lower()
    password = getpass.getpass("Password (8+ characters): ")
    if not name or not email or len(password) < 8:
        sys.exit("Name, email and a password of 8+ characters are required.")
    if User.query.filter_by(email=email).first():
        sys.exit("An account with this email already exists.")
    db.session.add(
        User(
            full_name=name,
            email=email,
            password_hash=generate_password_hash(password),
            role="ministry",
            verification_status="approved",
        )
    )
    db.session.commit()
    print(f"Ministry admin {email} created. They can approve doctors, NGOs and other Ministry staff.")


COMMANDS = {"create-admin": create_admin, "reset": reset}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    with create_app().app_context():
        COMMANDS[sys.argv[1]]()
