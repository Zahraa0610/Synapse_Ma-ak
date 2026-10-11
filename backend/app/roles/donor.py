"""Donor: needs board and giving."""

from flask import Blueprint, g, jsonify

from ..domain import opportunities
from ..extensions import db
from ..http import error, login_required, payload
from ..models import Donation, Shelter
from ..serializers import donation_json

bp = Blueprint("donor", __name__)


@bp.get("/donor/board")
@login_required({"donor", "ministry", "shelter_coordinator"})
def donor_board():
    items = opportunities()
    if g.user.role == "donor":
        donations = Donation.query.filter_by(donor_id=g.user.id).order_by(Donation.created_at.desc()).all()
    elif g.user.role == "shelter_coordinator":
        donations = Donation.query.filter_by(target_shelter_id=g.user.shelter_id).all()
    else:
        donations = Donation.query.order_by(Donation.created_at.desc()).all()
    return jsonify(
        {
            "opportunities": items,
            "recommendation": next((item for item in items if item["recommended"]), None),
            "donations": [donation_json(item) for item in donations],
            "note": "You choose the recipient. Ma'ak does not assign a gift on its own.",
        }
    )


@bp.post("/donations")
@login_required({"donor"})
def give():
    data = payload()
    kind = (data.get("kind") or "").strip()
    target_type = (data.get("target_type") or "").strip()
    if kind not in {"money", "physical"} or target_type not in {"shelter", "case", "cause", "request"}:
        return error("Choose money or supplies, and a recipient", 400)
    shelter_id = data.get("target_shelter_id") or None
    profile_id = data.get("target_profile_id") or None
    cause = (data.get("cause_label") or "").strip() or None
    request_id = data.get("donation_request_id") or None
    if target_type == "request":
        from ..models import DonationRequest

        request_row = db.session.get(DonationRequest, int(request_id or 0))
        if not request_row or request_row.status != "open":
            return error("This request is no longer open", 400)
        profile_id = request_row.profile_id
        cause = cause or f"Family in {request_row.area or request_row.region}"
    if not shelter_id and not profile_id and not cause and not request_id:
        return error("Choose a recipient before giving", 400)
    if shelter_id and not db.session.get(Shelter, int(shelter_id)):
        return error("That shelter is not registered", 400)
    amount = None
    if kind == "money":
        try:
            amount = float(data.get("amount"))
        except (TypeError, ValueError):
            return error("Enter an amount", 400)
        if amount <= 0:
            return error("Enter an amount", 400)
    description = (data.get("item_description") or "").strip() or None
    if kind == "physical" and not description:
        return error("Describe the supplies", 400)
    item = Donation(
        donor_id=g.user.id,
        kind=kind,
        amount=amount,
        currency=(data.get("currency") or "USD").strip() or "USD",
        item_description=description,
        target_type=target_type,
        target_shelter_id=int(shelter_id) if shelter_id else None,
        target_profile_id=int(profile_id) if profile_id else None,
        cause_label=cause,
        from_recommendation=str(data.get("from_recommendation", "")).lower() in {"1", "true", "yes", "on"},
        donation_request_id=int(request_id) if target_type == "request" else None,
        status="pledged",
    )
    db.session.add(item)
    db.session.commit()
    return jsonify({"donation": donation_json(item)}), 201
