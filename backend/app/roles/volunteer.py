"""Volunteer: task board and accepting tasks."""

from flask import Blueprint, g, jsonify

from ..extensions import db
from ..http import error, login_required, payload
from ..models import ResourceExchange, Task
from ..serializers import announcement_json, notices_for, task_json

bp = Blueprint("volunteer", __name__)


@bp.get("/volunteer/board")
@login_required({"volunteer"})
def volunteer_board():
    tasks = Task.query.order_by(Task.scheduled_at.asc()).all()
    return jsonify({"tasks": [task_json(item) for item in tasks], "announcements": [announcement_json(item) for item in notices_for(g.user)]})


@bp.post("/tasks/<int:item_id>/respond")
@login_required({"volunteer"})
def respond_task(item_id):
    item = db.session.get(Task, item_id)
    if not item:
        return error("Task not found", 404)
    action = (payload().get("action") or "").strip()
    if action == "accept":
        if item.status == "accepted" and item.assignee_user_id != g.user.id:
            return error("Another volunteer already accepted this task", 409)
        item.status = "accepted"
        item.assignee_user_id = g.user.id
    elif action == "decline":
        if item.assignee_user_id and item.assignee_user_id != g.user.id:
            return error("This task is assigned to someone else", 403)
        item.status = "open"
        item.assignee_user_id = None
    elif action == "complete":
        if item.assignee_user_id != g.user.id:
            return error("Accept the task before completing it", 403)
        item.status = "completed"
        if item.exchange_id:
            exchange = db.session.get(ResourceExchange, item.exchange_id)
            if exchange:
                exchange.status = "completed"
    else:
        return error("Accept, decline, or complete the task", 400)
    db.session.commit()
    return jsonify({"task": task_json(item)})
