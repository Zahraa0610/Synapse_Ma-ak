"""Family / caregiver: health passport, care needs, appointments, donation requests."""

import secrets

from flask import Blueprint, g, jsonify, request

from ..domain import age_years, can_write_passport, criticality_for, iso, profile_public, shelter_public
from ..extensions import db
from ..http import error, login_required, parse_date, parse_dt, payload, save_upload
from ..models import (
    Appointment,
    Attachment,
    Dependency,
    DialysisSeat,
    DialysisSession,
    Donation,
    MedicalEntry,
    PersonalSupply,
    Pregnancy,
    Profile,
    Relocation,
    Shelter,
)
from ..serializers import (
    REGIONS,
    announcement_json,
    appointment_json,
    donation_json,
    entry_json,
    notices_for,
    passport_payload,
    profile_name,
    seat_json,
)

bp = Blueprint("family", __name__)


DEPENDENCY_KINDS = ["oxygen", "electricity", "ventilator", "concentrator", "suction", "feeding", "other"]


SUPPLY_CATEGORIES = ["food", "formula", "sanitary", "specialized_nutrition", "other"]


def _own(profile):
    return profile and profile.owner_user_id == g.user.id


@bp.get("/profiles/<int:profile_id>/care")
@login_required()
def care(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile) and g.user.role not in {"shelter_coordinator", "doctor", "nurse"}:
        return error("You do not have access to this care record", 403)
    if g.user.role == "shelter_coordinator" and profile.shelter_id != g.user.shelter_id:
        return error("You do not have access to this care record", 403)
    return jsonify(_care_payload(profile))


def _care_payload(profile):
    pregnancy = Pregnancy.query.filter_by(profile_id=profile.id).first()
    shelters = Shelter.query.filter_by(has_backup_power=True).order_by(Shelter.electricity_hours.desc()).all()
    return {
        "profile": profile_public(profile),
        "criticality": criticality_for(profile),
        "dependencies": [_dependency(item) for item in Dependency.query.filter_by(profile_id=profile.id).all()],
        "supplies": [_supply(item) for item in PersonalSupply.query.filter_by(profile_id=profile.id).all()],
        "dialysis": [_dialysis(item) for item in DialysisSession.query.filter_by(profile_id=profile.id).all()],
        "seats": [seat_json(item) for item in DialysisSeat.query.order_by(DialysisSeat.seats_available.desc()).all()],
        "pregnancy": _pregnancy(pregnancy),
        "backup_shelters": [shelter_public(item) for item in shelters],
        "relocations": [
            {"id": item.id, "destination_shelter_id": item.destination_shelter_id, "status": item.status}
            for item in Relocation.query.filter_by(profile_id=profile.id).all()
        ],
    }


def _dependency(item):
    return {
        "id": item.id,
        "kind": item.kind,
        "device_name": item.device_name,
        "supply_description": item.supply_description,
        "supply_level_percent": item.supply_level_percent,
        "hours_remaining": item.hours_remaining,
        "notes": item.notes,
    }


def _supply(item):
    return {
        "id": item.id,
        "item_name": item.item_name,
        "category": item.category,
        "quantity_note": item.quantity_note,
        "status": item.status,
    }


def _dialysis(item):
    return {
        "id": item.id,
        "facility_name": item.facility_name,
        "scheduled_at": iso(item.scheduled_at),
        "status": item.status,
        "seat_note": item.seat_note,
    }


def _pregnancy(item):
    if not item:
        return None
    return {
        "id": item.id,
        "weeks": item.weeks,
        "due_date": iso(item.due_date),
        "risk_level": item.risk_level,
        "risk_notes": item.risk_notes,
        "next_appointment": iso(item.next_appointment),
    }


@bp.post("/profiles/<int:profile_id>/dependencies")
@login_required({"caregiver"})
def add_dependency(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile):
        return error("You do not have access to this profile", 403)
    data = payload()
    kind = (data.get("kind") or "").strip()
    if kind not in DEPENDENCY_KINDS:
        return error("Choose the kind of medical dependency", 400)
    if kind == "other" and not (data.get("device_name") or "").strip():
        return error("Write the name of the device", 400)
    item = Dependency(
        profile_id=profile.id,
        kind=kind,
        device_name=(data.get("device_name") or "").strip() or None,
        supply_description=(data.get("supply_description") or "").strip() or None,
        supply_level_percent=_optional_int(data.get("supply_level_percent")),
        hours_remaining=_optional_int(data.get("hours_remaining")),
        notes=(data.get("notes") or "").strip() or None,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"dependency": _dependency(item), "criticality": criticality_for(profile)}), 201


@bp.delete("/dependencies/<int:item_id>")
@login_required({"caregiver"})
def delete_dependency(item_id):
    item = db.session.get(Dependency, item_id)
    profile = db.session.get(Profile, item.profile_id) if item else None
    if not item or not _own(profile):
        return error("You do not have access to this record", 403)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True, "criticality": criticality_for(profile)})


@bp.post("/profiles/<int:profile_id>/supplies")
@login_required({"caregiver"})
def add_supply(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile):
        return error("You do not have access to this profile", 403)
    data = payload()
    name = (data.get("item_name") or "").strip()
    category = (data.get("category") or "food").strip()
    status = (data.get("status") or "ok").strip()
    if not name or category not in SUPPLY_CATEGORIES or status not in {"ok", "low", "shortage"}:
        return error("Enter the supply, its category, and whether you still have it", 400)
    item = PersonalSupply(
        profile_id=profile.id,
        item_name=name,
        category=category,
        quantity_note=(data.get("quantity_note") or "").strip() or None,
        status=status,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"supply": _supply(item)}), 201


@bp.patch("/supplies/<int:item_id>")
@login_required({"caregiver"})
def update_supply(item_id):
    item = db.session.get(PersonalSupply, item_id)
    profile = db.session.get(Profile, item.profile_id) if item else None
    if not item or not _own(profile):
        return error("You do not have access to this record", 403)
    data = payload()
    if data.get("status") in {"ok", "low", "shortage"}:
        item.status = data.get("status")
    if "quantity_note" in data:
        item.quantity_note = (data.get("quantity_note") or "").strip() or None
    db.session.commit()
    return jsonify({"supply": _supply(item), "criticality": criticality_for(profile)})


@bp.delete("/supplies/<int:item_id>")
@login_required({"caregiver"})
def delete_supply(item_id):
    item = db.session.get(PersonalSupply, item_id)
    profile = db.session.get(Profile, item.profile_id) if item else None
    if not item or not _own(profile):
        return error("You do not have access to this record", 403)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True})


@bp.post("/profiles/<int:profile_id>/dialysis")
@login_required({"caregiver"})
def add_dialysis(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile):
        return error("You do not have access to this profile", 403)
    data = payload()
    facility = (data.get("facility_name") or "").strip()
    when = parse_dt(data.get("scheduled_at"))
    status = (data.get("status") or "scheduled").strip()
    if not facility or not when or status not in {"scheduled", "completed", "missed"}:
        return error("Enter the dialysis center, date, and status", 400)
    item = DialysisSession(
        profile_id=profile.id,
        facility_name=facility,
        scheduled_at=when,
        status=status,
        seat_note=(data.get("seat_note") or "").strip() or None,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"session": _dialysis(item), "criticality": criticality_for(profile)}), 201


@bp.patch("/dialysis/<int:item_id>")
@login_required({"caregiver"})
def update_dialysis(item_id):
    item = db.session.get(DialysisSession, item_id)
    profile = db.session.get(Profile, item.profile_id) if item else None
    if not item or not _own(profile):
        return error("You do not have access to this record", 403)
    status = (payload().get("status") or "").strip()
    if status not in {"scheduled", "completed", "missed"}:
        return error("Choose scheduled, completed, or missed", 400)
    item.status = status
    db.session.commit()
    return jsonify({"session": _dialysis(item), "criticality": criticality_for(profile)})


@bp.put("/profiles/<int:profile_id>/pregnancy")
@login_required({"caregiver"})
def save_pregnancy(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile):
        return error("You do not have access to this profile", 403)
    data = payload()
    try:
        weeks = int(data.get("weeks"))
    except (TypeError, ValueError):
        return error("Enter the pregnancy stage in weeks", 400)
    risk = (data.get("risk_level") or "routine").strip()
    if risk not in {"routine", "high"}:
        return error("Mark the pregnancy routine or high-risk", 400)
    item = Pregnancy.query.filter_by(profile_id=profile.id).first()
    if not item:
        item = Pregnancy(profile_id=profile.id, weeks=weeks, risk_level=risk)
        db.session.add(item)
    item.weeks = weeks
    item.risk_level = risk
    item.risk_notes = (data.get("risk_notes") or "").strip() or None
    from ..http import parse_date

    item.due_date = parse_date(data.get("due_date"))
    item.next_appointment = parse_dt(data.get("next_appointment"))
    db.session.commit()
    return jsonify({"pregnancy": _pregnancy(item)})


@bp.delete("/profiles/<int:profile_id>/pregnancy")
@login_required({"caregiver"})
def delete_pregnancy(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not _own(profile):
        return error("You do not have access to this profile", 403)
    item = Pregnancy.query.filter_by(profile_id=profile.id).first()
    if item:
        db.session.delete(item)
        db.session.commit()
    return jsonify({"ok": True})


def _optional_int(value):
    if value is None or value == "":
        return None
    return int(value)


ENTRY_TYPES = ["condition", "allergy", "medication", "operation", "lab", "report", "vaccine", "note"]


def _owned(profile):
    return profile.owner_user_id == g.user.id


@bp.get("/home")
@login_required()
def home():
    profiles = Profile.query.filter_by(owner_user_id=g.user.id).order_by(Profile.id.asc()).all()

    announcements = notices_for(g.user, limit=6)
    upcoming = []
    for profile in profiles:
        for session in DialysisSession.query.filter_by(profile_id=profile.id, status="scheduled").all():
            upcoming.append(
                {
                    "kind": "dialysis",
                    "profile_id": profile.id,
                    "who": profile.full_name,
                    "when": iso(session.scheduled_at),
                    "where": session.facility_name,
                }
            )
        pregnancy = Pregnancy.query.filter_by(profile_id=profile.id).first()
        if pregnancy and pregnancy.next_appointment:
            upcoming.append(
                {
                    "kind": "prenatal",
                    "profile_id": profile.id,
                    "who": profile.full_name,
                    "when": iso(pregnancy.next_appointment),
                    "where": "Prenatal appointment",
                }
            )
        for appointment in Appointment.query.filter_by(profile_id=profile.id).all():
            upcoming.append(
                {
                    "kind": appointment.kind,
                    "profile_id": profile.id,
                    "who": profile.full_name,
                    "when": iso(appointment.scheduled_at),
                    "where": appointment.facility,
                    "appointment_id": appointment.id,
                }
            )
    return jsonify(
        {
            "profiles": [profile_public(profile) for profile in profiles],
            "announcements": [announcement_json(item) for item in announcements],
            "upcoming": upcoming,
        }
    )


@bp.post("/profiles")
@login_required({"caregiver"})
def create_profile():
    data = payload()
    name = (data.get("full_name") or "").strip()
    if not name:
        return error("Enter a name", 400)
    shelter_id = data.get("shelter_id") or g.user.shelter_id
    if shelter_id and not db.session.get(Shelter, int(shelter_id)):
        return error("That shelter is not registered", 400)

    profile = Profile(
        owner_user_id=g.user.id,
        full_name=name,
        relationship=(data.get("relationship") or "other").strip(),
        date_of_birth=parse_date(data.get("date_of_birth")),
        sex=(data.get("sex") or "").strip() or None,
        blood_type=(data.get("blood_type") or "").strip() or None,
        shelter_id=int(shelter_id) if shelter_id else None,
        disability=str(data.get("disability", "")).lower() in {"1", "true", "yes", "on"},
        disability_notes=(data.get("disability_notes") or "").strip() or None,
        emergency_contact_name=(data.get("emergency_contact_name") or "").strip() or None,
        emergency_contact_phone=(data.get("emergency_contact_phone") or "").strip() or None,
        emergency_token=secrets.token_urlsafe(8),
    )
    db.session.add(profile)
    db.session.commit()
    return jsonify({"profile": profile_public(profile)}), 201


@bp.patch("/profiles/<int:profile_id>")
@login_required()
def update_profile(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile or not _owned(profile):
        return error("You do not have access to this profile", 403)
    data = payload()
    for field in (
        "full_name",
        "relationship",
        "sex",
        "blood_type",
        "disability_notes",
        "emergency_contact_name",
        "emergency_contact_phone",
    ):
        if field in data and data[field] is not None:
            setattr(profile, field, str(data[field]).strip())
    if "date_of_birth" in data:
        profile.date_of_birth = parse_date(data.get("date_of_birth"))
    if "disability" in data:
        profile.disability = str(data.get("disability")).lower() in {"1", "true", "yes", "on"}
    if "shelter_id" in data:
        shelter_id = data.get("shelter_id") or None
        if shelter_id and not db.session.get(Shelter, int(shelter_id)):
            return error("That shelter is not registered", 400)
        profile.shelter_id = int(shelter_id) if shelter_id else None
    db.session.commit()
    return jsonify({"profile": profile_public(profile)})


@bp.delete("/profiles/<int:profile_id>")
@login_required({"caregiver"})
def delete_profile(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile or not _owned(profile):
        return error("You do not have access to this profile", 403)
    if profile.relationship == "self":
        return error("The main profile stays with the account", 400)
    db.session.delete(profile)
    db.session.commit()
    return jsonify({"ok": True})


@bp.get("/profiles/<int:profile_id>/passport")
@login_required()
def passport(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile:
        return error("Health passport not found", 404)
    return jsonify(passport_payload(profile))


@bp.post("/profiles/<int:profile_id>/entries")
@login_required()
def add_entry(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile:
        return error("Profile not found", 404)
    data = payload()
    entry_type = (data.get("entry_type") or "").strip()
    title = (data.get("title") or "").strip()
    if entry_type not in ENTRY_TYPES or not title:
        return error("Choose a record type and a title", 400)
    if _owned(profile):
        author_type = "patient"
    elif can_write_passport(g.user, profile):
        author_type = "clinician"
    else:
        return error("You cannot add to this health passport", 403)
    if entry_type == "vaccine" and data.get("vaccine_status") not in {"administered", "missing", "overdue"}:
        return error("Mark the vaccine as administered, missing, or overdue", 400)
    entry = MedicalEntry(
        profile_id=profile.id,
        entry_type=entry_type,
        title=title,
        details=(data.get("details") or "").strip() or None,
        occurred_on=parse_date(data.get("occurred_on")),
        author_type=author_type,
        author_user_id=g.user.id,
        facility_name=(data.get("facility_name") or "").strip() or None,
        doctor_name=(data.get("doctor_name") or "").strip() or (g.user.full_name if author_type == "clinician" else None),
        result_text=(data.get("result_text") or "").strip() or None,
        vaccine_status=(data.get("vaccine_status") or "").strip() or None,
    )
    db.session.add(entry)
    db.session.commit()
    return jsonify({"entry": entry_json(entry)}), 201


@bp.patch("/entries/<int:entry_id>")
@login_required()
def update_entry(entry_id):
    entry = db.session.get(MedicalEntry, entry_id)
    if not entry:
        return error("Record not found", 404)
    profile = db.session.get(Profile, entry.profile_id)
    if entry.author_user_id != g.user.id:
        return error("You can edit records you wrote", 403)
    data = payload()
    for field in ("title", "details", "facility_name", "doctor_name", "result_text"):
        if field in data:
            setattr(entry, field, (data.get(field) or "").strip() or None)
    if "occurred_on" in data:
        entry.occurred_on = parse_date(data.get("occurred_on"))
    if entry.entry_type == "vaccine" and data.get("vaccine_status") in {"administered", "missing", "overdue"}:
        entry.vaccine_status = data.get("vaccine_status")
    if entry.title is None or entry.title == "":
        return error("A record needs a title", 400)
    db.session.commit()
    return jsonify({"entry": entry_json(entry)})


@bp.delete("/entries/<int:entry_id>")
@login_required()
def delete_entry(entry_id):
    entry = db.session.get(MedicalEntry, entry_id)
    if not entry:
        return error("Record not found", 404)
    if entry.author_user_id != g.user.id:
        return error("You can remove records you wrote", 403)
    Attachment.query.filter_by(entry_id=entry.id).delete()
    db.session.delete(entry)
    db.session.commit()
    return jsonify({"ok": True})


@bp.post("/entries/<int:entry_id>/attachments")
@login_required()
def add_attachment(entry_id):
    entry = db.session.get(MedicalEntry, entry_id)
    if not entry:
        return error("Record not found", 404)
    profile = db.session.get(Profile, entry.profile_id)
    if not _owned(profile) and entry.author_user_id != g.user.id:
        return error("Attach files to a record you can edit", 403)
    try:
        saved = save_upload(request_file())
    except ValueError as exc:
        return error(str(exc), 400)
    if not saved:
        return error("Choose a file", 400)
    attachment = Attachment(entry_id=entry.id, **saved)
    db.session.add(attachment)
    db.session.commit()
    return jsonify({"attachment": {"id": attachment.id, "filename": attachment.filename, "mime_type": attachment.mime_type}}), 201


def request_file():
    from flask import request

    return request.files.get("file")


def _emergency_body(profile):
    entries = MedicalEntry.query.filter_by(profile_id=profile.id).all()
    from ..models import Dependency

    deps = Dependency.query.filter_by(profile_id=profile.id).all()
    return {
        "profile_id": profile.id,
        "full_name": profile.full_name,
        "age": age_years(profile.date_of_birth),
        "blood_type": profile.blood_type,
        "allergies": [entry.title for entry in entries if entry.entry_type == "allergy"],
        "conditions": [entry.title for entry in entries if entry.entry_type == "condition"],
        "medications": [entry.title for entry in entries if entry.entry_type == "medication"],
        "overdue_vaccines": [
            entry.title for entry in entries if entry.entry_type == "vaccine" and entry.vaccine_status in {"missing", "overdue"}
        ],
        "dependencies": [
            {
                "kind": dep.kind,
                "device_name": dep.device_name,
                "supply_level_percent": dep.supply_level_percent,
                "hours_remaining": dep.hours_remaining,
            }
            for dep in deps
        ],
        "emergency_contact_name": profile.emergency_contact_name,
        "emergency_contact_phone": profile.emergency_contact_phone,
        "criticality": criticality_for(profile)["level"],
        "token": profile.emergency_token,
        "note": "Emergency summary only. The full passport stays private.",
    }


@bp.get("/profiles/<int:profile_id>/emergency-summary")
@login_required()
def emergency_summary(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile or not _owned(profile):
        return error("You do not have access to this profile", 403)
    return jsonify({"summary": _emergency_body(profile)})


@bp.get("/emergency/<token>")
def public_emergency(token):
    profile = Profile.query.filter_by(emergency_token=token).first()
    if not profile:
        return error("This emergency card was not found", 404)
    return jsonify({"summary": _emergency_body(profile)})


@bp.post("/appointments")
@login_required({"caregiver"})
def add_appointment():
    data = payload()
    profile = db.session.get(Profile, int(data.get("profile_id") or 0))
    if not profile or profile.owner_user_id != g.user.id:
        return error("Choose one of your profiles", 400)
    facility = (data.get("facility") or "").strip()
    when = parse_dt(data.get("scheduled_at"))
    if not facility or not when:
        return error("Enter the facility and the appointment time", 400)
    item = Appointment(
        profile_id=profile.id,
        facility=facility,
        scheduled_at=when,
        kind=(data.get("kind") or "clinic").strip(),
        notes=(data.get("notes") or "").strip() or None,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"appointment": appointment_json(item)}), 201


LIVING_SITUATIONS = {"tent", "renting", "host_family", "unfinished_building", "car", "other"}


REQUEST_CATEGORIES = {"food", "medicine", "baby", "hygiene", "blankets", "clothes", "rent", "other"}


def _donation_request(item, include_gifts=False):
    data = {
        "id": item.id,
        "profile_id": item.profile_id,
        "who": profile_name(item.profile_id),
        "living_situation": item.living_situation,
        "region": item.region,
        "area": item.area,
        "category": item.category,
        "description": item.description,
        "people_count": item.people_count,
        "status": item.status,
        "created_at": iso(item.created_at),
    }
    if include_gifts:
        data["donations"] = [donation_json(gift) for gift in Donation.query.filter_by(donation_request_id=item.id).all()]
    return data


@bp.post("/donation-requests")
@login_required({"caregiver"})
def add_donation_request():
    from ..models import DonationRequest

    data = payload()
    situation = (data.get("living_situation") or "").strip()
    category = (data.get("category") or "").strip()
    region = (data.get("region") or "").strip()
    description = (data.get("description") or "").strip()
    if situation not in LIVING_SITUATIONS:
        return error("Choose where you are staying", 400)
    if region not in REGIONS:
        return error("Choose your region", 400)
    if category not in REQUEST_CATEGORIES or not description:
        return error("Choose what you need and describe it", 400)
    profile_id = data.get("profile_id") or None
    if profile_id:
        profile = db.session.get(Profile, int(profile_id))
        if not profile or profile.owner_user_id != g.user.id:
            return error("Choose one of your family profiles", 400)
    people = str(data.get("people_count") or "").strip()
    item = DonationRequest(
        requester_user_id=g.user.id,
        profile_id=int(profile_id) if profile_id else None,
        living_situation=situation,
        region=region,
        area=(data.get("area") or "").strip() or None,
        category=category,
        description=description,
        people_count=int(people) if people.isdigit() else None,
        status="open",
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"request": _donation_request(item, include_gifts=True)}), 201


@bp.get("/donation-requests/mine")
@login_required({"caregiver"})
def my_donation_requests():
    from ..models import DonationRequest

    rows = DonationRequest.query.filter_by(requester_user_id=g.user.id).order_by(DonationRequest.created_at.desc()).all()
    return jsonify({"requests": [_donation_request(item, include_gifts=True) for item in rows]})


@bp.patch("/donation-requests/<int:item_id>")
@login_required({"caregiver"})
def update_donation_request(item_id):
    from ..models import DonationRequest

    item = db.session.get(DonationRequest, item_id)
    if not item or item.requester_user_id != g.user.id:
        return error("Request not found", 404)
    status = (payload().get("status") or "").strip()
    if status not in {"open", "fulfilled", "closed"}:
        return error("Choose a status", 400)
    item.status = status
    db.session.commit()
    return jsonify({"request": _donation_request(item, include_gifts=True)})


@bp.post("/donations/<int:item_id>/received")
@login_required({"caregiver"})
def confirm_received(item_id):
    """The family that asked for help confirms a gift arrived."""
    from ..models import DonationRequest

    gift = db.session.get(Donation, item_id)
    request_row = db.session.get(DonationRequest, gift.donation_request_id) if gift and gift.donation_request_id else None
    if not request_row or request_row.requester_user_id != g.user.id:
        return error("This gift is not for your request", 403)
    gift.status = "received"
    db.session.commit()
    return jsonify({"donation": donation_json(gift)})
