"""Send verification codes on WhatsApp.

Two providers are supported; set one of them in backend/.env:

Meta WhatsApp Cloud API (free test number)
    META_WA_TOKEN=EAAG...                 # access token from developers.facebook.com
    META_WA_PHONE_NUMBER_ID=1234567890    # "Phone number ID" of the sending number
    META_WA_TEMPLATE=                     # optional: an approved "authentication" template name
    META_WA_TEMPLATE_LANG=en_US           # language of that template

Twilio
    TWILIO_ACCOUNT_SID=ACxxxxxxxx
    TWILIO_AUTH_TOKEN=xxxxxxxx
    TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
    TWILIO_CONTENT_SID=HXxxxxxxxx         # optional: approved template

If both are set, Meta is used. If neither is set, the code is printed in the
server console instead, so the app still works on a developer's machine.
"""

import base64
import json
import urllib.error
import urllib.parse
import urllib.request

from flask import current_app

TWILIO_URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"
META_URL = "https://graph.facebook.com/{version}/{phone_number_id}/messages"


class WhatsAppError(Exception):
    pass


def code_message(code):
    return (
        f"Your Ma'ak verification code is {code}. It expires in 10 minutes. Do not share it.\n"
        f"رمز التحقق في معك: {code}. صالح لمدة 10 دقائق. لا تشاركه مع أحد."
    )


def provider():
    """"meta", "twilio" or None, depending on which keys are in the settings."""
    config = current_app.config
    if config.get("META_WA_TOKEN") and config.get("META_WA_PHONE_NUMBER_ID"):
        return "meta"
    if config.get("TWILIO_ACCOUNT_SID") and config.get("TWILIO_AUTH_TOKEN") and config.get("TWILIO_WHATSAPP_FROM"):
        return "twilio"
    return None


def is_configured():
    return provider() is not None


def send_code(phone, code):
    """Send `code` to `phone` (+961...). Returns "whatsapp", or "console" when no provider is set."""
    chosen = provider()
    if chosen == "meta":
        _send_meta(phone, code)
        return "whatsapp"
    if chosen == "twilio":
        _send_twilio(phone, code)
        return "whatsapp"
    print(f" * WhatsApp is not configured. Verification code for {phone}: {code}")
    return "console"


def _post(request):
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            response.read()
        return None
    except urllib.error.HTTPError as exc:
        try:
            return json.loads(exc.read().decode() or "{}")
        except ValueError:
            return {}
    except urllib.error.URLError as exc:
        raise WhatsAppError("WhatsApp is unreachable right now. Try again in a minute.") from exc


# -- Meta WhatsApp Cloud API -------------------------------------------------

META_ERRORS = {
    131030: "This phone number is not on the test list yet. Add it in the Meta developer dashboard (API Setup → To).",
    131047: "WhatsApp only allows this message within 24 hours of your last message to us. "
            "Send any message to the Ma'ak WhatsApp number, then try again.",
    131026: "This number does not seem to use WhatsApp.",
    132001: "The WhatsApp message template is missing or not approved yet.",
    190: "The WhatsApp access token has expired. Generate a new one in the Meta developer dashboard.",
}


def _send_meta(phone, code):
    config = current_app.config
    to = phone.lstrip("+")  # Meta wants the number without "+"
    if config.get("META_WA_TEMPLATE"):
        # Approved "authentication" template: the code goes in the body and in the copy-code button.
        message = {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {
                "name": config["META_WA_TEMPLATE"],
                "language": {"code": config.get("META_WA_TEMPLATE_LANG") or "en_US"},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": code}]},
                    {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": code}]},
                ],
            },
        }
    else:
        # Plain text: delivered when the person messaged the number in the last 24 hours.
        message = {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": code_message(code)}}

    url = META_URL.format(version=config.get("META_WA_API_VERSION") or "v21.0", phone_number_id=config["META_WA_PHONE_NUMBER_ID"])
    request = urllib.request.Request(url, data=json.dumps(message).encode(), method="POST")
    request.add_header("Authorization", f"Bearer {config['META_WA_TOKEN']}")
    request.add_header("Content-Type", "application/json")
    failure = _post(request)
    if failure is not None:
        detail = failure.get("error", {})
        current_app.logger.warning("Meta WhatsApp error %s: %s", detail.get("code"), detail.get("message"))
        raise WhatsAppError(META_ERRORS.get(detail.get("code"), "We could not send the WhatsApp message. Check the number and try again."))


# -- Twilio ------------------------------------------------------------------


def _send_twilio(phone, code):
    config = current_app.config
    sender = config["TWILIO_WHATSAPP_FROM"]
    if not sender.startswith("whatsapp:"):
        sender = "whatsapp:" + sender
    fields = {"From": sender, "To": "whatsapp:" + phone}
    if config.get("TWILIO_CONTENT_SID"):
        # Approved WhatsApp template whose first variable {{1}} is the code
        fields["ContentSid"] = config["TWILIO_CONTENT_SID"]
        fields["ContentVariables"] = json.dumps({"1": code})
    else:
        fields["Body"] = code_message(code)
    request = urllib.request.Request(
        TWILIO_URL.format(sid=config["TWILIO_ACCOUNT_SID"]), data=urllib.parse.urlencode(fields).encode(), method="POST"
    )
    auth = base64.b64encode(f"{config['TWILIO_ACCOUNT_SID']}:{config['TWILIO_AUTH_TOKEN']}".encode()).decode()
    request.add_header("Authorization", f"Basic {auth}")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")
    failure = _post(request)
    if failure is not None:
        current_app.logger.warning("Twilio error %s: %s", failure.get("code"), failure.get("message"))
        if failure.get("code") == 63015:
            raise WhatsAppError("This number has not joined the WhatsApp sandbox yet. Send the 'join' message to the Twilio number first.")
        if failure.get("code") == 63016:
            raise WhatsAppError(
                "WhatsApp only allows this message within 24 hours of your last message to us. "
                "Send any message to the Twilio number, then try again."
            )
        raise WhatsAppError("We could not send the WhatsApp message. Check the number and try again.")
