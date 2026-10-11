"""Accounts: phone codes, sign-up, sign-in, the signed-in user, shelter names."""

import re
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, g, jsonify, request
from werkzeug.security import check_password_hash, generate_password_hash

from . import whatsapp
from .domain import CLINICAL, ROLES, aware, priority_for, shelter_public, user_public
from .extensions import db
from .http import as_bool, error, login_required, parse_date, payload, save_upload, token_for
from .models import InventoryItem, PhoneCode, Profile, Shelter, User

bp = Blueprint("auth", __name__)


@bp.post("/auth/register")
def register():
    data = payload()
    role = (data.get("role") or "").strip()
    full_name = (data.get("full_name") or "").strip()
    email = (data.get("email") or "").strip().lower() or None
    # A WhatsApp-verified phone number is required. Email is optional; a password is
    # only needed with an email (phone sign-in uses a WhatsApp code instead).
    phone = normalize_phone(data.get("phone"))
    password = data.get("password") or ""
    if role not in ROLES:
        return error("Choose a role", 400)
    if not full_name:
        return error("Enter your name", 400)
    if not phone:
        return error("Enter your phone number with the country code, e.g. +961 70 123 456", 400)
    if email and len(password) < 8:
        return error("To sign in with your email, choose a password of at least 8 characters", 400)
    if password and len(password) < 8:
        return error("Use at least 8 characters for the password", 400)
    if email and User.query.filter_by(email=email).first():
        return error("An account with this email already exists", 409)
    if phone and User.query.filter_by(phone=phone).first():
        return error("An account with this phone number already exists", 409)
    # The number must have been confirmed with a WhatsApp code in the last 10 minutes.
    phone_code = _latest_code(phone, "signup")
    if not phone_code or not phone_code.verified or aware(phone_code.expires_at) < _now():
        return error("Confirm your phone number with the WhatsApp code first", 400)

    # Volunteers identify themselves with a Lebanese ID or passport (no license).
    id_type = (data.get("id_document_type") or "").strip() or None
    id_number = (data.get("id_document_number") or "").strip() or None
    offers_driving = as_bool(data.get("offers_driving"))
    car_model = (data.get("car_model") or "").strip() or None
    car_plate = (data.get("car_plate") or "").strip() or None
    if role == "volunteer":
        if id_type not in {"lebanese_id", "passport"} or not id_number:
            return error("Enter your Lebanese ID or passport number", 400)
        if offers_driving and (not car_model or not car_plate):
            return error("Enter your car model and plate number", 400)

    # Only doctors, nurses and psychologists go through the license check.
    if role in CLINICAL:
        status = "documents_received"
    elif role in {"ministry", "ngo"}:
        status = "checking"
    else:
        status = "not_required"

    shelter_id = data.get("shelter_id") or None
    if shelter_id:
        shelter = db.session.get(Shelter, int(shelter_id))
        if not shelter:
            return error("That shelter is not registered", 400)
        shelter_id = shelter.id

    user = User(
        full_name=full_name,
        email=email,
        phone=phone,
        password_hash=generate_password_hash(password) if password else None,
        role=role,
        specialty=(data.get("specialty") or "").strip() or None,
        license_number=(data.get("license_number") or "").strip() or None,
        license_body=(data.get("license_body") or "").strip() or None,
        license_expires=parse_date(data.get("license_expires")),
        verification_status=status,
        helper_type=(data.get("helper_type") or "").strip() or None,
        shelter_id=shelter_id if role in {"shelter_coordinator", "caregiver"} else None,
        id_document_type=id_type if role == "volunteer" else None,
        id_document_number=id_number if role == "volunteer" else None,
        offers_driving=offers_driving if role == "volunteer" else False,
        car_model=car_model if role == "volunteer" and offers_driving else None,
        car_plate=car_plate if role == "volunteer" and offers_driving else None,
        car_seats=int(data.get("car_seats")) if role == "volunteer" and offers_driving and str(data.get("car_seats") or "").isdigit() else None,
        car_wheelchair=as_bool(data.get("car_wheelchair")) if role == "volunteer" and offers_driving else False,
    )
    user.phone_verified = True
    db.session.add(user)
    db.session.delete(phone_code)
    if role == "caregiver":
        # Every family account starts with a health passport for the person themselves.

        from .models import Profile

        db.session.add(
            Profile(
                owner_user_id=user.id,
                full_name=full_name,
                relationship="self",
                shelter_id=user.shelter_id,
                emergency_token=secrets.token_urlsafe(8),
            )
        )
    db.session.commit()
    return jsonify({"token": token_for(user), "user": user_public(user)}), 201


CODE_MINUTES = 10


RESEND_SECONDS = 60


MAX_ATTEMPTS = 5


PHONE_PATTERN = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone(raw):
    """'+961 70 123 456' -> '+96170123456'. Returns None if it is not a full international number."""
    phone = re.sub(r"[\s\-().]", "", raw or "")
    if phone.startswith("00"):
        phone = "+" + phone[2:]
    return phone if PHONE_PATTERN.match(phone) else None


def _now():
    return datetime.now(timezone.utc)


def _latest_code(phone, purpose):
    rows = PhoneCode.query.filter_by(phone=phone, purpose=purpose).order_by(PhoneCode.created_at.desc()).all()
    return rows[0] if rows else None


def _check_code(phone, purpose, code):
    """True if `code` matches the latest unexpired code. Counts wrong attempts."""
    row = _latest_code(phone, purpose)
    if not row or aware(row.expires_at) < _now() or row.attempts >= MAX_ATTEMPTS:
        return None
    if not check_password_hash(row.code_hash, (code or "").strip()):
        row.attempts += 1
        db.session.commit()
        return None
    return row


@bp.post("/auth/send-code")
def send_code():
    """Send a 6-digit code on WhatsApp. purpose = "signup" (new number) or "login"."""
    data = payload()
    purpose = (data.get("purpose") or "login").strip()
    if purpose not in {"signup", "login"}:
        return error("Unknown purpose", 400)
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return error("Enter your full phone number with the country code, e.g. +961 70 123 456", 400)

    existing = User.query.filter_by(phone=phone).first()
    if purpose == "signup" and existing:
        return error("An account with this phone number already exists. Sign in instead.", 409)
    generic = {"ok": True, "phone": phone, "message": "If this number has an account, we sent a code on WhatsApp."}
    if purpose == "login" and not existing:
        return jsonify(generic)  # do not reveal which numbers have accounts

    last = _latest_code(phone, purpose)
    if last and (_now() - aware(last.created_at)).total_seconds() < RESEND_SECONDS:
        return error("Please wait a minute before asking for another code.", 429)

    code = f"{secrets.randbelow(1_000_000):06d}"
    db.session.add(
        PhoneCode(
            phone=phone,
            purpose=purpose,
            code_hash=generate_password_hash(code),
            expires_at=_now() + timedelta(minutes=CODE_MINUTES),
        )
    )
    db.session.commit()
    try:
        channel = whatsapp.send_code(phone, code)
    except whatsapp.WhatsAppError as exc:
        return error(str(exc), 502)
    body = generic if purpose == "login" else {"ok": True, "phone": phone, "message": "We sent a code on WhatsApp."}
    body["channel"] = channel
    return jsonify(body)


@bp.post("/auth/verify-code")
def verify_code():
    """Check a sign-up code before the account is created."""
    data = payload()
    phone = normalize_phone(data.get("phone"))
    row = _check_code(phone, "signup", data.get("code")) if phone else None
    if not row:
        return error("The code is wrong or expired. Ask for a new one.", 400)
    row.verified = True
    db.session.commit()
    return jsonify({"ok": True, "phone": phone})


@bp.post("/auth/login")
def login():
    data = payload()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if email:
        user = User.query.filter_by(email=email).first()
        if not user or not user.password_hash or not check_password_hash(user.password_hash, password):
            return error("Email or password is incorrect", 401)
    elif data.get("phone"):
        phone = normalize_phone(data.get("phone"))
        user = User.query.filter_by(phone=phone).first() if phone else None
        row = _check_code(phone, "login", data.get("code")) if user else None
        if not row:
            return error("Phone number or code is incorrect", 401)
        db.session.delete(row)  # a code works once
        user.phone_verified = True
        db.session.commit()
    else:
        return error("Enter your email or phone number", 400)
    return jsonify({"token": token_for(user), "user": user_public(user)})


@bp.get("/auth/me")
@login_required()
def me():
    return jsonify({"user": user_public(g.user)})


@bp.post("/me/verification-file")
@login_required()
def upload_license():
    upload = request.files.get("file")
    try:
        saved = save_upload(upload)
    except ValueError as exc:
        return error(str(exc), 400)
    if not saved:
        return error("Choose a file", 400)
    g.user.license_file = saved["stored_name"]
    if g.user.role in CLINICAL and g.user.verification_status == "not_required":
        g.user.verification_status = "documents_received"
    db.session.commit()
    return jsonify({"user": user_public(g.user)})


@bp.get("/clinicians")
@login_required()
def clinicians():
    rows = (
        User.query.filter(User.role.in_(list(CLINICAL)), User.verification_status == "approved")
        .order_by(User.full_name.asc())
        .all()
    )
    return jsonify(
        {
            "clinicians": [
                {
                    "id": row.id,
                    "full_name": row.full_name,
                    "role": row.role,
                    "specialty": row.specialty,
                }
                for row in rows
            ]
        }
    )


@bp.get("/shelters/names")
def shelter_names():
    """Public list for the sign-up form: shelter names and regions only."""
    rows = Shelter.query.order_by(Shelter.name.asc()).all()
    return jsonify({"shelters": [{"id": row.id, "name": row.name, "region": row.region} for row in rows]})


@bp.get("/shelters")
@login_required()
def list_shelters():
    from .domain import priority_for, shelter_public
    from .models import InventoryItem

    rows = []
    for shelter in Shelter.query.order_by(Shelter.name.asc()).all():
        item = shelter_public(shelter)
        item["priority"] = priority_for(shelter) if g.user.role in {"ministry", "shelter_coordinator"} else None
        shortages = InventoryItem.query.filter_by(shelter_id=shelter.id, status="shortage").all()
        item["shortage_names"] = [row.item_name for row in shortages]
        item["equipment"] = [
            {"name": row.item_name, "status": row.status, "quantity": row.quantity}
            for row in InventoryItem.query.filter_by(shelter_id=shelter.id, is_equipment=True).all()
        ]
        rows.append(item)
    return jsonify({"shelters": rows})


@bp.patch("/users/<int:user_id>/shelter")
@login_required()
def assign_shelter(user_id):
    if g.user.id != user_id and g.user.role != "ministry":
        return error("You do not have access to this", 403)
    if g.user.role == "ministry" and g.user.verification_status != "approved":
        return error("This account is still under review", 403)
    user = db.session.get(User, user_id)
    if not user:
        return error("Account not found", 404)
    shelter = db.session.get(Shelter, int(payload().get("shelter_id") or 0))
    if not shelter:
        return error("That shelter is not registered", 400)
    user.shelter_id = shelter.id
    db.session.commit()
    return jsonify({"user": user_public(user)})
