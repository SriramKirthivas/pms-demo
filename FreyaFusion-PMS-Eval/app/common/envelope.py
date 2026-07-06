"""URF response envelope: every PM API returns BaseRspVO {code, message, data}.

Success -> ok(data). Failure -> raise ApiError(status, code, message), which the
app's exception handler renders as the same envelope with the right HTTP status.
"""

from typing import Any


def ok(data: Any = None, message: str = "success") -> dict:
    return {"code": 200, "message": message, "data": data}


def page(items: list, total: int, page_num: int, page_size: int) -> dict:
    """PageRspVO payload for list endpoints."""
    return {"list": items, "total": total, "pageNum": page_num, "pageSize": page_size}


class ApiError(Exception):
    """A business error carrying the URF error code + HTTP status."""

    def __init__(self, status_code: int, code: str, message: str):
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


# Common URF error codes used by the PM services.
PARAM_INVALID = "PARAM_INVALID"
NOT_FOUND = "NOT_FOUND"
FORBIDDEN = "FORBIDDEN"
CONFLICT = "CONFLICT"
