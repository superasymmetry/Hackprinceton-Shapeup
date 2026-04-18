"""Put the haircut-classifier/ root on sys.path so `from src.config import ...` works
without requiring an editable install."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
