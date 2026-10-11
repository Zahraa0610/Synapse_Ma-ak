"""Actions several roles share: notices, complaints, support flags, transport, moves, files."""

import os
from datetime import datetime, timezone

from flask import Blueprint, g, jsonify, request, send_from_directory

from .domain import can_view_passport, criticality_for, iso
from .extensions import db
from .http import error, login_required, parse_dt, payload, save_upload
from .models import (
    Announcement,
    Appointment,
    Attachment,
    Complaint,
    CriticalityReview,
    Donation,
    MedicalEntry,
    Profile,
    Relocation,
    Shelter,
    SupportFlag,
    TransportRequest,
)
from .serializers import (
    REGIONS,
    announcement_json,
    appointment_json,
    donation_json,
    notices_for,
    profile_name,
    relocation_json,
    transport_json,
)

bp = Blueprint("routes_common", __name__)


@bp.post("/profiles/<int:profile_id>/criticality-review")
@login_required({"shelter_coordinator", "doctor", "nurse"})
def review_criticality(profile_id):
    profile = db.session.get(Profile, profile_id)
    if not profile:
        return error("Profile not found", 404)
    if g.user.role == "shelter_coordinator" and profile.shelter_id != g.user.shelter_id:
        return error("This resident is not at your shelter", 403)
    if g.user.role in {"doctor", "nurse"}:
        if g.user.verification_status != "approved":
            return error("Your credentials are still under review", 403)
    data = payload()
    level = (data.get("classification") or "").strip()
    if level not in {"critical", "non_critical"}:
        return error("Classify the case as critical or non-critical", 400)
    review = CriticalityReview(
        profile_id=profile.id,
        reviewer_id=g.user.id,
        classification=level,
        note=(data.get("note") or "").strip() or None,
    )
    db.session.add(review)
    db.session.commit()
    return jsonify({"criticality": criticality_for(profile)})


@bp.get("/attachments/<int:attachment_id>")
@login_required()
def download_attachment(attachment_id):
    attachment = db.session.get(Attachment, attachment_id)
    if not attachment:
        return error("File not found", 404)
    entry = db.session.get(MedicalEntry, attachment.entry_id)
    profile = db.session.get(Profile, entry.profile_id)
    if not can_view_passport(g.user, profile):
        return error("You do not have access to this file", 403)
    folder = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads"))
    return send_from_directory(folder, attachment.stored_name, download_name=attachment.filename)


@bp.get("/requests/mine")
@login_required()
def my_requests():
    profiles = _visible_profiles()
    ids = [profile.id for profile in profiles]
    transports = []
    appointments = []
    if ids:
        transports = TransportRequest.query.filter(TransportRequest.profile_id.in_(ids)).all()
        appointments = Appointment.query.filter(Appointment.profile_id.in_(ids)).all()
    if g.user.role in {"ngo", "volunteer"}:
        transports = TransportRequest.query.order_by(TransportRequest.created_at.desc()).all()
    flags = _visible_flags()
    complaints = _visible_complaints()
    linked = {item.appointment_id for item in transports if item.appointment_id and item.status in {"requested", "accepted", "completed"}}
    at_risk = []
    for appointment in appointments:
        if appointment.scheduled_at and appointment.id not in linked:
            at_risk.append(appointment.id)
    return jsonify(
        {
            "profiles": [{"id": profile.id, "full_name": profile.full_name} for profile in profiles],
            "transports": [transport_json(item) for item in transports],
            "appointments": [appointment_json(item) for item in appointments],
            "at_risk_appointment_ids": at_risk,
            "flags": [_flag(item) for item in flags],
            "complaints": [_complaint(item) for item in complaints],
        }
    )


def _visible_profiles():
    if g.user.role == "caregiver":
        return Profile.query.filter_by(owner_user_id=g.user.id).all()
    if g.user.role == "shelter_coordinator" and g.user.shelter_id:
        return Profile.query.filter_by(shelter_id=g.user.shelter_id).all()
    return []


def _visible_flags():
    if g.user.role == "caregiver":
        ids = [profile.id for profile in Profile.query.filter_by(owner_user_id=g.user.id).all()]
        if not ids:
            return []
        return SupportFlag.query.filter(SupportFlag.profile_id.in_(ids)).all()
    if g.user.role == "volunteer":
        return SupportFlag.query.filter_by(flagged_by=g.user.id).all()
    if g.user.role == "shelter_coordinator" and g.user.shelter_id:
        ids = [profile.id for profile in Profile.query.filter_by(shelter_id=g.user.shelter_id).all()]
        return SupportFlag.query.filter(
            (SupportFlag.shelter_id == g.user.shelter_id) | (SupportFlag.profile_id.in_(ids or [0]))
        ).all()
    return []


def _visible_complaints():
    if g.user.role == "ministry":
        return Complaint.query.order_by(Complaint.created_at.desc()).all()
    if g.user.role == "shelter_coordinator" and g.user.shelter_id:
        return Complaint.query.filter_by(shelter_id=g.user.shelter_id).order_by(Complaint.created_at.desc()).all()
    return Complaint.query.filter_by(submitted_by=g.user.id).order_by(Complaint.created_at.desc()).all()


def _flag(item):
    shelter = db.session.get(Shelter, item.shelter_id) if item.shelter_id else None
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "who": item.person_description or profile_name(item.profile_id),
        "registered_name": profile_name(item.profile_id),
        "signs": item.signs.split(" · ") if item.signs else [],
        "shelter_name": shelter.name if shelter else None,
        "reason": item.reason,
        "includes_bullying": item.includes_bullying,
        "status": item.status,
        "created_at": iso(item.created_at),
    }


def _complaint(item):
    shelter = db.session.get(Shelter, item.shelter_id) if item.shelter_id else None
    return {
        "id": item.id,
        "shelter_id": item.shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "region": item.region,
        "category": item.category,
        "description": item.description,
        "source": item.source,
        "status": item.status,
        "has_photo": bool(item.photo_stored_name),
        "created_at": iso(item.created_at),
        "resolved_at": iso(item.resolved_at),
    }


@bp.post("/transport")
@login_required({"caregiver", "shelter_coordinator"})
def add_transport():
    data = payload()
    profile = db.session.get(Profile, int(data.get("profile_id") or 0))
    if not profile:
        return error("Choose a person", 400)
    if g.user.role == "caregiver" and profile.owner_user_id != g.user.id:
        return error("You do not have access to this profile", 403)
    if g.user.role == "shelter_coordinator" and profile.shelter_id != g.user.shelter_id:
        return error("This resident is not at your shelter", 403)
    destination = (data.get("destination") or "").strip()
    destination_type = (data.get("destination_type") or "hospital").strip()
    if not destination or destination_type not in {"hospital", "dialysis", "clinic", "other"}:
        return error("Enter where the person needs to go", 400)
    appointment_id = data.get("appointment_id") or None
    if appointment_id:
        appointment = db.session.get(Appointment, int(appointment_id))
        if not appointment or appointment.profile_id != profile.id:
            return error("That appointment does not match this person", 400)
        appointment_id = appointment.id
    item = TransportRequest(
        profile_id=profile.id,
        requester_id=g.user.id,
        destination=destination,
        destination_type=destination_type,
        wheelchair_required=str(data.get("wheelchair_required", "")).lower() in {"1", "true", "yes", "on"},
        appointment_id=appointment_id,
        notes=(data.get("notes") or "").strip() or None,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"transport": transport_json(item)}), 201


@bp.patch("/transport/<int:item_id>")
@login_required()
def update_transport(item_id):
    item = db.session.get(TransportRequest, item_id)
    if not item:
        return error("Request not found", 404)
    status = (payload().get("status") or "").strip()
    if status not in {"accepted", "completed", "cancelled"}:
        return error("Choose a status", 400)
    # Volunteers who said at sign-up that they can drive can take ride requests.
    provider = g.user.role == "ngo" or (g.user.role == "volunteer" and g.user.offers_driving)
    owner = _owns_transport(item)
    if status in {"accepted", "completed"} and not provider and g.user.role != "shelter_coordinator":
        return error("A transport provider accepts this request", 403)
    if status == "cancelled" and not owner and not provider:
        return error("You do not have access to this request", 403)
    if status == "accepted":
        item.provider_user_id = g.user.id
    item.status = status
    db.session.commit()
    return jsonify({"transport": transport_json(item)})


def _owns_transport(item):
    profile = db.session.get(Profile, item.profile_id)
    return profile and profile.owner_user_id == g.user.id


@bp.get("/roster")
@login_required({"volunteer", "shelter_coordinator", "caregiver"})
def roster():
    query = Profile.query
    if g.user.role == "shelter_coordinator":
        query = query.filter_by(shelter_id=g.user.shelter_id)
    elif g.user.role == "caregiver":
        query = query.filter_by(owner_user_id=g.user.id)
    q = (request.args.get("q") or "").strip()
    if q:
        query = query.filter(Profile.full_name.ilike(f"%{q}%"))
    rows = []
    for profile in query.order_by(Profile.full_name.asc()).limit(30).all():
        shelter = db.session.get(Shelter, profile.shelter_id) if profile.shelter_id else None
        rows.append(
            {
                "id": profile.id,
                "full_name": profile.full_name,
                "shelter_name": shelter.name if shelter else None,
                "shelter_id": profile.shelter_id,
            }
        )
    return jsonify({"people": rows})


@bp.post("/support-flags")
@login_required({"caregiver", "volunteer", "shelter_coordinator"})
def add_flag():
    """Report a case that needs mental health support.
    The person is described in words; linking a registered profile is optional."""
    data = payload()
    profile = None
    if data.get("profile_id"):
        profile = db.session.get(Profile, int(data.get("profile_id")))
        if not profile:
            return error("That person is not registered", 400)
        if g.user.role == "caregiver" and profile.owner_user_id != g.user.id:
            return error("You can flag people on your own profiles", 403)
        if g.user.role == "shelter_coordinator" and profile.shelter_id != g.user.shelter_id:
            return error("This resident is not at your shelter", 403)
    person = (data.get("person_description") or "").strip()
    if not profile and not person:
        return error("Say who needs support", 400)
    reason = (data.get("reason") or "").strip()
    if not reason:
        return error("Write a short description of the case", 400)
    signs = data.get("signs") or []
    if isinstance(signs, str):
        signs = [part.strip() for part in signs.split("·") if part.strip()]
    shelter_id = data.get("shelter_id") or (profile.shelter_id if profile else None) or g.user.shelter_id
    item = SupportFlag(
        profile_id=profile.id if profile else None,
        person_description=person or None,
        shelter_id=int(shelter_id) if shelter_id else None,
        signs=" · ".join(signs) or None,
        flagged_by=g.user.id,
        reason=reason,
        includes_bullying=str(data.get("includes_bullying", "")).lower() in {"1", "true", "yes", "on"}
        or any("ullying" in sign for sign in signs),
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"flag": _flag(item)}), 201


@bp.patch("/support-flags/<int:item_id>")
@login_required({"shelter_coordinator", "caregiver"})
def update_flag(item_id):
    item = db.session.get(SupportFlag, item_id)
    if not item:
        return error("Flag not found", 404)
    status = (payload().get("status") or "").strip()
    if status not in {"open", "acknowledged", "closed"}:
        return error("Choose a status", 400)
    item.status = status
    db.session.commit()
    return jsonify({"flag": _flag(item)})


@bp.post("/complaints")
@login_required({"caregiver", "volunteer", "shelter_coordinator"})
def add_complaint():
    data = payload()
    category = (data.get("category") or "").strip()
    description = (data.get("description") or "").strip()
    source = (data.get("source") or "direct").strip()
    sources = {"direct", "email", "phone", "message", "photo", "note", "in_person"}
    if not category or not description or source not in sources:
        return error("Enter the issue, how it reached you, and what happened", 400)
    shelter_id = data.get("shelter_id") or g.user.shelter_id
    shelter = db.session.get(Shelter, int(shelter_id)) if shelter_id else None
    if g.user.role == "shelter_coordinator":
        shelter = db.session.get(Shelter, g.user.shelter_id) if g.user.shelter_id else None
    item = Complaint(
        shelter_id=shelter.id if shelter else None,
        region=shelter.region if shelter else (data.get("region") or "").strip() or None,
        category=category,
        description=description,
        source=source,
        submitted_by=g.user.id,
    )
    photo = request.files.get("photo") if request.files else None
    if photo:
        try:
            saved = save_upload(photo)
        except ValueError as exc:
            return error(str(exc), 400)
        if saved:
            item.photo_stored_name = saved["stored_name"]
    db.session.add(item)
    db.session.commit()
    return jsonify({"complaint": _complaint(item)}), 201


@bp.patch("/complaints/<int:item_id>")
@login_required({"shelter_coordinator", "ministry"})
def update_complaint(item_id):
    if g.user.role == "ministry" and g.user.verification_status != "approved":
        return error("This account is still under review", 403)
    item = db.session.get(Complaint, item_id)
    if not item:
        return error("Complaint not found", 404)
    if g.user.role == "shelter_coordinator" and item.shelter_id != g.user.shelter_id:
        return error("This complaint is for another shelter", 403)
    status = (payload().get("status") or "").strip()
    if status not in {"received", "under_review", "being_addressed", "resolved"}:
        return error("Choose a complaint status", 400)
    item.status = status
    if status == "resolved":
        from datetime import datetime, timezone

        item.resolved_at = datetime.now(timezone.utc)
    db.session.commit()
    return jsonify({"complaint": _complaint(item)})


NOTICE_KINDS = {"doctor_visit", "free_healthcare_day", "screening", "vaccination", "other"}


@bp.get("/announcements")
@login_required()
def list_announcements():
    """Upcoming notices for this person, plus the ones they posted themselves."""
    mine = Announcement.query.filter_by(created_by=g.user.id).order_by(Announcement.starts_at.desc()).all()
    return jsonify(
        {
            "announcements": [announcement_json(item) for item in notices_for(g.user)],
            "mine": [announcement_json(item) for item in mine],
        }
    )


@bp.post("/announcements")
@login_required({"shelter_coordinator", "doctor", "nurse", "ministry"})
def add_announcement():
    """Doctors, nurses, shelter coordinators and the Ministry post events (free check-ups,
    screening days, vaccination campaigns...). They show up for everyone concerned."""
    if g.user.role in {"doctor", "nurse", "ministry"} and g.user.verification_status != "approved":
        return error("Your account is still under review", 403)
    data = payload()
    kind = (data.get("kind") or "").strip()
    title = (data.get("title") or "").strip()
    if kind not in NOTICE_KINDS or not title:
        return error("Choose the type of event and give it a title", 400)
    starts_at = parse_dt(data.get("starts_at"))
    if not starts_at:
        return error("Choose when the event starts", 400)
    ends_at = parse_dt(data.get("ends_at"))
    if ends_at and ends_at < starts_at:
        return error("The end time is before the start time", 400)

    shelter = None
    if g.user.role == "shelter_coordinator":
        shelter = db.session.get(Shelter, g.user.shelter_id) if g.user.shelter_id else None
    elif data.get("shelter_id"):
        shelter = db.session.get(Shelter, int(data.get("shelter_id")))
        if not shelter:
            return error("That shelter is not registered", 400)
    region = (data.get("region") or "").strip() or None
    if region and region not in REGIONS:
        return error("Choose a region", 400)
    item = Announcement(
        kind=kind,
        title=title,
        location=(data.get("location") or "").strip() or None,
        starts_at=starts_at,
        ends_at=ends_at,
        details=(data.get("details") or "").strip() or None,
        shelter_id=shelter.id if shelter else None,
        region=shelter.region if shelter else region,
        created_by=g.user.id,
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"announcement": announcement_json(item)}), 201


@bp.delete("/announcements/<int:item_id>")
@login_required({"shelter_coordinator", "doctor", "nurse", "ministry"})
def delete_announcement(item_id):
    item = db.session.get(Announcement, item_id)
    if not item:
        return error("Notice not found", 404)
    if item.created_by != g.user.id and g.user.role != "ministry":
        return error("You can remove notices you posted", 403)
    db.session.delete(item)
    db.session.commit()
    return jsonify({"ok": True})


@bp.patch("/donations/<int:item_id>")
@login_required({"shelter_coordinator", "ministry"})
def update_donation(item_id):
    if g.user.role == "ministry" and g.user.verification_status != "approved":
        return error("This account is still under review", 403)
    item = db.session.get(Donation, item_id)
    if not item:
        return error("Donation not found", 404)
    if g.user.role == "shelter_coordinator" and item.target_shelter_id != g.user.shelter_id:
        return error("This gift is for another shelter", 403)
    status = (payload().get("status") or "").strip()
    if status not in {"pledged", "received", "allocated", "distributed"}:
        return error("Choose a distribution status", 400)
    item.status = status
    item.coordinator_id = g.user.id
    db.session.commit()
    return jsonify({"donation": donation_json(item)})


@bp.post("/relocations")
@login_required({"shelter_coordinator", "caregiver"})
def create_relocation():
    data = payload()
    profile = db.session.get(Profile, int(data.get("profile_id") or 0))
    if not profile:
        return error("Choose a person", 400)
    if g.user.role == "caregiver" and profile.owner_user_id != g.user.id:
        return error("You do not have access to this profile", 403)
    if g.user.role == "shelter_coordinator" and profile.shelter_id != g.user.shelter_id:
        return error("This resident is not at your shelter", 403)
    destination_id = data.get("destination_shelter_id") or None
    destination = db.session.get(Shelter, int(destination_id)) if destination_id else None
    reason = (data.get("reason") or "").strip()
    if not reason:
        return error("Describe why a move is needed", 400)
    # People not yet living in a shelter can still ask to move into one:
    # the receiving shelter then handles the request.
    origin_id = profile.shelter_id or g.user.shelter_id or (destination.id if destination else None)
    if not origin_id:
        return error("Choose the shelter you want to move to", 400)
    if destination and destination.id == profile.shelter_id:
        return error("This person is already at that shelter", 400)
    open_request = Relocation.query.filter_by(profile_id=profile.id, destination_shelter_id=destination.id if destination else None, status="requested").first()
    if open_request:
        return jsonify({"relocation": relocation_json(open_request)}), 200
    item = Relocation(
        shelter_id=origin_id,
        destination_shelter_id=destination.id if destination else None,
        profile_id=profile.id,
        reason=reason,
        created_by=g.user.id,
        status="requested",
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"relocation": relocation_json(item)}), 201
