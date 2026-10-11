from datetime import date, datetime, timezone

from .extensions import db
from .models import (
    Complaint,
    CriticalityReview,
    Dependency,
    DialysisSession,
    Donation,
    HistorySnapshot,
    InventoryItem,
    PersonalSupply,
    Pregnancy,
    Profile,
    Shelter,
    SupportFlag,
    User,
)

CLINICAL = {"doctor", "nurse", "psychologist"}
ROLES = [
    "caregiver",
    "volunteer",
    "doctor",
    "nurse",
    "psychologist",
    "shelter_coordinator",
    "donor",
    "ministry",
    "ngo",
]
ENTRY_TYPES = ["condition", "allergy", "medication", "operation", "lab", "report", "vaccine", "note"]
COMPLAINT_STATUSES = ["received", "under_review", "being_addressed", "resolved"]


def iso(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value


def age_years(dob):
    if not dob:
        return None
    today = date.today()
    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))


def user_public(user):
    if not user:
        return None
    return {
        "id": user.id,
        "full_name": user.full_name,
        "phone": user.phone,
        "email": user.email,
        "role": user.role,
        "specialty": user.specialty,
        "license_number": user.license_number,
        "license_body": user.license_body,
        "license_expires": iso(user.license_expires),
        "verification_status": user.verification_status,
        "helper_type": user.helper_type,
        "shelter_id": user.shelter_id,
        "shelter_name": (db.session.get(Shelter, user.shelter_id).name if user.shelter_id and db.session.get(Shelter, user.shelter_id) else None),
        "has_license_file": bool(user.license_file),
        "phone_verified": bool(user.phone_verified),
        "id_document_type": user.id_document_type,
        "id_document_number": user.id_document_number,
        "offers_driving": bool(user.offers_driving),
        "car_model": user.car_model,
        "car_plate": user.car_plate,
        "car_seats": user.car_seats,
        "car_wheelchair": bool(user.car_wheelchair),
    }


def shelter_public(shelter):
    if not shelter:
        return None
    capacity = shelter.capacity or 0
    occupancy = shelter.occupancy or 0
    percent = round((occupancy / capacity) * 100) if capacity else 0
    return {
        "id": shelter.id,
        "name": shelter.name,
        "region": shelter.region,
        "kind": shelter.kind,
        "address": shelter.address,
        "capacity": capacity,
        "occupancy": occupancy,
        "percent": percent,
        "overcrowded": bool(capacity and occupancy / capacity >= 0.9),
        "accessible": shelter.accessible,
        "accessible_spaces": shelter.accessible_spaces,
        "has_backup_power": shelter.has_backup_power,
        "electricity_hours": shelter.electricity_hours,
        "notes": shelter.notes,
    }


def latest_review(profile_id):
    return (
        CriticalityReview.query.filter_by(profile_id=profile_id)
        .order_by(CriticalityReview.created_at.desc())
        .first()
    )


def suggestion_for(profile):
    reasons = []
    deps = Dependency.query.filter_by(profile_id=profile.id).all()
    for dep in deps:
        low_level = dep.supply_level_percent is not None and dep.supply_level_percent < 25
        low_hours = dep.hours_remaining is not None and dep.hours_remaining < 12
        if low_level or low_hours:
            label = dep.device_name or dep.kind.replace("_", " ")
            reasons.append(f"{label} supply is running low")
    if DialysisSession.query.filter_by(profile_id=profile.id, status="missed").count():
        reasons.append("A dialysis session was missed")
    nutrition = PersonalSupply.query.filter_by(
        profile_id=profile.id, category="specialized_nutrition", status="shortage"
    ).count()
    if nutrition:
        reasons.append("Specialized nutrition is short")
    if reasons:
        return "critical", reasons
    if deps:
        return "non_critical", ["A medical device is recorded and the reported supply is currently adequate"]
    return "non_critical", []


def criticality_for(profile):
    suggested, reasons = suggestion_for(profile)
    review = latest_review(profile.id)
    if review:
        return {
            "level": review.classification,
            "suggested": suggested,
            "confirmed": True,
            "reasons": reasons,
            "review_note": review.note,
            "reviewed_at": iso(review.created_at),
        }
    return {
        "level": suggested,
        "suggested": suggested,
        "confirmed": False,
        "reasons": reasons,
        "review_note": None,
        "reviewed_at": None,
    }


def public_need_reasons(profile):
    reasons = []
    for dep in Dependency.query.filter_by(profile_id=profile.id).all():
        low_level = dep.supply_level_percent is not None and dep.supply_level_percent < 25
        low_hours = dep.hours_remaining is not None and dep.hours_remaining < 12
        if low_level or low_hours:
            reasons.append(f"{(dep.device_name or dep.kind).replace('_', ' ')} supply")
    if DialysisSession.query.filter_by(profile_id=profile.id, status="missed").count():
        reasons.append("dialysis continuity")
    for item in PersonalSupply.query.filter_by(profile_id=profile.id, status="shortage").all():
        if item.category in {"specialized_nutrition", "food"}:
            reasons.append(item.item_name)
    return reasons


def passport_id_for(profile):
    """Readable passport ID, e.g. MAK-0012-4821. The second block is a check
    number so a typo in the first block is caught instead of opening someone else."""
    return f"MAK-{profile.id:04d}-{(profile.id * 7919 + 1031) % 10000:04d}"


def profile_id_from_passport_id(text):
    """Turn 'MAK-0012-4821' (any case, spaces allowed) back into 12, or None."""
    parts = str(text or "").strip().upper().replace(" ", "").split("-")
    if len(parts) != 3 or parts[0] != "MAK" or not parts[1].isdigit() or not parts[2].isdigit():
        return None
    pid = int(parts[1])
    if f"{(pid * 7919 + 1031) % 10000:04d}" != parts[2].zfill(4):
        return None
    return pid


def profile_public(profile, include_contact=True):
    shelter = db.session.get(Shelter, profile.shelter_id) if profile.shelter_id else None
    crit = criticality_for(profile)
    data = {
        "id": profile.id,
        "passport_id": passport_id_for(profile),
        "full_name": profile.full_name,
        "relationship": profile.relationship,
        "date_of_birth": iso(profile.date_of_birth),
        "age": age_years(profile.date_of_birth),
        "sex": profile.sex,
        "blood_type": profile.blood_type,
        "shelter_id": profile.shelter_id,
        "shelter_name": shelter.name if shelter else None,
        "region": shelter.region if shelter else None,
        "disability": profile.disability,
        "disability_notes": profile.disability_notes,
        "emergency_token": profile.emergency_token,
        "criticality": crit,
        "owner_user_id": profile.owner_user_id,
    }
    if include_contact:
        data["emergency_contact_name"] = profile.emergency_contact_name
        data["emergency_contact_phone"] = profile.emergency_contact_phone
    return data


def roster_row(profile):
    crit = criticality_for(profile)
    return {
        "id": profile.id,
        "passport_id": passport_id_for(profile),
        "full_name": profile.full_name,
        "age": age_years(profile.date_of_birth),
        "relationship": profile.relationship,
        "disability": profile.disability,
        "shelter_id": profile.shelter_id,
        "criticality": crit,
    }


def can_view_passport(user, profile):
    """Any signed-in user who has the passport ID can read the passport.
    (There is no per-patient access list any more.)"""
    return user is not None and profile is not None


def can_write_passport(user, profile):
    """The family that owns the profile, or an approved clinician, can add records."""
    if profile.owner_user_id and profile.owner_user_id == user.id:
        return True
    return user.role in CLINICAL and user.verification_status == "approved"


def priority_for(shelter):
    shortages = InventoryItem.query.filter_by(shelter_id=shelter.id, status="shortage").count()
    lows = InventoryItem.query.filter_by(shelter_id=shelter.id, status="low").count()
    residents = Profile.query.filter_by(shelter_id=shelter.id).all()
    critical = sum(1 for person in residents if criticality_for(person)["level"] == "critical")
    open_complaints = Complaint.query.filter(
        Complaint.shelter_id == shelter.id, Complaint.status != "resolved"
    ).count()
    capacity = shelter.capacity or 0
    overcrowded = bool(capacity and (shelter.occupancy or 0) / capacity >= 0.9)
    score = shortages * 3 + critical * 5 + open_complaints * 2 + lows + (10 if overcrowded else 0)
    return {
        "score": score,
        "shortages": shortages,
        "lows": lows,
        "critical_residents": critical,
        "open_complaints": open_complaints,
        "overcrowded": overcrowded,
    }


def complaint_patterns():
    grouped = {}
    for complaint in Complaint.query.order_by(Complaint.created_at.asc()).all():
        grouped.setdefault((complaint.shelter_id, complaint.category), []).append(complaint)
    results = []
    for (shelter_id, category), items in grouped.items():
        shelter = db.session.get(Shelter, shelter_id) if shelter_id else None
        resolved = [item for item in items if item.status == "resolved"]
        open_items = [item for item in items if item.status != "resolved"]
        reopened = False
        if resolved and open_items:
            last_resolved = max((item.resolved_at or item.created_at) for item in resolved)
            reopened = any(item.created_at > last_resolved for item in open_items)
        results.append(
            {
                "shelter_id": shelter_id,
                "shelter_name": shelter.name if shelter else "Unassigned",
                "region": shelter.region if shelter else None,
                "category": category,
                "count": len(items),
                "open_count": len(open_items),
                "reopened": reopened,
            }
        )
    results.sort(key=lambda row: (-row["open_count"], -row["count"]))
    return results


def regional_trends():
    regions = {}
    for complaint in Complaint.query.all():
        region = complaint.region or "Unknown"
        bucket = regions.setdefault(region, {"region": region, "total": 0, "open": 0, "categories": {}})
        bucket["total"] += 1
        if complaint.status != "resolved":
            bucket["open"] += 1
        bucket["categories"][complaint.category] = bucket["categories"].get(complaint.category, 0) + 1
    rows = []
    for bucket in regions.values():
        categories = [
            {"category": name, "count": count}
            for name, count in sorted(bucket["categories"].items(), key=lambda item: -item[1])
        ]
        rows.append(
            {
                "region": bucket["region"],
                "total": bucket["total"],
                "open": bucket["open"],
                "categories": categories,
            }
        )
    rows.sort(key=lambda row: -row["total"])
    return rows


def opportunities():
    items = []
    for inv in InventoryItem.query.filter(InventoryItem.status.in_(["shortage", "low"])).all():
        shelter = db.session.get(Shelter, inv.shelter_id)
        urgency = 3 if inv.status == "shortage" else 1
        if inv.is_specialized or inv.is_equipment:
            urgency += 1
        items.append(
            {
                "key": f"inv-{inv.id}",
                "kind": "shelter",
                "title": inv.item_name,
                "detail": f"{inv.status.capitalize()} at {shelter.name}",
                "shelter_id": shelter.id,
                "shelter_name": shelter.name,
                "region": shelter.region,
                "urgency": urgency,
                "verified": True,
                "confirmed": True,
                "target_type": "shelter",
                "target_shelter_id": shelter.id,
                "target_profile_id": None,
                "item_description": inv.item_name,
            }
        )
    for profile in Profile.query.all():
        reasons = public_need_reasons(profile)
        crit = criticality_for(profile)
        if crit["level"] != "critical" and not reasons:
            continue
        if not reasons and crit["level"] == "critical":
            reasons = ["critical medical support"]
        shelter = db.session.get(Shelter, profile.shelter_id) if profile.shelter_id else None
        first = profile.full_name.split()[0]
        items.append(
            {
                "key": f"case-{profile.id}",
                "kind": "case",
                "title": f"{first} — care supplies",
                "detail": ", ".join(reasons),
                "shelter_id": profile.shelter_id,
                "shelter_name": shelter.name if shelter else None,
                "region": shelter.region if shelter else None,
                "urgency": 5 if crit["confirmed"] else 4,
                "verified": True,
                "confirmed": crit["confirmed"],
                "target_type": "case",
                "target_shelter_id": profile.shelter_id,
                "target_profile_id": profile.id,
                "item_description": reasons[0] if reasons else "medical supplies",
            }
        )
    from .models import DonationRequest

    for req in DonationRequest.query.filter_by(status="open").all():
        items.append(
            {
                "key": f"request-{req.id}",
                "kind": "request",
                "title": f"{req.category.replace('_', ' ').capitalize()} for a family",
                "detail": req.description,
                "living_situation": req.living_situation,
                "people_count": req.people_count,
                "shelter_id": None,
                "shelter_name": None,
                "region": req.region,
                "area": req.area,
                "urgency": 2,
                "verified": False,
                "confirmed": False,
                "target_type": "request",
                "target_shelter_id": None,
                "target_profile_id": req.profile_id,
                "donation_request_id": req.id,
                "item_description": req.description[:120],
            }
        )
    items.sort(key=lambda row: (-row["urgency"], row["title"]))
    if items:
        items[0]["recommended"] = True
    for item in items:
        item.setdefault("recommended", False)
    return items


def forecast():
    record_all_shelters()
    shelters = {shelter.id: shelter for shelter in Shelter.query.all()}
    by_region = {}
    for snap in HistorySnapshot.query.order_by(HistorySnapshot.month.asc()).all():
        shelter = shelters.get(snap.shelter_id)
        if not shelter:
            continue
        series = by_region.setdefault(shelter.region, {})
        point = series.setdefault(snap.month, {"month": snap.month, "shortages": 0, "complaints": 0})
        point["shortages"] += snap.shortage_count
        point["complaints"] += snap.complaint_count
    rows = []
    for region, series in by_region.items():
        history = [series[month] for month in sorted(series)]
        if not history:
            continue
        first = history[0]["shortages"]
        last = history[-1]["shortages"]
        steps = max(len(history) - 1, 1)
        slope = (last - first) / steps
        estimate = max(0, round(last + slope))
        if estimate > last:
            direction = "rising"
        elif estimate < last:
            direction = "falling"
        else:
            direction = "steady"
        rows.append(
            {
                "region": region,
                "history": history,
                "estimate_shortages": estimate,
                "direction": direction,
                "note": "Planning estimate from reported shortages. A person decides what to send.",
            }
        )
    rows.sort(key=lambda row: -row["estimate_shortages"])
    return rows


def record_current_month(shelter_id):
    """Write this month's report row for a shelter from live data.
    Called whenever reports are viewed, so the monthly report builds itself:
    the row for the current month keeps updating until the month ends,
    then stays as history and a new month's row starts."""
    shelter = db.session.get(Shelter, shelter_id)
    if not shelter:
        return
    today = datetime.now(timezone.utc)
    month = month_key(today)
    start = datetime(today.year, today.month, 1, tzinfo=timezone.utc)
    residents = Profile.query.filter_by(shelter_id=shelter_id).all()
    complaints_this_month = sum(
        1 for c in Complaint.query.filter_by(shelter_id=shelter_id).all() if c.created_at and aware(c.created_at) >= start
    )
    values = {
        "shortage_count": InventoryItem.query.filter_by(shelter_id=shelter_id, status="shortage").count(),
        "occupancy": shelter.occupancy or 0,
        "complaint_count": complaints_this_month,
        "critical_count": sum(1 for person in residents if criticality_for(person)["level"] == "critical"),
    }
    snap = HistorySnapshot.query.filter_by(shelter_id=shelter_id, month=month).first()
    if not snap:
        snap = HistorySnapshot(shelter_id=shelter_id, month=month)
        db.session.add(snap)
    for key, value in values.items():
        setattr(snap, key, value)
    db.session.commit()


def record_all_shelters():
    for shelter in Shelter.query.all():
        record_current_month(shelter.id)


def history_for_shelter(shelter_id):
    record_current_month(shelter_id)
    snaps = (
        HistorySnapshot.query.filter_by(shelter_id=shelter_id)
        .order_by(HistorySnapshot.month.asc())
        .all()
    )
    history = [
        {
            "month": snap.month,
            "shortages": snap.shortage_count,
            "occupancy": snap.occupancy,
            "complaints": snap.complaint_count,
            "critical": snap.critical_count,
        }
        for snap in snaps
    ]
    if len(history) >= 2 and history[-1]["shortages"] < history[0]["shortages"]:
        trend = "improving"
    elif len(history) >= 2 and history[-1]["shortages"] > history[0]["shortages"]:
        trend = "worsening"
    else:
        trend = "stable"
    return {"history": history, "trend": trend}


def high_risk():
    grouped = {"all": _empty_risk("All regions")}
    by_shelter = {}
    for profile in Profile.query.all():
        shelter = db.session.get(Shelter, profile.shelter_id) if profile.shelter_id else None
        region = shelter.region if shelter else "Unknown"
        age = age_years(profile.date_of_birth)
        flags = {
            "elderly": age is not None and age >= 60,
            "children": age is not None and age < 18,
            "pregnant": Pregnancy.query.filter_by(profile_id=profile.id).count() > 0,
            "disability": bool(profile.disability),
            "device_dependent": Dependency.query.filter_by(profile_id=profile.id).count() > 0,
        }
        _add_risk(grouped["all"], flags)
        region_row = grouped.setdefault(region, _empty_risk(region))
        _add_risk(region_row, flags)
        if shelter:
            shelter_row = by_shelter.setdefault(shelter.id, _empty_risk(shelter.name, shelter.region, shelter.id))
            _add_risk(shelter_row, flags)
    return {
        "regions": [row for key, row in grouped.items() if key != "all"] + [grouped["all"]],
        "shelters": list(by_shelter.values()),
        "note": "Counts only. Individual health passports stay with the patient.",
    }


def _empty_risk(label, region=None, shelter_id=None):
    return {
        "label": label,
        "region": region,
        "shelter_id": shelter_id,
        "elderly": 0,
        "children": 0,
        "pregnant": 0,
        "disability": 0,
        "device_dependent": 0,
    }


def _add_risk(row, flags):
    for key, value in flags.items():
        if value:
            row[key] += 1


def distribution():
    """Compare each shelter's current shortages with the gifts recorded for it.
    Everything is read live from the database: InventoryItem rows marked
    "shortage" and Donation rows targeted at the shelter."""
    arrived = {"received", "allocated", "distributed"}
    rows = []
    for shelter in Shelter.query.order_by(Shelter.name.asc()).all():
        shortages = InventoryItem.query.filter_by(shelter_id=shelter.id, status="shortage").all()
        donations = Donation.query.filter_by(target_shelter_id=shelter.id).all()
        money = sum(d.amount or 0 for d in donations if d.kind == "money" and d.status in arrived)
        received_items = [d.item_description or "" for d in donations if d.kind == "physical" and d.status in arrived]
        pledged_items = [d.item_description or "" for d in donations if d.kind == "physical" and d.status == "pledged"]

        def mentioned(name, descriptions):
            return any(name.lower() in desc.lower() or desc.lower() in name.lower() for desc in descriptions if desc)

        gaps, pledged_only = [], []
        for item in shortages:
            if mentioned(item.item_name, received_items):
                continue
            if mentioned(item.item_name, pledged_items):
                pledged_only.append(item.item_name)
            else:
                gaps.append(item.item_name)
        rows.append(
            {
                "shelter_id": shelter.id,
                "shelter_name": shelter.name,
                "region": shelter.region,
                "shortage_count": len(shortages),
                "donation_count": len(donations),
                "money": money,
                "physical": received_items,
                "gaps": gaps,
                "pledged_only": pledged_only,
                # Underserved: some shortages have no gift at all, not even a promise.
                "underserved": len(gaps) > 0,
            }
        )
    rows.sort(key=lambda row: (-len(row["gaps"]), -row["shortage_count"]))
    return rows


def support_counts():
    rows = {}
    for flag in SupportFlag.query.all():
        profile = db.session.get(Profile, flag.profile_id) if flag.profile_id else None
        shelter_id = flag.shelter_id or (profile.shelter_id if profile else None)
        if not shelter_id:
            continue
        shelter = db.session.get(Shelter, shelter_id)
        bucket = rows.setdefault(
            shelter.id,
            {"shelter_id": shelter.id, "shelter_name": shelter.name, "region": shelter.region, "open": 0, "total": 0},
        )
        bucket["total"] += 1
        if flag.status != "closed":
            bucket["open"] += 1
    return list(rows.values())


def month_key(day):
    return day.strftime("%Y-%m")


def aware(value):
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value
