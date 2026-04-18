"""
chumpy.ch stub — provides the Ch class that the FLAME pkl was serialised with.
Ch objects are converted transparently to numpy arrays on access.
"""
import numpy as np


class Ch:
    """Drop-in stub for chumpy.ch.Ch that stores data as a numpy array."""

    def __init__(self, x=None, *args, **kwargs):
        self._data = np.asarray(x) if x is not None else np.array([])

    # ── pickle protocol ────────────────────────────────────────────────────
    def __setstate__(self, state):
        if isinstance(state, dict):
            # chumpy stores the underlying array in 'x'
            raw = state.get('x', state.get('v', np.array([])))
            self._data = np.asarray(raw)
        else:
            self._data = np.array([])

    def __getstate__(self):
        return {'x': self._data}

    # ── numpy interop ──────────────────────────────────────────────────────
    def __array__(self, dtype=None, copy=None):
        return self._data if dtype is None else self._data.astype(dtype)

    @property
    def r(self):
        return self._data

    @property
    def shape(self):
        return self._data.shape

    def __repr__(self):
        return f"Ch({self._data!r})"
