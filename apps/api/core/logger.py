import logging
import sys
from pythonjsonlogger import jsonlogger

def setup_logger(name: str) -> logging.Logger:
    """Creates a structured JSON logger for production & debug isolation."""
    logger = logging.getLogger(name)
    
    if logger.hasHandlers():
        logger.handlers.clear()
        
    logger.setLevel(logging.DEBUG)

    logHandler = logging.StreamHandler(sys.stdout)
    # Define explicitly required fields for structured observability
    formatter = jsonlogger.JsonFormatter(
        '%(asctime)s %(name)s %(levelname)s %(message)s'
    )
    logHandler.setFormatter(formatter)
    logger.addHandler(logHandler)
    
    # Prevent propagation to the root logger to avoid duplicates
    logger.propagate = False
    return logger
