"""Ministry of Public Health: national overview, shelters, verification, reports."""

from flask import Blueprint, jsonify

from ..domain import (
    complaint_patterns,
    distribution,
    forecast,
    high_risk,
    history_for_shelter,
    iso,
    priority_for,
    regional_trends,
    shelter_public,
    support_counts,
    user_public,
)
from ..extensions import db
from ..http import error, login_required, payload
from ..models import Complaint, Donation, InventoryItem, NgoRequest, Outbreak, Shelter, User
from ..serializers import REGIONS, ngo_json, outbreak_json

bp = Blueprint("ministry", __name__)


@bp.patch("/users/<int:user_id>/verification")
@login_required({"ministry"}, approved=True)
def review_verification(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return error("Account not found", 404)
    status = (payload().get("status") or "").strip()
    if status not in {"documents_received", "checking", "approved"}:
        return error("Choose a review status", 400)
    user.verification_status = status
    db.session.commit()
    return jsonify({"user": user_public(user)})


@bp.get("/verification-queue")
@login_required({"ministry"}, approved=True)
def verification_queue():
    rows = User.query.filter(User.verification_status.in_(["documents_received", "checking"])).all()
    return jsonify({"users": [user_public(row) for row in rows]})


@bp.get("/ministry/overview")
@login_required({"ministry"}, approved=True)
def overview():
    shelters = Shelter.query.order_by(Shelter.name.asc()).all()
    ranked = []
    occupancy = 0
    critical = 0
    shortages = 0
    for shelter in shelters:
        score = priority_for(shelter)
        occupancy += shelter.occupancy or 0
        critical += score["critical_residents"]
        shortages += score["shortages"]
        ranked.append({**shelter_public(shelter), "priority": score})
    ranked.sort(key=lambda row: -row["priority"]["score"])
    return jsonify(
        {
            "shelter_count": len(shelters),
            "occupancy": occupancy,
            "critical_residents": critical,
            "open_shortages": shortages,
            "open_complaints": Complaint.query.filter(Complaint.status != "resolved").count(),
            "donation_count": Donation.query.count(),
            "outbreak_count": Outbreak.query.filter(Outbreak.status != "investigating").count(),
            "ranked": ranked,
            "forecast": forecast(),
            "note": "Figures are aggregated from shelter reports. They support a decision; they do not make one.",
        }
    )


@bp.get("/ministry/shelters")
@login_required({"ministry"}, approved=True)
def ministry_shelters():
    rows = []
    for shelter in Shelter.query.order_by(Shelter.name.asc()).all():
        inventory = InventoryItem.query.filter_by(shelter_id=shelter.id).all()
        rows.append(
            {
                **shelter_public(shelter),
                "priority": priority_for(shelter),
                "history": history_for_shelter(shelter.id),
                "inventory": [
                    {
                        "item_name": item.item_name,
                        "status": item.status,
                        "quantity": item.quantity,
                        "is_equipment": item.is_equipment,
                        "is_specialized": item.is_specialized,
                    }
                    for item in inventory
                ],
            }
        )
    rows.sort(key=lambda row: -row["priority"]["score"])
    return jsonify({"shelters": rows})


@bp.get("/ministry/complaints")
@login_required({"ministry"}, approved=True)
def ministry_complaints():
    complaints = Complaint.query.order_by(Complaint.created_at.desc()).all()
    return jsonify(
        {
            "complaints": [
                {
                    "id": item.id,
                    "shelter_id": item.shelter_id,
                    "region": item.region,
                    "category": item.category,
                    "description": item.description,
                    "source": item.source,
                    "status": item.status,
                    "created_at": iso(item.created_at),
                }
                for item in complaints
            ],
            "patterns": complaint_patterns(),
            "regions": regional_trends(),
            "support_counts": support_counts(),
        }
    )


@bp.get("/ministry/ngos")
@login_required({"ministry"}, approved=True)
def ministry_ngos():
    return jsonify({"requests": [ngo_json(item) for item in NgoRequest.query.order_by(NgoRequest.created_at.desc()).all()]})


@bp.get("/ministry/donations")
@login_required({"ministry"}, approved=True)
def ministry_donations():
    donations = Donation.query.order_by(Donation.created_at.desc()).all()
    rows = []
    for item in donations:
        shelter = db.session.get(Shelter, item.target_shelter_id) if item.target_shelter_id else None
        donor = db.session.get(User, item.donor_id)
        rows.append(
            {
                "id": item.id,
                "donor_name": donor.full_name if donor else None,
                "kind": item.kind,
                "amount": item.amount,
                "currency": item.currency,
                "item_description": item.item_description,
                "shelter_name": shelter.name if shelter else None,
                "region": shelter.region if shelter else None,
                "cause_label": item.cause_label,
                "status": item.status,
                "target_type": item.target_type,
            }
        )
    return jsonify({"donations": rows, "distribution": distribution()})


@bp.get("/ministry/reports")
@login_required({"ministry"}, approved=True)
def ministry_reports():
    outbreaks = Outbreak.query.order_by(Outbreak.created_at.desc()).all()

    return jsonify(
        {
            "high_risk": high_risk(),
            "forecast": forecast(),
            "history": [
                {"shelter": shelter_public(shelter), **history_for_shelter(shelter.id)}
                for shelter in Shelter.query.order_by(Shelter.name.asc()).all()
            ],
            "outbreaks": [outbreak_json(item) for item in outbreaks],
            "support_counts": support_counts(),
        }
    )


@bp.get("/distribution")
@login_required({"ministry"}, approved=True)
def distribution_view():
    return jsonify({"rows": distribution(), "note": "Compare gifts already recorded with shortages shelters still report."})


@bp.patch("/outbreaks/<int:item_id>")
@login_required({"ministry"}, approved=True)
def review_outbreak(item_id):
    item = db.session.get(Outbreak, item_id)
    if not item:
        return error("Report not found", 404)
    status = (payload().get("status") or "").strip()
    if status not in {"reported", "under_review", "investigating"}:
        return error("Choose a review status", 400)
    item.status = status
    db.session.commit()
    return jsonify({"outbreak": outbreak_json(item)})


@bp.post("/shelters")
@login_required({"ministry"}, approved=True)
def register_shelter():
    """The Ministry registers a new shelter (school, center...)."""

    data = payload()
    name = (data.get("name") or "").strip()
    region = (data.get("region") or "").strip()
    if not name or region not in REGIONS:
        return error("Enter the shelter name and choose its region", 400)
    if Shelter.query.filter(Shelter.name.ilike(name)).first():
        return error("A shelter with this name is already registered", 409)

    def number(key):
        value = str(data.get(key) or "0").strip()
        return int(value) if value.isdigit() else 0

    shelter = Shelter(
        name=name,
        region=region,
        kind=(data.get("kind") or "center").strip(),
        address=(data.get("address") or "").strip() or None,
        capacity=number("capacity"),
        occupancy=number("occupancy"),
        accessible=str(data.get("accessible", "")).lower() in {"1", "true", "yes", "on"},
        accessible_spaces=number("accessible_spaces"),
        has_backup_power=str(data.get("has_backup_power", "")).lower() in {"1", "true", "yes", "on"},
        electricity_hours=number("electricity_hours"),
    )
    db.session.add(shelter)
    db.session.commit()
    return jsonify({"shelter": shelter_public(shelter)}), 201
