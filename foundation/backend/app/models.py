from datetime import datetime, timezone

from .extensions import db


def utcnow():
    return datetime.now(timezone.utc)


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(160), nullable=False)
    phone = db.Column(db.String(40), unique=True)
    email = db.Column(db.String(160), unique=True)
    password_hash = db.Column(db.String(255))  # only set when the person signs in with an email
    role = db.Column(db.String(40), nullable=False)
    specialty = db.Column(db.String(120))
    license_number = db.Column(db.String(80))
    license_body = db.Column(db.String(160))
    license_expires = db.Column(db.Date)
    verification_status = db.Column(db.String(40), nullable=False, default="not_required")
    helper_type = db.Column(db.String(40))
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    license_file = db.Column(db.String(255))
    # Volunteers: identity document, and car details if they offer drives
    id_document_type = db.Column(db.String(20))  # "lebanese_id" or "passport"
    id_document_number = db.Column(db.String(60))
    offers_driving = db.Column(db.Boolean, nullable=False, default=False)
    car_model = db.Column(db.String(80))
    car_plate = db.Column(db.String(30))
    car_seats = db.Column(db.Integer)
    car_wheelchair = db.Column(db.Boolean, nullable=False, default=False)
    phone_verified = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Shelter(db.Model):
    __tablename__ = "shelters"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    region = db.Column(db.String(80), nullable=False)
    kind = db.Column(db.String(40), nullable=False, default="center")
    address = db.Column(db.String(200))
    capacity = db.Column(db.Integer, nullable=False, default=0)
    occupancy = db.Column(db.Integer, nullable=False, default=0)
    accessible = db.Column(db.Boolean, nullable=False, default=False)
    accessible_spaces = db.Column(db.Integer, nullable=False, default=0)
    has_backup_power = db.Column(db.Boolean, nullable=False, default=False)
    electricity_hours = db.Column(db.Integer, nullable=False, default=0)
    notes = db.Column(db.Text)


class Profile(db.Model):
    __tablename__ = "profiles"

    id = db.Column(db.Integer, primary_key=True)
    owner_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    full_name = db.Column(db.String(160), nullable=False)
    relationship = db.Column(db.String(40), nullable=False, default="other")
    date_of_birth = db.Column(db.Date)
    sex = db.Column(db.String(20))
    blood_type = db.Column(db.String(8))
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    disability = db.Column(db.Boolean, nullable=False, default=False)
    disability_notes = db.Column(db.String(240))
    emergency_contact_name = db.Column(db.String(160))
    emergency_contact_phone = db.Column(db.String(40))
    emergency_token = db.Column(db.String(64), unique=True, nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class MedicalEntry(db.Model):
    __tablename__ = "medical_entries"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    entry_type = db.Column(db.String(40), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    details = db.Column(db.Text)
    occurred_on = db.Column(db.Date)
    author_type = db.Column(db.String(20), nullable=False)
    author_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    facility_name = db.Column(db.String(200))
    doctor_name = db.Column(db.String(160))
    result_text = db.Column(db.Text)
    vaccine_status = db.Column(db.String(20))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Attachment(db.Model):
    __tablename__ = "attachments"

    id = db.Column(db.Integer, primary_key=True)
    entry_id = db.Column(db.Integer, db.ForeignKey("medical_entries.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    stored_name = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(120))


class Dependency(db.Model):
    __tablename__ = "dependencies"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    kind = db.Column(db.String(40), nullable=False)
    device_name = db.Column(db.String(160))
    supply_description = db.Column(db.String(200))
    supply_level_percent = db.Column(db.Integer)
    hours_remaining = db.Column(db.Integer)
    notes = db.Column(db.Text)


class PersonalSupply(db.Model):
    __tablename__ = "personal_supplies"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    item_name = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(40), nullable=False, default="food")
    quantity_note = db.Column(db.String(120))
    status = db.Column(db.String(20), nullable=False, default="ok")


class DialysisSession(db.Model):
    __tablename__ = "dialysis_sessions"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    facility_name = db.Column(db.String(200), nullable=False)
    scheduled_at = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="scheduled")
    seat_note = db.Column(db.String(160))


class DialysisSeat(db.Model):
    __tablename__ = "dialysis_seats"

    id = db.Column(db.Integer, primary_key=True)
    facility_name = db.Column(db.String(200), nullable=False)
    region = db.Column(db.String(80), nullable=False)
    seats_available = db.Column(db.Integer, nullable=False, default=0)
    next_opening = db.Column(db.DateTime)
    notes = db.Column(db.String(240))


class Pregnancy(db.Model):
    __tablename__ = "pregnancies"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), unique=True, nullable=False)
    weeks = db.Column(db.Integer, nullable=False)
    due_date = db.Column(db.Date)
    risk_level = db.Column(db.String(20), nullable=False, default="routine")
    risk_notes = db.Column(db.Text)
    next_appointment = db.Column(db.DateTime)


class InventoryItem(db.Model):
    __tablename__ = "inventory_items"

    id = db.Column(db.Integer, primary_key=True)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    item_name = db.Column(db.String(160), nullable=False)
    category = db.Column(db.String(40), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=0)
    unit = db.Column(db.String(40), default="units")
    status = db.Column(db.String(20), nullable=False, default="available")
    is_equipment = db.Column(db.Boolean, nullable=False, default=False)
    is_specialized = db.Column(db.Boolean, nullable=False, default=False)


class ResourceExchange(db.Model):
    __tablename__ = "resource_exchanges"

    id = db.Column(db.Integer, primary_key=True)
    from_shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    to_shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    item_name = db.Column(db.String(160), nullable=False)
    quantity = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(20), nullable=False, default="proposed")
    needs_volunteer = db.Column(db.Boolean, nullable=False, default=False)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(40), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    details = db.Column(db.Text)
    location = db.Column(db.String(200))
    scheduled_at = db.Column(db.DateTime)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    status = db.Column(db.String(20), nullable=False, default="open")
    assignee_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    exchange_id = db.Column(db.Integer, db.ForeignKey("resource_exchanges.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Announcement(db.Model):
    __tablename__ = "announcements"

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(40), nullable=False)
    title = db.Column(db.String(200), nullable=False)
    location = db.Column(db.String(200))
    starts_at = db.Column(db.DateTime)
    details = db.Column(db.Text)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))  # one shelter, or
    region = db.Column(db.String(80))  # a whole region; neither = all of Lebanon
    ends_at = db.Column(db.DateTime)
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Relocation(db.Model):
    __tablename__ = "relocations"

    id = db.Column(db.Integer, primary_key=True)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    destination_shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"))
    reason = db.Column(db.Text, nullable=False)
    status = db.Column(db.String(20), nullable=False, default="requested")
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Outbreak(db.Model):
    __tablename__ = "outbreaks"

    id = db.Column(db.Integer, primary_key=True)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    suspected_illness = db.Column(db.String(160), nullable=False)
    case_count = db.Column(db.Integer, nullable=False, default=1)
    notes = db.Column(db.Text)
    status = db.Column(db.String(20), nullable=False, default="reported")
    created_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Appointment(db.Model):
    __tablename__ = "appointments"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    facility = db.Column(db.String(200), nullable=False)
    scheduled_at = db.Column(db.DateTime, nullable=False)
    kind = db.Column(db.String(80), nullable=False, default="clinic")
    notes = db.Column(db.Text)


class TransportRequest(db.Model):
    __tablename__ = "transport_requests"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    requester_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    destination = db.Column(db.String(200), nullable=False)
    destination_type = db.Column(db.String(40), nullable=False, default="hospital")
    wheelchair_required = db.Column(db.Boolean, nullable=False, default=False)
    appointment_id = db.Column(db.Integer, db.ForeignKey("appointments.id"))
    status = db.Column(db.String(20), nullable=False, default="requested")
    provider_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    notes = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class SupportFlag(db.Model):
    __tablename__ = "support_flags"

    id = db.Column(db.Integer, primary_key=True)
    # The person can be a registered profile, or just described in words.
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"))
    person_description = db.Column(db.String(200))
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    signs = db.Column(db.Text)  # ticked signs, separated by " · "
    flagged_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    reason = db.Column(db.Text, nullable=False)  # the short description
    includes_bullying = db.Column(db.Boolean, nullable=False, default=False)
    status = db.Column(db.String(20), nullable=False, default="open")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class Complaint(db.Model):
    __tablename__ = "complaints"

    id = db.Column(db.Integer, primary_key=True)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    region = db.Column(db.String(80))
    category = db.Column(db.String(80), nullable=False)
    description = db.Column(db.Text, nullable=False)
    source = db.Column(db.String(40), nullable=False, default="direct")
    submitted_by = db.Column(db.Integer, db.ForeignKey("users.id"))
    status = db.Column(db.String(30), nullable=False, default="received")
    photo_stored_name = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    resolved_at = db.Column(db.DateTime)


class Donation(db.Model):
    __tablename__ = "donations"

    id = db.Column(db.Integer, primary_key=True)
    donor_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    kind = db.Column(db.String(20), nullable=False)
    amount = db.Column(db.Float)
    currency = db.Column(db.String(8), default="USD")
    item_description = db.Column(db.String(200))
    target_type = db.Column(db.String(20), nullable=False)
    target_shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    target_profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"))
    cause_label = db.Column(db.String(200))
    status = db.Column(db.String(20), nullable=False, default="pledged")
    coordinator_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    from_recommendation = db.Column(db.Boolean, nullable=False, default=False)
    donation_request_id = db.Column(db.Integer, db.ForeignKey("donation_requests.id"))
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class DonationRequest(db.Model):
    """A displaced family outside the shelters (tent, renting, host family...) asking for help."""

    __tablename__ = "donation_requests"

    id = db.Column(db.Integer, primary_key=True)
    requester_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"))
    living_situation = db.Column(db.String(30), nullable=False)
    region = db.Column(db.String(80), nullable=False)
    area = db.Column(db.String(160))
    category = db.Column(db.String(40), nullable=False)
    description = db.Column(db.Text, nullable=False)
    people_count = db.Column(db.Integer)
    status = db.Column(db.String(20), nullable=False, default="open")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class NgoRequest(db.Model):
    __tablename__ = "ngo_requests"

    id = db.Column(db.Integer, primary_key=True)
    ngo_user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    organization = db.Column(db.String(160))
    description = db.Column(db.Text, nullable=False)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"))
    status = db.Column(db.String(20), nullable=False, default="submitted")
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class HistorySnapshot(db.Model):
    __tablename__ = "history_snapshots"

    id = db.Column(db.Integer, primary_key=True)
    month = db.Column(db.String(7), nullable=False)
    shelter_id = db.Column(db.Integer, db.ForeignKey("shelters.id"), nullable=False)
    shortage_count = db.Column(db.Integer, nullable=False, default=0)
    occupancy = db.Column(db.Integer, nullable=False, default=0)
    complaint_count = db.Column(db.Integer, nullable=False, default=0)
    critical_count = db.Column(db.Integer, nullable=False, default=0)


class CriticalityReview(db.Model):
    __tablename__ = "criticality_reviews"

    id = db.Column(db.Integer, primary_key=True)
    profile_id = db.Column(db.Integer, db.ForeignKey("profiles.id"), nullable=False)
    reviewer_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    classification = db.Column(db.String(20), nullable=False)
    note = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)


class PhoneCode(db.Model):
    """A one-time code sent on WhatsApp, for sign-up or login. Only its hash is stored."""

    __tablename__ = "phone_codes"

    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(40), nullable=False)
    purpose = db.Column(db.String(20), nullable=False)  # "signup" or "login"
    code_hash = db.Column(db.String(255), nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    verified = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
