"""Helpers that turn records into JSON, shared by more than one role module."""

from datetime import datetime, timedelta, timezone

from flask import g

from .domain import aware, can_write_passport, iso, profile_public
from .extensions import db
from .models import Announcement, Attachment, MedicalEntry, Profile, Shelter, User


def seat_json(item):
    return {
        "id": item.id,
        "facility_name": item.facility_name,
        "region": item.region,
        "seats_available": item.seats_available,
        "next_opening": iso(item.next_opening),
        "notes": item.notes,
    }


def ngo_json(item):
    shelter = db.session.get(Shelter, item.shelter_id) if item.shelter_id else None
    user = db.session.get(User, item.ngo_user_id)
    return {
        "id": item.id,
        "organization": item.organization or (user.full_name if user else "NGO"),
        "description": item.description,
        "shelter_id": item.shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "status": item.status,
        "created_at": iso(item.created_at),
    }


def entry_json(entry):
    author = db.session.get(User, entry.author_user_id) if entry.author_user_id else None
    files = Attachment.query.filter_by(entry_id=entry.id).all()
    return {
        "id": entry.id,
        "profile_id": entry.profile_id,
        "entry_type": entry.entry_type,
        "title": entry.title,
        "details": entry.details,
        "occurred_on": iso(entry.occurred_on),
        "author_type": entry.author_type,
        "author_name": author.full_name if author else None,
        "facility_name": entry.facility_name,
        "doctor_name": entry.doctor_name,
        "result_text": entry.result_text,
        "vaccine_status": entry.vaccine_status,
        "created_at": iso(entry.created_at),
        "attachments": [
            {"id": item.id, "filename": item.filename, "mime_type": item.mime_type} for item in files
        ],
    }


def passport_payload(profile):
    entries = MedicalEntry.query.filter_by(profile_id=profile.id).order_by(MedicalEntry.occurred_on.desc()).all()
    return {
        "profile": profile_public(profile),
        "entries": [entry_json(entry) for entry in entries],
        "can_edit": can_write_passport(g.user, profile),
    }


def profile_name(profile_id):
    profile = db.session.get(Profile, profile_id) if profile_id else None
    return profile.full_name if profile else None


def transport_json(item):
    provider = db.session.get(User, item.provider_user_id) if item.provider_user_id else None
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "who": profile_name(item.profile_id),
        "destination": item.destination,
        "destination_type": item.destination_type,
        "wheelchair_required": item.wheelchair_required,
        "appointment_id": item.appointment_id,
        "status": item.status,
        "provider_name": provider.full_name if provider else None,
        "notes": item.notes,
        "created_at": iso(item.created_at),
    }


def appointment_json(item):
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "who": profile_name(item.profile_id),
        "facility": item.facility,
        "scheduled_at": iso(item.scheduled_at),
        "kind": item.kind,
        "notes": item.notes,
    }


def task_json(item):
    assignee = db.session.get(User, item.assignee_user_id) if item.assignee_user_id else None
    shelter = db.session.get(Shelter, item.shelter_id) if item.shelter_id else None
    return {
        "id": item.id,
        "kind": item.kind,
        "title": item.title,
        "details": item.details,
        "location": item.location,
        "scheduled_at": iso(item.scheduled_at),
        "shelter_name": shelter.name if shelter else None,
        "status": item.status,
        "assignee_name": assignee.full_name if assignee else None,
        "assignee_user_id": item.assignee_user_id,
        "exchange_id": item.exchange_id,
        "mine": item.assignee_user_id == g.user.id,
    }


POSTER_LABELS = {"ministry": "Ministry of Public Health", "doctor": "Doctor", "nurse": "Nurse", "shelter_coordinator": "Shelter coordinator"}


def announcement_json(item):
    shelter = db.session.get(Shelter, item.shelter_id) if item.shelter_id else None
    author = db.session.get(User, item.created_by) if item.created_by else None
    return {
        "id": item.id,
        "kind": item.kind,
        "title": item.title,
        "location": item.location,
        "starts_at": iso(item.starts_at),
        "ends_at": iso(item.ends_at),
        "details": item.details,
        "shelter_id": item.shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "region": item.region or (shelter.region if shelter else None),
        "posted_by": author.full_name if author else None,
        "posted_by_role": POSTER_LABELS.get(author.role) if author else None,
        "mine": bool(author and author.id == g.user.id),
    }


def notices_for(user, limit=None):
    """Upcoming notices this person should see: everything national, plus their
    region and their shelter. People without a shelter see every notice."""
    from datetime import datetime, timedelta, timezone


    cutoff = datetime.now(timezone.utc) - timedelta(hours=12)
    shelter = db.session.get(Shelter, user.shelter_id) if user.shelter_id else None
    rows = []
    for item in Announcement.query.order_by(Announcement.starts_at.asc()).all():
        last = item.ends_at or item.starts_at
        if last and aware(last) < cutoff:
            continue  # already over
        if user.role == "caregiver" and shelter:
            item_region = item.region or (db.session.get(Shelter, item.shelter_id).region if item.shelter_id else None)
            if item.shelter_id and item.shelter_id != shelter.id:
                continue
            if not item.shelter_id and item_region and item_region != shelter.region:
                continue
        rows.append(item)
    return rows[:limit] if limit else rows


def donation_json(item):
    shelter = db.session.get(Shelter, item.target_shelter_id) if item.target_shelter_id else None
    donor = db.session.get(User, item.donor_id)
    return {
        "id": item.id,
        "donor_name": donor.full_name if donor else None,
        "kind": item.kind,
        "amount": item.amount,
        "currency": item.currency,
        "item_description": item.item_description,
        "target_type": item.target_type,
        "target_shelter_id": item.target_shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "region": shelter.region if shelter else None,
        "target_profile_id": item.target_profile_id,
        "cause_label": item.cause_label,
        "donation_request_id": item.donation_request_id,
        "status": item.status,
        "from_recommendation": item.from_recommendation,
        "created_at": iso(item.created_at),
    }


REGIONS = {"Beirut", "Mount Lebanon", "North", "Akkar", "Bekaa", "Baalbek-Hermel", "South", "Nabatieh"}


def outbreak_json(item):
    shelter = db.session.get(Shelter, item.shelter_id)
    return {
        "id": item.id,
        "shelter_id": item.shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "region": shelter.region if shelter else None,
        "suspected_illness": item.suspected_illness,
        "case_count": item.case_count,
        "notes": item.notes,
        "status": item.status,
        "created_at": iso(item.created_at),
        "disclaimer": "This flags a cluster for public health staff. It does not declare an outbreak.",
    }


def relocation_json(item):
    dest = db.session.get(Shelter, item.destination_shelter_id) if item.destination_shelter_id else None
    profile = db.session.get(Profile, item.profile_id) if item.profile_id else None
    return {
        "id": item.id,
        "profile_id": item.profile_id,
        "who": profile.full_name if profile else None,
        "destination_shelter_id": item.destination_shelter_id,
        "destination_name": dest.name if dest else None,
        "reason": item.reason,
        "status": item.status,
        "created_at": iso(item.created_at),
    }
