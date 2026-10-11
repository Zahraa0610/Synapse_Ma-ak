"""One module per role (family.py, shelter.py, ...). Each defines a Flask blueprint called `bp`.

Every module in this folder is registered automatically, so adding a role means adding one file here;
nothing else in the backend needs to change.
"""

import importlib
import pkgutil


def register_roles(app):
    for module in sorted(pkgutil.iter_modules(__path__), key=lambda m: m.name):
        role = importlib.import_module(f"{__name__}.{module.name}")
        app.register_blueprint(role.bp, url_prefix="/api")
