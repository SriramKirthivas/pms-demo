"""AWS SQS consumer for domain events (spec: async ingestion path).

Long-polls the queue named by NOTIFY_SQS_QUEUE_URL and funnels each message
through the same `service.process_event` pipeline used by the synchronous
`POST /system/events` fallback, so both ingestion paths share identical
validation, idempotency (dedupe table), and delivery logic.

If NOTIFY_SQS_QUEUE_URL is not set (local/dev/test), `start()` is a no-op —
the consumer never starts and never touches boto3/AWS, so the app boots
cleanly without any AWS configuration.
"""

import asyncio
import json
import logging
import os

from ..common.db import get_session
from . import schemas, service

logger = logging.getLogger("pm_notify.sqs_consumer")

QUEUE_URL = os.getenv("NOTIFY_SQS_QUEUE_URL", "")
WAIT_TIME_SECONDS = int(os.getenv("NOTIFY_SQS_WAIT_TIME", "10"))
MAX_MESSAGES = int(os.getenv("NOTIFY_SQS_MAX_MESSAGES", "10"))
POLL_ERROR_BACKOFF_SECONDS = float(os.getenv("NOTIFY_SQS_ERROR_BACKOFF", "5"))


def process_message(body: dict) -> None:
    """Run one decoded SQS message body through the shared event pipeline.

    Pure/testable: takes a plain dict (already JSON-decoded), opens its own
    db session, and delegates to service.process_event — the exact function
    used by the HTTP fallback endpoint. No SQS/boto3 dependency here, so this
    can be unit-tested directly.
    """
    ev = schemas.EventIn(**body)
    db_gen = get_session()
    db = next(db_gen)
    try:
        service.process_event(db, ev)
    finally:
        db_gen.close()


def _get_sqs_client():
    import boto3  # imported lazily so boto3 is only required when SQS is used

    return boto3.client("sqs", region_name=os.getenv("AWS_REGION", "us-east-1"))


class SqsConsumer:
    """Background long-poll loop, started/stopped from the FastAPI lifespan."""

    def __init__(self, queue_url: str):
        self.queue_url = queue_url
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    def start(self) -> None:
        if not self.queue_url:
            logger.info("NOTIFY_SQS_QUEUE_URL not set; SQS consumer will not start")
            return
        self._task = asyncio.create_task(self._run())
        logger.info("SQS consumer started for queue %s", self.queue_url)

    async def stop(self) -> None:
        if not self._task:
            return
        self._stop.set()
        self._task.cancel()
        try:
            await self._task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass
        logger.info("SQS consumer stopped")

    async def _run(self) -> None:
        client = _get_sqs_client()
        loop = asyncio.get_event_loop()
        while not self._stop.is_set():
            try:
                response = await loop.run_in_executor(
                    None,
                    lambda: client.receive_message(
                        QueueUrl=self.queue_url,
                        MaxNumberOfMessages=MAX_MESSAGES,
                        WaitTimeSeconds=WAIT_TIME_SECONDS,
                    ),
                )
                messages = response.get("Messages", [])
                for msg in messages:
                    receipt_handle = msg.get("ReceiptHandle")
                    try:
                        body = json.loads(msg["Body"])
                        process_message(body)
                        await loop.run_in_executor(
                            None,
                            lambda rh=receipt_handle: client.delete_message(
                                QueueUrl=self.queue_url, ReceiptHandle=rh,
                            ),
                        )
                    except Exception:  # noqa: BLE001 — one bad message shouldn't kill the loop
                        logger.exception("failed to process SQS message; leaving for redelivery")
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — keep polling despite transient AWS errors
                logger.exception("SQS poll failed; backing off")
                await asyncio.sleep(POLL_ERROR_BACKOFF_SECONDS)


_consumer: SqsConsumer | None = None


def start_consumer() -> None:
    global _consumer
    if not QUEUE_URL:
        logger.info("NOTIFY_SQS_QUEUE_URL not set; skipping SQS consumer startup")
        return
    _consumer = SqsConsumer(QUEUE_URL)
    _consumer.start()


async def stop_consumer() -> None:
    global _consumer
    if _consumer:
        await _consumer.stop()
        _consumer = None
