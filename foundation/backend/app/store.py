"""A small model layer that stores Ma'ak's data in Google Cloud Firestore.

Models are declared like this:

    class Shelter(db.Model):
        __tablename__ = "shelters"          # Firestore collection name
        id = db.Column(db.Integer, primary_key=True)
        name = db.Column(db.String(160), nullable=False)

and used like this:

    Shelter.query.filter_by(region="South").order_by(Shelter.name.asc()).all()
    shelter = db.session.get(Shelter, 3)
    db.session.add(Shelter(name="...", region="..."))
    db.session.commit()

Each model is one Firestore collection; each row is one document whose ID is
its integer `id`. Equality filters (`filter_by`) run inside Firestore; other
conditions (`!=`, `in_`, `ilike`, `|`) and sorting run in Python on the
results, so no composite indexes have to be created in the Firebase console.

Two backends implement the same small interface:
  * FirestoreBackend  - the real database
  * MemoryBackend     - in-memory, used by the automated tests
"""

import copy
import os
import re
import threading
from datetime import date, datetime, timezone

from flask import g, has_app_context

# ---------------------------------------------------------------------------
# Column types
# ---------------------------------------------------------------------------


class _Type:
    def to_store(self, value):
        return value

    def from_store(self, value):
        return value


class Integer(_Type):
    pass


class Float(_Type):
    pass


class Boolean(_Type):
    pass


class String(_Type):
    def __init__(self, length=None):
        self.length = length


class Text(_Type):
    pass


class Date(_Type):
    """Stored as "YYYY-MM-DD" text."""

    def to_store(self, value):
        if isinstance(value, datetime):
            value = value.date()
        return value.isoformat() if isinstance(value, date) else value

    def from_store(self, value):
        if isinstance(value, datetime):
            return value.date()
        if isinstance(value, str) and value:
            return date.fromisoformat(value[:10])
        return value


class DateTime(_Type):
    """Stored as a Firestore timestamp (always UTC)."""

    def to_store(self, value):
        if isinstance(value, datetime) and value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    def from_store(self, value):
        if isinstance(value, datetime):
            # Firestore returns its own datetime subclass; normalise it.
            return datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
        if isinstance(value, str) and value:
            parsed = datetime.fromisoformat(value)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        return value


class ForeignKey:
    """Documents a link to another collection. Firestore does not enforce it."""

    def __init__(self, target):
        self.target = target


# ---------------------------------------------------------------------------
# Columns and query expressions
# ---------------------------------------------------------------------------


class Expr:
    """A condition evaluated on a model instance."""

    def __init__(self, test):
        self.test = test

    def __call__(self, obj):
        return self.test(obj)

    def __or__(self, other):
        return Expr(lambda obj: self(obj) or other(obj))

    def __and__(self, other):
        return Expr(lambda obj: self(obj) and other(obj))


class Order:
    def __init__(self, column, descending):
        self.column = column
        self.descending = descending


class Column:
    def __init__(self, type_=None, *extra, primary_key=False, nullable=True, default=None, unique=False, **_):
        if isinstance(type_, type):
            type_ = type_()
        self.type = type_ or _Type()
        self.foreign_key = next((item for item in extra if isinstance(item, ForeignKey)), None)
        self.primary_key = primary_key
        self.nullable = nullable
        self.default = default
        self.unique = unique
        self.name = None

    def __set_name__(self, owner, name):
        self.name = name

    # Instance access returns the value; class access returns the column itself,
    # so `Shelter.region == "South"` builds an expression.
    def __get__(self, obj, owner):
        if obj is None:
            return self
        return obj.__dict__.get(self.name)

    def __set__(self, obj, value):
        obj.__dict__[self.name] = value

    __hash__ = object.__hash__

    def _value(self, obj):
        return obj.__dict__.get(self.name)

    def __eq__(self, other):
        return Expr(lambda obj: self._value(obj) == other)

    def __ne__(self, other):
        return Expr(lambda obj: self._value(obj) != other)

    def __lt__(self, other):
        return Expr(lambda obj: self._value(obj) is not None and self._value(obj) < other)

    def __gt__(self, other):
        return Expr(lambda obj: self._value(obj) is not None and self._value(obj) > other)

    def in_(self, values):
        values = list(values)
        return Expr(lambda obj: self._value(obj) in values)

    def ilike(self, pattern):
        regex = "^" + re.escape(pattern).replace("%", ".*").replace("_", ".") + "$"
        compiled = re.compile(regex, re.IGNORECASE | re.DOTALL)
        return Expr(lambda obj: isinstance(self._value(obj), str) and bool(compiled.match(self._value(obj))))

    def asc(self):
        return Order(self, False)

    def desc(self):
        return Order(self, True)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

_MODELS = []
_STORE = None  # the Store instance (set when it is created)


class _QueryDescriptor:
    def __get__(self, obj, owner):
        return Query(owner)


class Model:
    __tablename__ = None
    query = _QueryDescriptor()

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        cls._columns = {}
        for klass in reversed(cls.__mro__):
            for name, value in vars(klass).items():
                if isinstance(value, Column):
                    cls._columns[name] = value
        if cls.__tablename__:
            _MODELS.append(cls)

    def __init__(self, **values):
        for name, column in self._columns.items():
            if name in values:
                continue
            default = column.default
            self.__dict__[name] = default() if callable(default) else copy.copy(default)
        for name, value in values.items():
            if name not in self._columns:
                raise TypeError(f"{type(self).__name__} has no field {name!r}")
            setattr(self, name, value)

    def _to_doc(self):
        return {name: column.type.to_store(self.__dict__.get(name)) for name, column in self._columns.items()}

    @classmethod
    def _from_doc(cls, doc):
        obj = cls.__new__(cls)
        for name, column in cls._columns.items():
            obj.__dict__[name] = column.type.from_store(doc.get(name))
        return obj

    def __repr__(self):
        return f"<{type(self).__name__} {self.__dict__.get('id')}>"


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


class Query:
    def __init__(self, model):
        self.model = model
        self._equals = {}
        self._conditions = []
        self._orders = []
        self._limit = None

    def _copy(self):
        clone = Query(self.model)
        clone._equals = dict(self._equals)
        clone._conditions = list(self._conditions)
        clone._orders = list(self._orders)
        clone._limit = self._limit
        return clone

    def filter_by(self, **equals):
        clone = self._copy()
        for name, value in equals.items():
            column = self.model._columns[name]
            clone._equals[name] = column.type.to_store(value)
        return clone

    def filter(self, *conditions):
        clone = self._copy()
        clone._conditions.extend(conditions)
        return clone

    def order_by(self, *orders):
        clone = self._copy()
        clone._orders.extend(order if isinstance(order, Order) else Order(order, False) for order in orders)
        return clone

    def limit(self, count):
        clone = self._copy()
        clone._limit = count
        return clone

    def all(self):
        session = _STORE.session
        rows = session._load_query(self.model, self._equals)
        for name, value in self._equals.items():
            column = self.model._columns[name]
            rows = [row for row in rows if column.type.to_store(row.__dict__.get(name)) == value]
        for condition in self._conditions:
            rows = [row for row in rows if condition(row)]
        for order in reversed(self._orders):
            name = order.column.name
            present = [row for row in rows if row.__dict__.get(name) is not None]
            missing = [row for row in rows if row.__dict__.get(name) is None]
            present.sort(key=lambda row: row.__dict__.get(name), reverse=order.descending)
            rows = present + missing
        if self._limit is not None:
            rows = rows[: self._limit]
        return rows

    def first(self):
        rows = self.limit(1).all() if not self._orders else self.all()[:1]
        return rows[0] if rows else None

    def count(self):
        return len(self.all())


# ---------------------------------------------------------------------------
# Session: tracks loaded objects and writes changes on commit
# ---------------------------------------------------------------------------


class Session:
    def __init__(self, backend):
        self.backend = backend
        self._identity = {}  # (model, id) -> object
        self._snapshots = {}  # (model, id) -> doc as last written/read
        self._new = []
        self._deleted = []

    def _track(self, obj, doc):
        key = (type(obj), obj.id)
        self._identity[key] = obj
        self._snapshots[key] = doc

    def get(self, model, ident):
        if ident in (None, ""):
            return None
        try:
            ident = int(ident)
        except (TypeError, ValueError):
            return None
        key = (model, ident)
        if key in self._identity:
            obj = self._identity[key]
            return None if obj in self._deleted else obj
        doc = self.backend.get(model.__tablename__, ident)
        if doc is None:
            return None
        obj = model._from_doc(doc)
        self._track(obj, obj._to_doc())
        return obj

    def _load_query(self, model, equals):
        rows = []
        seen = set()
        for doc in self.backend.query(model.__tablename__, equals):
            key = (model, doc.get("id"))
            if key in self._identity:
                obj = self._identity[key]
            else:
                obj = model._from_doc(doc)
                self._track(obj, obj._to_doc())
            if obj in self._deleted:
                continue
            rows.append(obj)
            seen.add(key)
        # Objects added in this request but not committed yet are visible too.
        for (klass, ident), obj in self._identity.items():
            if klass is model and (klass, ident) not in seen and obj in self._new:
                rows.append(obj)
        return rows

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = self.backend.next_id(type(obj).__tablename__)
        key = (type(obj), obj.id)
        if key not in self._identity:
            self._identity[key] = obj
            self._new.append(obj)

    def add_all(self, objects):
        for obj in objects:
            self.add(obj)

    def delete(self, obj):
        self._deleted.append(obj)

    def flush(self):
        """IDs are assigned on add(), so there is nothing to do here."""

    def commit(self):
        writes = []
        for key, obj in list(self._identity.items()):
            if obj in self._deleted:
                continue
            doc = obj._to_doc()
            if obj in self._new or self._snapshots.get(key) != doc:
                writes.append((obj.__tablename__, obj.id, doc))
                self._snapshots[key] = doc
        deletes = [(obj.__tablename__, obj.id) for obj in self._deleted]
        self.backend.write(writes, deletes)
        for obj in self._deleted:
            self._identity.pop((type(obj), obj.id), None)
            self._snapshots.pop((type(obj), obj.id), None)
        self._new = []
        self._deleted = []

    def rollback(self):
        self._identity.clear()
        self._snapshots.clear()
        self._new = []
        self._deleted = []


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------


class MemoryBackend:
    """Keeps everything in a dictionary. Used by the automated tests."""

    def __init__(self):
        self.collections = {}
        self.counters = {}
        self.lock = threading.Lock()

    def get(self, collection, ident):
        doc = self.collections.get(collection, {}).get(ident)
        return copy.deepcopy(doc) if doc is not None else None

    def query(self, collection, equals):
        docs = self.collections.get(collection, {}).values()
        return [copy.deepcopy(doc) for doc in docs if all(doc.get(k) == v for k, v in equals.items())]

    def next_id(self, collection):
        with self.lock:
            self.counters[collection] = self.counters.get(collection, 0) + 1
            return self.counters[collection]

    def write(self, writes, deletes):
        for collection, ident, doc in writes:
            self.collections.setdefault(collection, {})[ident] = copy.deepcopy(doc)
        for collection, ident in deletes:
            self.collections.get(collection, {}).pop(ident, None)

    def clear(self, collections):
        self.collections.clear()
        self.counters.clear()


class FirestoreBackend:
    """Google Cloud Firestore through the Firebase Admin SDK."""

    COUNTERS = "_counters"

    def __init__(self, credentials_path=None, project_id=None):
        try:
            import firebase_admin
            from firebase_admin import credentials, firestore
        except ImportError as exc:  # pragma: no cover - depends on installation
            raise SystemExit("firebase-admin is not installed. Run: pip install -r requirements.txt") from exc

        options = {"projectId": project_id} if project_id else None
        if not firebase_admin._apps:
            if os.environ.get("FIRESTORE_EMULATOR_HOST"):
                firebase_admin.initialize_app(options=options or {"projectId": "demo-maak"})
            elif credentials_path:
                if not os.path.exists(credentials_path):
                    raise SystemExit(f"Firebase key file not found: {credentials_path}")
                firebase_admin.initialize_app(credentials.Certificate(credentials_path), options)
            else:
                raise SystemExit(
                    "\nFirebase is not configured.\n"
                    "Set FIREBASE_CREDENTIALS to the path of your service account key (JSON).\n"
                    "See the README section 'Set up Firebase'.\n"
                )
        self.firestore = firestore
        self.client = firestore.client()
        try:
            from google.cloud.firestore_v1.base_query import FieldFilter

            self._field_filter = FieldFilter
        except ImportError:  # older google-cloud-firestore
            self._field_filter = None

    def get(self, collection, ident):
        snap = self.client.collection(collection).document(str(ident)).get()
        return snap.to_dict() if snap.exists else None

    def query(self, collection, equals):
        query = self.client.collection(collection)
        for field, value in equals.items():
            if self._field_filter:
                query = query.where(filter=self._field_filter(field, "==", value))
            else:
                query = query.where(field, "==", value)
        return [snap.to_dict() for snap in query.stream()]

    def next_id(self, collection):
        ref = self.client.collection(self.COUNTERS).document(collection)
        transaction = self.client.transaction()

        @self.firestore.transactional
        def increment(txn):
            snap = ref.get(transaction=txn)
            value = (snap.to_dict() or {}).get("value", 0) + 1 if snap.exists else 1
            txn.set(ref, {"value": value})
            return value

        return increment(transaction)

    def write(self, writes, deletes):
        operations = [("set", c, i, d) for c, i, d in writes] + [("delete", c, i, None) for c, i in deletes]
        for start in range(0, len(operations), 400):  # Firestore allows 500 per batch
            batch = self.client.batch()
            for action, collection, ident, doc in operations[start : start + 400]:
                ref = self.client.collection(collection).document(str(ident))
                if action == "set":
                    batch.set(ref, doc)
                else:
                    batch.delete(ref)
            batch.commit()

    def clear(self, collections):
        for name in list(collections) + [self.COUNTERS]:
            while True:
                docs = list(self.client.collection(name).limit(400).stream())
                if not docs:
                    break
                batch = self.client.batch()
                for doc in docs:
                    batch.delete(doc.reference)
                batch.commit()


# ---------------------------------------------------------------------------
# The `db` object the rest of the app imports
# ---------------------------------------------------------------------------


class Store:
    Column = Column
    ForeignKey = ForeignKey
    Integer = Integer
    Float = Float
    Boolean = Boolean
    String = String
    Text = Text
    Date = Date
    DateTime = DateTime
    Model = Model

    def __init__(self):
        global _STORE
        self.backend = None
        self._fallback_session = None
        _STORE = self

    def init_app(self, app):
        kind = app.config.get("STORE", "firestore")
        if kind == "memory":
            self.backend = app.config.get("STORE_BACKEND") or MemoryBackend()
        else:
            self.backend = FirestoreBackend(
                credentials_path=app.config.get("FIREBASE_CREDENTIALS"),
                project_id=app.config.get("FIREBASE_PROJECT_ID"),
            )

        @app.teardown_appcontext
        def _end_session(_exc):
            g.pop("_store_session", None)

    @property
    def session(self):
        if has_app_context():
            if "_store_session" not in g:
                g._store_session = Session(self.backend)
            return g._store_session
        if self._fallback_session is None:
            self._fallback_session = Session(self.backend)
        return self._fallback_session

    def create_all(self):
        """Firestore creates collections on first write; nothing to do."""

    def drop_all(self):
        self.backend.clear([model.__tablename__ for model in _MODELS])
        self.session.rollback()
