import logging
import os
from logging.handlers import RotatingFileHandler

LOG_FILE = os.path.join(os.path.dirname(__file__), "system_flow.log")

_fmt = "%(asctime)s | %(levelname)-8s | %(name)s | %(funcName)s | %(message)s"
_date_fmt = "%Y-%m-%d %H:%M:%S"

def get_logger(name: str) -> logging.Logger:
    """
    Returns a named logger that writes to both the console and a rotating
    log file (system_flow.log, max 5 MB, 3 backups).
    """
    logger = logging.getLogger(name)

    if logger.handlers:
        return logger  # already configured

    logger.setLevel(logging.DEBUG)

    formatter = logging.Formatter(fmt=_fmt, datefmt=_date_fmt)

    # Rotating file handler
    fh = RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(formatter)

    # Console handler
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(formatter)

    logger.addHandler(fh)
    logger.addHandler(ch)

    return logger
