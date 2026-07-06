"""Email delivery abstraction.

Sends via SMTP when SMTP_HOST/SMTP_PORT/SMTP_FROM are configured; otherwise
no-ops with a log line so dev/test environments never fail on missing SMTP
config. `to_employee_id` is treated as the recipient address/identifier —
in this platform employee id and email are typically the same value coming
from the emitting service; callers pass whatever identifies the recipient.
"""

import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger("pm_notify.email")


def _smtp_config() -> tuple[str, int, str] | None:
    host = os.getenv("SMTP_HOST", "")
    port = os.getenv("SMTP_PORT", "")
    sender = os.getenv("SMTP_FROM", "")
    if not host or not port or not sender:
        return None
    try:
        return host, int(port), sender
    except ValueError:
        return None


def send_email(to_employee_id: str, subject: str, body: str) -> None:
    if not to_employee_id:
        return
    config = _smtp_config()
    if not config:
        logger.info("SMTP not configured; skipping email to %s (subject=%r)", to_employee_id, subject)
        return
    host, port, sender = config
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to_employee_id
        msg.set_content(body)
        with smtplib.SMTP(host, port, timeout=10) as smtp:
            username = os.getenv("SMTP_USERNAME", "")
            password = os.getenv("SMTP_PASSWORD", "")
            if username and password:
                smtp.starttls()
                smtp.login(username, password)
            smtp.send_message(msg)
        logger.info("Sent email to %s (subject=%r)", to_employee_id, subject)
    except Exception:  # noqa: BLE001 — email delivery is best-effort
        logger.exception("Failed to send email to %s (subject=%r)", to_employee_id, subject)
